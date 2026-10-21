import { describe, expect, it } from 'vitest';
import type { Mission } from '@project-hub/domain';
import { deleteMission, type DeleteMissionDeps } from '../src/missions/delete-mission';
import { fakeFileSystem, fakeRepository } from './fakes';
import { fakeMissionRepository, fakeWorktrees, type FakeMissionRepository } from './fakes-missions';

const T0 = '2026-10-19T10:00:00.000Z';
const APP_PATH = 'C:\\Projetos\\app';
const WORKTREE_PATH = 'C:\\worktrees\\app\\m-failed';

function mission(status: Mission['status'], overrides: Partial<Mission> = {}): Mission {
  return {
    id: 'm-failed',
    projectId: 'p1',
    title: 'Missão',
    objective: 'Objetivo',
    acceptanceCriteria: [{ id: 'c1', position: 1, text: 'Critério' }],
    status,
    priority: 'normal',
    agentProfileId: 'simulado',
    executionProfileId: 'padrao',
    altersCode: true,
    createdAt: T0,
    updatedAt: T0,
    ...overrides,
  };
}

/** Missão com plano, uma tentativa, uma aprovação e auditoria, para ver tudo sair junto. */
function filledMissions(status: Mission['status'], overrides: Partial<Mission> = {}) {
  const missions = fakeMissionRepository();
  missions.insertMission(mission(status, overrides));
  missions.insertSteps([
    {
      id: 's1',
      missionId: 'm-failed',
      position: 1,
      title: 'Passo',
      description: '',
      kind: 'analysis',
      status: 'failed',
      dependsOn: [],
    },
  ]);
  missions.insertExecution({ id: 'e1', missionId: 'm-failed', attempt: 1, status: 'failed' });
  missions.insertApproval({
    id: 'a1',
    missionId: 'm-failed',
    executionId: 'e1',
    actionType: 'global_install',
    title: 'Instalar',
    rationale: '',
    affectedResources: [],
    status: 'pending',
    requestedAt: T0,
  });
  missions.appendAudit({
    aggregateType: 'mission',
    aggregateId: 'm-failed',
    eventType: 'mission.created',
    severity: 'info',
    actor: 'system',
    payload: {},
    createdAt: T0,
  });
  missions.appendAudit({
    aggregateType: 'execution',
    aggregateId: 'e1',
    eventType: 'execution.failed',
    severity: 'error',
    actor: 'agent',
    payload: {},
    createdAt: T0,
  });
  return missions;
}

function harness(
  missions: FakeMissionRepository,
  options: { directories?: readonly string[]; worktrees?: DeleteMissionDeps['worktrees'] } = {},
): { deps: DeleteMissionDeps; worktrees: ReturnType<typeof fakeWorktrees> } {
  const repo = fakeRepository();
  repo.insert({
    id: 'p1',
    name: 'app',
    path: APP_PATH,
    normalizedPath: 'c:\\projetos\\app',
    repositoryKind: 'git',
    createdAt: T0,
  });
  const worktrees = fakeWorktrees();
  return {
    worktrees,
    deps: {
      repo: missions,
      projects: repo,
      worktrees: options.worktrees ?? worktrees,
      fs: fakeFileSystem(options.directories ?? [APP_PATH, WORKTREE_PATH], {
        caseInsensitive: true,
      }),
    },
  };
}

describe('deleteMission', () => {
  it('exclui a missão encerrada com o plano, as tentativas, as aprovações e a auditoria', async () => {
    const missions = filledMissions('failed');
    const { deps } = harness(missions);

    expect(await deleteMission(deps, 'm-failed')).toEqual({ ok: true, data: undefined });

    expect(missions.getMission('m-failed')).toBeUndefined();
    expect(missions.steps()).toEqual([]);
    expect(missions.getExecution('e1')).toBeUndefined();
    expect(missions.approvals()).toEqual([]);
    expect(missions.audit()).toEqual([]);
  });

  it.each(['succeeded', 'failed', 'cancelled'] as const)(
    'missão em %s pode ser excluída',
    async (status) => {
      const missions = fakeMissionRepository();
      missions.insertMission(mission(status));
      const { deps } = harness(missions);

      expect(await deleteMission(deps, 'm-failed')).toEqual({ ok: true, data: undefined });
    },
  );

  it.each(['draft', 'planned', 'queued', 'running', 'waiting_approval', 'paused'] as const)(
    'missão em %s não é excluída e segue como está',
    async (status) => {
      const missions = fakeMissionRepository();
      missions.insertMission(mission(status));
      const { deps, worktrees } = harness(missions);

      expect(await deleteMission(deps, 'm-failed')).toMatchObject({
        ok: false,
        error: { code: 'MISSION_INVALID_STATE' },
      });
      expect(missions.getMission('m-failed')).toBeDefined();
      expect(worktrees.removed).toEqual([]);
    },
  );

  it('missão inexistente rejeita com MISSION_NOT_FOUND', async () => {
    const { deps } = harness(fakeMissionRepository());

    expect(await deleteMission(deps, 'nao-existe')).toMatchObject({
      ok: false,
      error: { code: 'MISSION_NOT_FOUND' },
    });
  });

  it('o worktree existente sai antes da missão, pelo Git do projeto', async () => {
    const missions = filledMissions('failed', { worktreePath: WORKTREE_PATH });
    const { deps, worktrees } = harness(missions);

    expect(await deleteMission(deps, 'm-failed')).toEqual({ ok: true, data: undefined });

    expect(worktrees.removed).toEqual([{ repoPath: APP_PATH, worktreePath: WORKTREE_PATH }]);
    expect(missions.getMission('m-failed')).toBeUndefined();
  });

  it('pasta do worktree que já sumiu não bloqueia a exclusão', async () => {
    const missions = filledMissions('failed', { worktreePath: WORKTREE_PATH });
    const { deps, worktrees } = harness(missions, { directories: [APP_PATH] });

    expect(await deleteMission(deps, 'm-failed')).toEqual({ ok: true, data: undefined });

    expect(worktrees.removed).toEqual([]);
    expect(missions.getMission('m-failed')).toBeUndefined();
  });

  it('worktree com alterações não salvas recusa a exclusão, e a missão fica como está', async () => {
    const missions = filledMissions('failed', { worktreePath: WORKTREE_PATH });
    const refused = {
      remove: () =>
        Promise.reject(
          Object.assign(new Error('O worktree tem alterações não salvas.'), {
            code: 'WORKTREE_HAS_UNSAVED_CHANGES',
          }),
        ),
    };
    const { deps } = harness(missions, { worktrees: refused });

    expect(await deleteMission(deps, 'm-failed')).toEqual({
      ok: false,
      error: {
        code: 'WORKTREE_HAS_UNSAVED_CHANGES',
        message: 'O worktree tem alterações não salvas.',
        retryable: false,
      },
    });
    expect(missions.getMission('m-failed')).toBeDefined();
    expect(missions.steps()).toHaveLength(1);
  });

  it('erro sem código do contrato segue para cima, sem apagar a missão', async () => {
    const missions = filledMissions('failed', { worktreePath: WORKTREE_PATH });
    const broken = { remove: () => Promise.reject(new Error('bug')) };
    const { deps } = harness(missions, { worktrees: broken });

    await expect(deleteMission(deps, 'm-failed')).rejects.toThrow('bug');
    expect(missions.getMission('m-failed')).toBeDefined();
  });
});
