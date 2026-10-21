import { describe, expect, it, vi } from 'vitest';
import type { Mission } from '@project-hub/domain';
import type { FileSystemPort, ProjectRepository } from '../src/ports';
import {
  listWorktrees,
  removeMissionWorktree,
  type RemoveWorktreeDeps,
} from '../src/worktrees/worktrees';
import { fakeMissionRepository, fakeWorktrees } from './fakes-missions';

const T0 = '2026-10-21T09:00:00.000Z';
const PROJECT = { id: 'p1', name: 'App', path: 'C:\\Projetos\\app' };

function mission(overrides: Partial<Mission> = {}, withWorktree = true): Mission {
  const worktree = withWorktree ? { worktreeId: 'w1', worktreePath: 'C:\\worktrees\\app\\m1' } : {};
  return {
    id: 'm1',
    projectId: 'p1',
    title: 'Ajustar login',
    objective: 'Objetivo',
    acceptanceCriteria: [{ id: 'c1', position: 1, text: 'Critério' }],
    status: 'succeeded',
    priority: 'normal',
    agentProfileId: 'simulado',
    executionProfileId: 'padrao',
    altersCode: true,
    ...worktree,
    createdAt: T0,
    updatedAt: T0,
    ...overrides,
  };
}

function harness(options: { folders?: string[]; unsaved?: boolean } = {}) {
  const repo = fakeMissionRepository();
  const worktrees = fakeWorktrees();
  const folders = new Set(options.folders ?? ['C:\\worktrees\\app\\m1']);
  const fs: FileSystemPort = { isDirectory: (path) => Promise.resolve(folders.has(path)) };
  const projects = { get: (id: string) => (id === 'p1' ? PROJECT : undefined) } as Pick<
    ProjectRepository,
    'get'
  >;
  const remove = vi.fn(worktrees.remove);
  if (options.unsaved === true) {
    remove.mockRejectedValue(
      Object.assign(new Error('O worktree tem alterações não salvas.'), {
        code: 'WORKTREE_HAS_UNSAVED_CHANGES',
      }),
    );
  }
  const diff = vi.fn(() =>
    Promise.resolve({
      files: [
        {
          path: 'src/a.ts',
          status: 'modified' as const,
          added: 1,
          removed: 0,
          binary: false,
          truncated: false,
        },
        {
          path: 'novo.txt',
          status: 'untracked' as const,
          added: 1,
          removed: 0,
          binary: false,
          truncated: false,
        },
      ],
      truncatedFiles: false,
    }),
  );
  const deps: RemoveWorktreeDeps = {
    repo,
    projects,
    worktrees: { remove },
    fs,
    diff: { diff },
    now: () => T0,
  };
  return { repo, deps, listDeps: { repo, projects, fs }, remove, diff };
}

describe('listWorktrees', () => {
  it('lista os worktrees das missões que ainda têm pasta, com a branch da auditoria', async () => {
    const { repo, listDeps } = harness({ folders: ['C:\\worktrees\\app\\m1'] });
    repo.insertMission(mission());
    repo.insertMission(
      mission({ id: 'm2', worktreePath: 'C:\\worktrees\\app\\m2', worktreeId: 'w2' }),
    );
    repo.insertMission(mission({ id: 'm3' }, false));
    repo.appendAudit({
      aggregateType: 'mission',
      aggregateId: 'm1',
      eventType: 'worktree.created',
      severity: 'info',
      actor: 'user',
      payload: { path: 'C:\\worktrees\\app\\m1', branch: 'ph/m1-ajustar-login' },
      createdAt: T0,
    });

    const result = await listWorktrees(listDeps, 'p1');

    // m2 tem a pasta apagada e m3 nunca teve worktree: só m1 aparece.
    expect(result).toMatchObject({ ok: true });
    if (!result.ok) return;
    const ids = result.data.map((entry) => entry.missionId).sort();
    expect(ids).toEqual(['m1']);
    expect(result.data.find((entry) => entry.missionId === 'm1')).toEqual({
      missionId: 'm1',
      missionTitle: 'Ajustar login',
      status: 'succeeded',
      path: 'C:\\worktrees\\app\\m1',
      branch: 'ph/m1-ajustar-login',
    });
  });

  it('projeto inexistente rejeita com PROJECT_NOT_FOUND', async () => {
    const { listDeps } = harness();
    expect(await listWorktrees(listDeps, 'x')).toMatchObject({
      ok: false,
      error: { code: 'PROJECT_NOT_FOUND' },
    });
  });
});

describe('removeMissionWorktree', () => {
  it('remove o worktree de missão concluída e grava na auditoria', async () => {
    const { repo, deps, remove } = harness();
    repo.insertMission(mission({ status: 'succeeded' }));

    const result = await removeMissionWorktree(deps, 'm1');

    expect(result).toEqual({ ok: true, data: undefined });
    expect(remove).toHaveBeenCalledWith({
      repoPath: 'C:\\Projetos\\app',
      worktreePath: 'C:\\worktrees\\app\\m1',
    });
    expect(repo.audit().map((e) => e.eventType)).toContain('worktree.removed');
    // A missão não muda: só o worktree sai.
    expect(repo.getMission('m1')?.status).toBe('succeeded');
  });

  it.each([
    'draft',
    'planned',
    'queued',
    'running',
    'waiting_approval',
    'waiting_input',
    'paused',
    'failed',
    'cancelled',
  ] as const)('missão %s não tem o worktree removido', async (status) => {
    const { repo, deps, remove } = harness();
    repo.insertMission(mission({ status }));

    const result = await removeMissionWorktree(deps, 'm1');

    expect(result).toMatchObject({ ok: false, error: { code: 'MISSION_INVALID_STATE' } });
    expect(repo.audit().map((e) => e.eventType)).not.toContain('worktree.removed');
    expect(remove).not.toHaveBeenCalled();
  });

  it.each(['failed', 'cancelled'] as const)(
    'missão %s recusa com mensagem que explica que só a concluída libera o worktree',
    async (status) => {
      const { repo, deps } = harness();
      repo.insertMission(mission({ status }));

      const result = await removeMissionWorktree(deps, 'm1');

      expect(result).toMatchObject({
        ok: false,
        error: { code: 'MISSION_INVALID_STATE', message: expect.stringContaining('concluída') },
      });
    },
  );

  it('missão inexistente rejeita com MISSION_NOT_FOUND', async () => {
    const { deps } = harness();
    expect(await removeMissionWorktree(deps, 'x')).toMatchObject({
      ok: false,
      error: { code: 'MISSION_NOT_FOUND' },
    });
  });

  it('missão sem pasta de worktree em disco rejeita com MISSION_INVALID_STATE', async () => {
    const { repo, deps, remove } = harness({ folders: [] });
    repo.insertMission(mission());

    expect(await removeMissionWorktree(deps, 'm1')).toMatchObject({
      ok: false,
      error: { code: 'MISSION_INVALID_STATE' },
    });
    expect(remove).not.toHaveBeenCalled();
  });

  it('alteração não salva devolve o erro tipado com os arquivos que impedem, e não grava auditoria', async () => {
    const { repo, deps } = harness({ unsaved: true });
    repo.insertMission(mission());

    const result = await removeMissionWorktree(deps, 'm1');

    expect(result).toMatchObject({
      ok: false,
      error: {
        code: 'WORKTREE_HAS_UNSAVED_CHANGES',
        details: { files: ['src/a.ts', 'novo.txt'] },
      },
    });
    expect(repo.audit().map((e) => e.eventType)).not.toContain('worktree.removed');
  });

  it('erro sem código do contrato segue para cima', async () => {
    const { repo, deps, remove } = harness();
    remove.mockRejectedValue(new Error('inesperado'));
    repo.insertMission(mission());

    await expect(removeMissionWorktree(deps, 'm1')).rejects.toThrow('inesperado');
  });
});
