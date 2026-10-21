import { describe, expect, it, vi } from 'vitest';
import type { MissionDiffDto } from '@project-hub/contracts';
import type { Mission } from '@project-hub/domain';
import { getMissionDiff, type MissionDiffDeps } from '../src/missions/mission-queries';
import { fakeMissionRepository, type FakeMissionRepository } from './fakes-missions';

const T0 = '2026-10-21T09:00:00.000Z';

function mission(overrides: Partial<Mission> = {}): Mission {
  return {
    id: 'm1',
    projectId: 'p1',
    title: 'Missão',
    objective: 'Objetivo',
    acceptanceCriteria: [{ id: 'c1', position: 1, text: 'Critério' }],
    status: 'running',
    priority: 'normal',
    agentProfileId: 'simulado',
    executionProfileId: 'padrao',
    altersCode: true,
    createdAt: T0,
    updatedAt: T0,
    ...overrides,
  };
}

const CHANGED: MissionDiffDto = {
  files: [
    {
      path: 'a.txt',
      status: 'modified',
      added: 1,
      removed: 1,
      binary: false,
      truncated: false,
      patch: '@@ -1 +1 @@\n-antes\n+depois\n',
    },
  ],
  truncatedFiles: false,
};

function harness(diff: MissionDiffDeps['diff']['diff'] = vi.fn(async () => CHANGED)): {
  repo: FakeMissionRepository;
  deps: MissionDiffDeps;
  diffMock: ReturnType<typeof vi.fn>;
} {
  const repo = fakeMissionRepository();
  const diffMock = vi.fn(diff);
  return { repo, deps: { repo, diff: { diff: diffMock } }, diffMock };
}

describe('getMissionDiff', () => {
  it('missão inexistente rejeita com MISSION_NOT_FOUND, sem olhar o Git', async () => {
    const { deps, diffMock } = harness();

    const result = await getMissionDiff(deps, 'nao-existe');

    expect(result).toMatchObject({ ok: false, error: { code: 'MISSION_NOT_FOUND' } });
    expect(diffMock).not.toHaveBeenCalled();
  });

  it('missão sem worktree devolve a lista vazia, não um erro', async () => {
    const { repo, deps, diffMock } = harness();
    repo.insertMission(mission());

    const result = await getMissionDiff(deps, 'm1');

    expect(result).toEqual({ ok: true, data: { files: [], truncatedFiles: false } });
    expect(diffMock).not.toHaveBeenCalled();
  });

  it('missão com worktree lê o diff da pasta dele e devolve o que a porta trouxe', async () => {
    const { repo, deps, diffMock } = harness();
    repo.insertMission(mission({ worktreePath: 'C:\\worktrees\\app\\m1' }));

    const result = await getMissionDiff(deps, 'm1');

    expect(diffMock).toHaveBeenCalledWith('C:\\worktrees\\app\\m1');
    expect(result).toEqual({ ok: true, data: CHANGED });
  });

  it('falha do Git sai com o código dele e a mensagem segura', async () => {
    const error = Object.assign(new Error('A pasta do projeto não existe.'), {
      code: 'PROJECT_PATH_UNAVAILABLE',
    });
    const { repo, deps } = harness(vi.fn(async () => Promise.reject(error)));
    repo.insertMission(mission({ worktreePath: 'C:\\worktrees\\app\\m1' }));

    const result = await getMissionDiff(deps, 'm1');

    expect(result).toEqual({
      ok: false,
      error: {
        code: 'PROJECT_PATH_UNAVAILABLE',
        message: 'A pasta do projeto não existe.',
        retryable: false,
      },
    });
  });

  it('erro sem código do contrato segue para cima, como nos outros casos de uso', async () => {
    const { repo, deps } = harness(vi.fn(async () => Promise.reject(new Error('bug'))));
    repo.insertMission(mission({ worktreePath: 'C:\\worktrees\\app\\m1' }));

    await expect(getMissionDiff(deps, 'm1')).rejects.toThrow('bug');
  });
});
