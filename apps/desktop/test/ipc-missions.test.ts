import { join } from 'node:path';
import { CHANNELS } from '@project-hub/contracts';
import type { IpcMainInvokeEvent } from 'electron';
import { describe, expect, it, vi } from 'vitest';
import type { CreateMissionDeps, MissionQueryDeps, Orchestrator } from '@project-hub/application';
import { resolveWorktreesRoot } from '../src/main/composition';
import { handleDecideApproval, registerApprovalHandlers } from '../src/main/ipc/approvals';
import {
  handleCreateMission,
  handleMissionAction,
  handleProvideInput,
  registerMissionHandlers,
} from '../src/main/ipc/missions';
import type { IpcRegistry } from '../src/main/ipc/trusted-handler';
import { withMissionEvents } from '../src/main/mission-events';

const VALID = {
  projectId: 'p1',
  title: 'Ajustar login',
  objective: 'Corrigir o login',
  acceptanceCriteria: ['Login funciona'],
  altersCode: true,
};

/** Orquestrador com cada método espionado; o que não importa responde sucesso vazio. */
function spyOrchestrator(): Orchestrator {
  const ok = () => Promise.resolve({ ok: true as const, data: undefined });
  return {
    planMission: vi.fn(() =>
      Promise.resolve({ ok: true as const, data: { missionId: 'm1', steps: [] } }),
    ),
    approvePlan: vi.fn(ok),
    startMission: vi.fn(() => Promise.resolve({ ok: true as const, data: { id: 'e1' } })),
    cancelMission: vi.fn(ok),
    decideApproval: vi.fn(ok),
    provideInput: vi.fn(ok),
    retryMission: vi.fn(ok),
    pauseMission: vi.fn(ok),
    resumeMission: vi.fn(ok),
  } as unknown as Orchestrator;
}

/** Registro do `ipcMain` de imitação: guarda os ouvintes por canal, para chamá-los nos testes. */
function fakeRegistry() {
  const listeners = new Map<string, (event: IpcMainInvokeEvent, payload?: unknown) => unknown>();
  const registry: IpcRegistry = {
    handle(channel, listener) {
      listeners.set(channel, listener);
    },
  };
  return {
    registry,
    /** Chama o canal como se o quadro de `senderUrl` tivesse pedido. */
    call(channel: string, senderUrl: string, payload?: unknown) {
      const listener = listeners.get(channel);
      if (listener === undefined) throw new Error(`canal ${channel} não registrado`);
      const event = { senderFrame: { url: senderUrl } } as unknown as IpcMainInvokeEvent;
      return listener(event, payload);
    },
  };
}

const isTrusted = (event: IpcMainInvokeEvent) =>
  event.senderFrame?.url === 'file:///app/index.html';

describe('criar missão (RF-MIS-002, R165)', () => {
  it('criar missão sem critério de aceite retorna VALIDATION_FAILED, sem chamar a aplicação', () => {
    const deps = { repo: { transaction: vi.fn() } } as unknown as CreateMissionDeps;

    const result = handleCreateMission(deps, { ...VALID, acceptanceCriteria: [] });

    expect(result).toMatchObject({ ok: false, error: { code: 'VALIDATION_FAILED' } });
    expect(deps.repo.transaction).not.toHaveBeenCalled();
  });

  it('payload que não é um objeto também vira VALIDATION_FAILED', () => {
    const deps = {} as CreateMissionDeps;

    expect(handleCreateMission(deps, 'texto')).toMatchObject({
      ok: false,
      error: { code: 'VALIDATION_FAILED' },
    });
  });

  it('a missão com título, objetivo e critério segue para a aplicação', () => {
    const transaction = vi.fn();
    const deps = {
      repo: { transaction, insertMission: vi.fn(), appendAudit: vi.fn() },
      projects: { get: () => undefined },
      now: () => '2026-10-20T09:00:00.000Z',
      newId: () => 'id',
    } as unknown as CreateMissionDeps;

    // O projeto não existe no repositório falso, então a aplicação recusa com PROJECT_NOT_FOUND:
    // a entrada passou pelo schema, que é o que este teste confere.
    expect(handleCreateMission(deps, VALID)).toMatchObject({
      ok: false,
      error: { code: 'PROJECT_NOT_FOUND' },
    });
    expect(transaction).not.toHaveBeenCalled();
  });
});

describe('ações sobre a missão', () => {
  it('recusa o id ausente antes de chamar o orquestrador', () => {
    const orchestrator = spyOrchestrator();

    expect(handleMissionAction(orchestrator, 'start', {})).toMatchObject({
      ok: false,
      error: { code: 'VALIDATION_FAILED' },
    });
    expect(orchestrator.startMission).not.toHaveBeenCalled();
  });

  it.each([
    ['plan', 'planMission'],
    ['approvePlan', 'approvePlan'],
    ['start', 'startMission'],
    ['cancel', 'cancelMission'],
  ] as const)('%s chama %s com o id da missão', async (action, method) => {
    const orchestrator = spyOrchestrator();

    await handleMissionAction(orchestrator, action, { missionId: 'm1' });

    expect(orchestrator[method]).toHaveBeenCalledWith('m1');
  });

  it('provideInput recusa texto vazio e repassa a resposta', async () => {
    const orchestrator = spyOrchestrator();

    expect(handleProvideInput(orchestrator, { missionId: 'm1', text: '' })).toMatchObject({
      ok: false,
      error: { code: 'VALIDATION_FAILED' },
    });
    expect(orchestrator.provideInput).not.toHaveBeenCalled();

    await handleProvideInput(orchestrator, { missionId: 'm1', text: 'sim' });
    expect(orchestrator.provideInput).toHaveBeenCalledWith({ missionId: 'm1', text: 'sim' });
  });
});

describe('pausa, retomada e nova tentativa (R180, R181)', () => {
  it('os canais novos existem com a versão no nome', () => {
    expect(CHANNELS.missionsPause).toBe('missions:pause:v1');
    expect(CHANNELS.missionsResume).toBe('missions:resume:v1');
    expect(CHANNELS.missionsRetry).toBe('missions:retry:v1');
  });

  it.each([
    ['pause', 'pauseMission'],
    ['resume', 'resumeMission'],
    ['retry', 'retryMission'],
  ] as const)('%s chama %s com o id da missão', async (action, method) => {
    const orchestrator = spyOrchestrator();

    await handleMissionAction(orchestrator, action, { missionId: 'm1' });

    expect(orchestrator[method]).toHaveBeenCalledWith('m1');
  });

  it.each(['pause', 'resume', 'retry'] as const)(
    '%s recusa o id ausente antes de chamar o orquestrador',
    (action) => {
      const orchestrator = spyOrchestrator();

      expect(handleMissionAction(orchestrator, action, {})).toMatchObject({
        ok: false,
        error: { code: 'VALIDATION_FAILED' },
      });
      expect(orchestrator.pauseMission).not.toHaveBeenCalled();
      expect(orchestrator.resumeMission).not.toHaveBeenCalled();
      expect(orchestrator.retryMission).not.toHaveBeenCalled();
    },
  );

  it('os canais novos recusam remetente de outra origem, sem rodar o handler (R65)', async () => {
    const fake = fakeRegistry();
    const orchestrator = spyOrchestrator();
    registerMissionHandlers(fake.registry, isTrusted, {
      orchestrator,
      createDeps: {} as CreateMissionDeps,
      queryDeps: { repo: {}, projects: {} } as unknown as MissionQueryDeps,
    });
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    const results = await Promise.all([
      fake.call(CHANNELS.missionsPause, 'https://site.invalido/', { missionId: 'm1' }),
      fake.call(CHANNELS.missionsResume, 'https://site.invalido/', { missionId: 'm1' }),
      fake.call(CHANNELS.missionsRetry, 'https://site.invalido/', { missionId: 'm1' }),
    ]);

    for (const result of results) {
      expect(result).toMatchObject({ ok: false, error: { code: 'PERMISSION_DENIED' } });
    }
    expect(orchestrator.pauseMission).not.toHaveBeenCalled();
    expect(orchestrator.resumeMission).not.toHaveBeenCalled();
    expect(orchestrator.retryMission).not.toHaveBeenCalled();
    error.mockRestore();
  });
});

describe('decidir aprovação (R165)', () => {
  it('decidir aprovação chama o orquestrador com decision approved', async () => {
    const orchestrator = spyOrchestrator();

    await handleDecideApproval(orchestrator, { approvalId: 'ap1', decision: 'approved' });

    expect(orchestrator.decideApproval).toHaveBeenCalledWith({
      approvalId: 'ap1',
      decision: 'approved',
    });
  });

  it('a nota só vai ao orquestrador quando a pessoa a escreveu', async () => {
    const orchestrator = spyOrchestrator();

    await handleDecideApproval(orchestrator, {
      approvalId: 'ap1',
      decision: 'rejected',
      note: 'não',
    });

    expect(orchestrator.decideApproval).toHaveBeenCalledWith({
      approvalId: 'ap1',
      decision: 'rejected',
      note: 'não',
    });
  });

  it('decisão fora de approved e rejected vira VALIDATION_FAILED', async () => {
    const orchestrator = spyOrchestrator();

    const result = await handleDecideApproval(orchestrator, {
      approvalId: 'ap1',
      decision: 'talvez',
    });

    expect(result).toMatchObject({ ok: false, error: { code: 'VALIDATION_FAILED' } });
    expect(orchestrator.decideApproval).not.toHaveBeenCalled();
  });
});

describe('canais de missão e aprovação recusam remetente de outra origem (R65)', () => {
  it('registra os canais e recusa o remetente que não é o aplicativo, sem rodar o handler', async () => {
    const fake = fakeRegistry();
    const orchestrator = spyOrchestrator();
    const queryDeps = { repo: {}, projects: {} } as unknown as MissionQueryDeps;
    registerMissionHandlers(fake.registry, isTrusted, {
      orchestrator,
      createDeps: {} as CreateMissionDeps,
      queryDeps,
    });
    registerApprovalHandlers(fake.registry, isTrusted, orchestrator);
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    const refused = await fake.call(CHANNELS.missionsStart, 'https://site.invalido/', {
      missionId: 'm1',
    });
    const refusedDecision = await fake.call(CHANNELS.approvalsDecide, 'https://site.invalido/', {
      approvalId: 'a1',
      decision: 'approved',
    });

    expect(refused).toMatchObject({ ok: false, error: { code: 'PERMISSION_DENIED' } });
    expect(refusedDecision).toMatchObject({ ok: false, error: { code: 'PERMISSION_DENIED' } });
    expect(orchestrator.startMission).not.toHaveBeenCalled();
    expect(orchestrator.decideApproval).not.toHaveBeenCalled();
    error.mockRestore();
  });
});

describe('raiz dos worktrees (R166)', () => {
  it('APP_WORKTREES_ROOT vence as outras opções', () => {
    expect(
      resolveWorktreesRoot(
        { APP_WORKTREES_ROOT: 'D:\\wt', PROJECT_HUB_DATA_DIR: 'D:\\dados' },
        'C:\\Users\\ana',
      ),
    ).toBe('D:\\wt');
  });

  it('sem override, usa PROJECT_HUB_DATA_DIR/worktrees', () => {
    expect(resolveWorktreesRoot({ PROJECT_HUB_DATA_DIR: '/dados' }, '/home/ana')).toBe(
      join('/dados', 'worktrees'),
    );
  });

  it('sem nenhuma variável, usa <home>/ProjectHub/worktrees', () => {
    expect(resolveWorktreesRoot({}, '/home/ana')).toBe(
      join('/home/ana', 'ProjectHub', 'worktrees'),
    );
  });

  it('variável vazia conta como ausente', () => {
    expect(resolveWorktreesRoot({ APP_WORKTREES_ROOT: '' }, '/home/ana')).toBe(
      join('/home/ana', 'ProjectHub', 'worktrees'),
    );
  });
});

describe('withMissionEvents', () => {
  /** Repositório mínimo: só o que o publicador usa. */
  function minimalRepo(executions: Record<string, string> = {}) {
    let sequence = 0;
    return {
      appendAudit: vi.fn((event: Record<string, unknown>) => {
        sequence += 1;
        return { id: `a${sequence}`, sequence, ...event };
      }),
      getExecution: (id: string) =>
        executions[id] === undefined ? undefined : { id, missionId: executions[id] },
    } as unknown as Parameters<typeof withMissionEvents>[0];
  }

  const base = {
    aggregateType: 'execution' as const,
    aggregateId: 'e1',
    eventType: 'message.delta',
    severity: 'info' as const,
    actor: 'agent' as const,
    payload: { content: 'oi' },
    createdAt: '2026-10-20T09:00:00.000Z',
  };

  it('publica o evento de tentativa com o missionId da missão dona', () => {
    const publish = vi.fn();
    const repo = withMissionEvents(minimalRepo({ e1: 'm1' }), publish);

    repo.appendAudit(base);

    expect(publish).toHaveBeenCalledWith(
      expect.objectContaining({ missionId: 'm1', eventType: 'message.delta', sequence: 1 }),
    );
  });

  it('publica o evento da própria missão com o id dela', () => {
    const publish = vi.fn();
    const repo = withMissionEvents(minimalRepo(), publish);

    repo.appendAudit({ ...base, aggregateType: 'mission', aggregateId: 'm2', eventType: 'x' });

    expect(publish).toHaveBeenCalledWith(expect.objectContaining({ missionId: 'm2' }));
  });

  it('não publica agregado que não é de missão', () => {
    const publish = vi.fn();
    const repo = withMissionEvents(minimalRepo(), publish);

    repo.appendAudit({ ...base, aggregateType: 'project', aggregateId: 'p1' });

    expect(publish).not.toHaveBeenCalled();
  });

  it('erro do publicador é registrado e não derruba a gravação', () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const repo = withMissionEvents(minimalRepo({ e1: 'm1' }), () => {
      throw new Error('janela fechada');
    });

    expect(() => repo.appendAudit(base)).not.toThrow();
    expect(error).toHaveBeenCalled();
    error.mockRestore();
  });
});
