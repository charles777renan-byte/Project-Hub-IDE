import type { Mission } from '@project-hub/domain';
import { describe, expect, it } from 'vitest';
import { missionAccountOf, withMissionAccount } from '../src/missions/mission-account';
import {
  ACCOUNT_LOCKED,
  ACCOUNT_UNAVAILABLE,
  setMissionAccount,
  type SetMissionAccountDeps,
} from '../src/missions/set-mission-account';
import { fakeMissionRepository, type FakeMissionRepository } from './fakes-missions';

const T0 = '2026-10-20T09:00:00.000Z';
const T1 = '2026-10-20T10:00:00.000Z';
const WORK = '11111111-1111-4111-8111-111111111111';
const GONE = '22222222-2222-4222-8222-222222222222';

function mission(overrides: Partial<Mission> = {}): Mission {
  return {
    id: 'm1',
    projectId: 'p1',
    title: 'Ajustar login',
    objective: 'Corrigir o login',
    acceptanceCriteria: [{ id: 'c1', position: 1, text: 'Login funciona' }],
    status: 'draft',
    priority: 'normal',
    agentProfileId: 'simulado',
    executionProfileId: 'padrao',
    altersCode: false,
    createdAt: T0,
    updatedAt: T0,
    ...overrides,
  };
}

/** Contas falsas: a Principal, a `WORK` (viva) e a `GONE` (removida, com o nome gravado). */
const accounts = {
  labelOf: (_provider: 'claude', accountId: string | null) => {
    if (accountId === null) return { name: 'Principal', removed: false };
    if (accountId === WORK) return { name: 'Trabalho', removed: false };
    if (accountId === GONE) return { name: 'Antiga', removed: true };
    return { name: '', removed: true };
  },
};

function harness(
  planning: string[] = [],
  running: string[] = [],
): {
  repo: FakeMissionRepository;
  deps: SetMissionAccountDeps;
} {
  const repo = fakeMissionRepository();
  return {
    repo,
    deps: {
      repo,
      accounts,
      isPlanning: (id) => planning.includes(id),
      isRunning: (id) => running.includes(id),
      now: () => T1,
    },
  };
}

describe('missionAccountOf', () => {
  const deps = { accounts, isPlanning: () => false, isRunning: () => false };

  it('missão com execução em andamento trava a conta, mesmo antes de gravar o início', () => {
    const running = { ...deps, isRunning: (id: string) => id === 'm1' };

    expect(missionAccountOf(running, mission({ status: 'queued' })).accountLocked).toBe(true);
  });

  it('missão sem conta está na Principal, destravada', () => {
    expect(missionAccountOf(deps, mission())).toEqual({
      accountId: null,
      accountName: 'Principal',
      accountRemoved: false,
      accountLocked: false,
    });
  });

  it('missão numa conta leva o nome dela', () => {
    expect(missionAccountOf(deps, mission({ accountId: WORK }))).toMatchObject({
      accountId: WORK,
      accountName: 'Trabalho',
      accountRemoved: false,
    });
  });

  it('conta removida mantém o nome e sai marcada', () => {
    expect(missionAccountOf(deps, mission({ accountId: GONE }))).toMatchObject({
      accountId: GONE,
      accountName: 'Antiga',
      accountRemoved: true,
    });
  });

  it('a conta trava quando a missão já começou ou está sendo planejada', () => {
    expect(missionAccountOf(deps, mission({ startedAt: T1 })).accountLocked).toBe(true);
    expect(
      missionAccountOf({ ...deps, isPlanning: (id) => id === 'm1' }, mission()).accountLocked,
    ).toBe(true);
  });

  it('withMissionAccount devolve a missão com os campos da conta', () => {
    expect(withMissionAccount(deps, mission({ accountId: WORK }))).toMatchObject({
      id: 'm1',
      title: 'Ajustar login',
      accountId: WORK,
      accountName: 'Trabalho',
      accountLocked: false,
    });
  });
});

describe('setMissionAccount', () => {
  it('troca a conta de uma missão que ainda não começou', () => {
    const h = harness();
    h.repo.insertMission(mission());

    const result = setMissionAccount(h.deps, { missionId: 'm1', accountId: WORK });

    expect(result).toMatchObject({
      ok: true,
      data: { id: 'm1', accountId: WORK, accountName: 'Trabalho', accountLocked: false },
    });
    expect(h.repo.getMission('m1')?.accountId).toBe(WORK);
    expect(h.repo.getMission('m1')?.updatedAt).toBe(T1);
  });

  it('null volta a missão para a Principal', () => {
    const h = harness();
    h.repo.insertMission(mission({ accountId: WORK }));

    const result = setMissionAccount(h.deps, { missionId: 'm1', accountId: null });

    expect(result).toMatchObject({ ok: true, data: { accountId: null, accountName: 'Principal' } });
    expect(h.repo.getMission('m1')?.accountId).toBeUndefined();
  });

  it('missão que já começou não troca de conta', () => {
    const h = harness();
    h.repo.insertMission(mission({ status: 'running', startedAt: T0 }));

    const result = setMissionAccount(h.deps, { missionId: 'm1', accountId: WORK });

    expect(result).toMatchObject({
      ok: false,
      error: { code: 'VALIDATION_FAILED', message: ACCOUNT_LOCKED },
    });
    expect(h.repo.getMission('m1')?.accountId).toBeUndefined();
  });

  it('missão com o plano sendo gerado não troca de conta', () => {
    const h = harness(['m1']);
    h.repo.insertMission(mission());

    const result = setMissionAccount(h.deps, { missionId: 'm1', accountId: WORK });

    expect(result).toMatchObject({ ok: false, error: { message: ACCOUNT_LOCKED } });
    expect(h.repo.getMission('m1')?.accountId).toBeUndefined();
  });

  it.each([GONE, '33333333-3333-4333-8333-333333333333'])(
    'conta removida ou desconhecida (%s) é recusada, e a missão fica como estava',
    (accountId) => {
      const h = harness();
      h.repo.insertMission(mission({ accountId: WORK }));

      const result = setMissionAccount(h.deps, { missionId: 'm1', accountId });

      expect(result).toMatchObject({
        ok: false,
        error: { code: 'VALIDATION_FAILED', message: ACCOUNT_UNAVAILABLE },
      });
      expect(h.repo.getMission('m1')?.accountId).toBe(WORK);
    },
  );

  it('missão que não existe: MISSION_NOT_FOUND', () => {
    const h = harness();

    expect(setMissionAccount(h.deps, { missionId: 'nada', accountId: null })).toMatchObject({
      ok: false,
      error: { code: 'MISSION_NOT_FOUND' },
    });
  });
});

describe('setMissionAccount durante o início', () => {
  it('recusa a troca enquanto o agente está sendo iniciado, e a conta fica como estava', () => {
    const h = harness([], ['m1']);
    h.repo.insertMission(mission({ status: 'queued', accountId: WORK }));

    expect(setMissionAccount(h.deps, { missionId: 'm1', accountId: null })).toEqual({
      ok: false,
      error: expect.objectContaining({ message: ACCOUNT_LOCKED }),
    });
    expect(h.repo.getMission('m1')?.accountId).toBe(WORK);
  });
});

describe('missão que falhou ou foi cancelada', () => {
  const deps = { accounts, isPlanning: () => false, isRunning: () => false };

  it('destrava a conta, mesmo já tendo começado', () => {
    expect(missionAccountOf(deps, mission({ status: 'failed', startedAt: T1 })).accountLocked).toBe(
      false,
    );
    expect(
      missionAccountOf(deps, mission({ status: 'cancelled', startedAt: T1 })).accountLocked,
    ).toBe(false);
  });

  it('segue travada enquanto roda, espera ou está em revisão', () => {
    for (const status of ['running', 'waiting_input', 'paused', 'review', 'succeeded'] as const) {
      expect(missionAccountOf(deps, mission({ status, startedAt: T1 })).accountLocked).toBe(true);
    }
  });

  it('segue travada se uma nova tentativa já está sendo iniciada', () => {
    const running = { ...deps, isRunning: () => true };

    expect(
      missionAccountOf(running, mission({ status: 'failed', startedAt: T1 })).accountLocked,
    ).toBe(true);
  });

  it('troca a conta de uma missão que falhou, para a nova tentativa rodar em outra', () => {
    const h = harness();
    h.repo.insertMission(mission({ status: 'failed', startedAt: T0, accountId: GONE }));

    const result = setMissionAccount(h.deps, { missionId: 'm1', accountId: WORK });

    expect(result.ok && result.data).toMatchObject({
      accountId: WORK,
      accountRemoved: false,
      accountLocked: false,
    });
    expect(h.repo.getMission('m1')?.accountId).toBe(WORK);
  });
});
