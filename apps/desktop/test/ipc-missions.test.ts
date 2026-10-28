import { join } from 'node:path';
import { CHANNELS } from '@project-hub/contracts';
import type { IpcMainInvokeEvent } from 'electron';
import { describe, expect, it, vi } from 'vitest';
import type {
  CreateMissionDeps,
  DeleteMissionDeps,
  MissionDiffDeps,
  MissionQueryDeps,
  Orchestrator,
} from '@project-hub/application';
import { resolveWorktreesRoot } from '../src/main/composition';
import { handleDecideApproval, registerApprovalHandlers } from '../src/main/ipc/approvals';
import {
  handleCreateMission,
  handleDeleteMission,
  handleEditPlanStep,
  handleMissionAction,
  handleMissionDiff,
  handleProvideInput,
  handleRequestChanges,
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
    editPlanStep: vi.fn(() =>
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
    approveReview: vi.fn(ok),
    requestChanges: vi.fn(() => Promise.resolve({ ok: true as const, data: { id: 'e2' } })),
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

describe('plano com instrução e edição (missions:plan:v1, missions:edit-plan:v1)', () => {
  const TOO_LONG = 'x'.repeat(1001);

  it('o canal de edição existe com a versão no nome', () => {
    expect(CHANNELS.missionsEditPlan).toBe('missions:edit-plan:v1');
  });

  it('plan repassa a instrução aparada ao orquestrador', async () => {
    const orchestrator = spyOrchestrator();

    await handleMissionAction(orchestrator, 'plan', {
      missionId: 'm1',
      instruction: '  inclua testes  ',
    });

    expect(orchestrator.planMission).toHaveBeenCalledWith('m1', { instruction: 'inclua testes' });
  });

  it('plan aceita a instrução de 1000 caracteres e recusa a de 1001, sem chamar o orquestrador', () => {
    const orchestrator = spyOrchestrator();

    void handleMissionAction(orchestrator, 'plan', {
      missionId: 'm1',
      instruction: 'x'.repeat(1000),
    });
    expect(orchestrator.planMission).toHaveBeenCalledTimes(1);

    expect(
      handleMissionAction(orchestrator, 'plan', { missionId: 'm1', instruction: TOO_LONG }),
    ).toMatchObject({ ok: false, error: { code: 'VALIDATION_FAILED' } });
    expect(orchestrator.planMission).toHaveBeenCalledTimes(1);
  });

  it('plan recusa instrução que não é texto', () => {
    const orchestrator = spyOrchestrator();

    expect(
      handleMissionAction(orchestrator, 'plan', { missionId: 'm1', instruction: 5 }),
    ).toMatchObject({ ok: false, error: { code: 'VALIDATION_FAILED' } });
    expect(orchestrator.planMission).not.toHaveBeenCalled();
  });

  it.each([
    [{ op: 'rename', title: 'Novo título' }],
    [{ op: 'rename', title: 'Novo título', description: 'Mais detalhe' }],
    [{ op: 'remove' }],
    [{ op: 'move', toPosition: 2 }],
    [{ op: 'agent', agent: 'claude-code' }],
  ])('editPlanStep repassa a edição válida %j', async (edit) => {
    const orchestrator = spyOrchestrator();

    const result = await handleEditPlanStep(orchestrator, { missionId: 'm1', stepId: 's1', edit });

    expect(orchestrator.editPlanStep).toHaveBeenCalledWith({
      missionId: 'm1',
      stepId: 's1',
      edit,
    });
    expect(result).toEqual({ ok: true, data: { missionId: 'm1', steps: [] } });
  });

  it('editPlanStep apara o título e devolve o erro do orquestrador sem mudar nada', async () => {
    const orchestrator = spyOrchestrator();
    const refusal = {
      ok: false as const,
      error: { code: 'MISSION_INVALID_STATE', message: 'Só a missão planejada.', retryable: false },
    };
    vi.mocked(orchestrator.editPlanStep).mockResolvedValueOnce(refusal as never);

    const result = await handleEditPlanStep(orchestrator, {
      missionId: 'm1',
      stepId: 's1',
      edit: { op: 'rename', title: '  Título  ' },
    });

    expect(orchestrator.editPlanStep).toHaveBeenCalledWith({
      missionId: 'm1',
      stepId: 's1',
      edit: { op: 'rename', title: 'Título' },
    });
    expect(result).toBe(refusal);
  });

  it.each([
    ['op desconhecida', { op: 'duplicate' }],
    ['sem op', { title: 'x' }],
    ['título vazio', { op: 'rename', title: '   ' }],
    ['título com mais de 120 caracteres', { op: 'rename', title: 'x'.repeat(121) }],
    [
      'descrição com mais de 2000 caracteres',
      { op: 'rename', title: 'x', description: 'y'.repeat(2001) },
    ],
    ['posição zero', { op: 'move', toPosition: 0 }],
    ['posição fracionária', { op: 'move', toPosition: 1.5 }],
    ['posição negativa', { op: 'move', toPosition: -1 }],
    ['programa desconhecido', { op: 'agent', agent: 'gpt' }],
  ])('editPlanStep recusa %s sem chamar o orquestrador', (_name, edit) => {
    const orchestrator = spyOrchestrator();

    expect(handleEditPlanStep(orchestrator, { missionId: 'm1', stepId: 's1', edit })).toMatchObject(
      { ok: false, error: { code: 'VALIDATION_FAILED' } },
    );
    expect(orchestrator.editPlanStep).not.toHaveBeenCalled();
  });

  it('editPlanStep recusa missão, tarefa ou edição ausente', () => {
    const orchestrator = spyOrchestrator();

    for (const payload of [
      { stepId: 's1', edit: { op: 'remove' } },
      { missionId: 'm1', edit: { op: 'remove' } },
      { missionId: 'm1', stepId: 's1' },
      undefined,
    ]) {
      expect(handleEditPlanStep(orchestrator, payload)).toMatchObject({
        ok: false,
        error: { code: 'VALIDATION_FAILED' },
      });
    }
    expect(orchestrator.editPlanStep).not.toHaveBeenCalled();
  });

  it('os canais do plano recusam remetente de outra origem e atendem o aplicativo (R65)', async () => {
    const fake = fakeRegistry();
    const orchestrator = spyOrchestrator();
    registerMissionHandlers(fake.registry, isTrusted, {
      orchestrator,
      createDeps: {} as CreateMissionDeps,
      queryDeps: { repo: {}, projects: {} } as unknown as MissionQueryDeps,
      diffDeps: { repo: {}, diff: {} } as unknown as MissionDiffDeps,
      deleteDeps: { repo: {}, projects: {}, worktrees: {}, fs: {} } as unknown as DeleteMissionDeps,
    });
    const payload = { missionId: 'm1', stepId: 's1', edit: { op: 'remove' } };
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      const refused = await fake.call(CHANNELS.missionsEditPlan, 'https://site.invalido/', payload);
      expect(refused).toMatchObject({ ok: false, error: { code: 'PERMISSION_DENIED' } });
      expect(orchestrator.editPlanStep).not.toHaveBeenCalled();

      const served = await fake.call(CHANNELS.missionsEditPlan, 'file:///app/index.html', payload);
      expect(served).toMatchObject({ ok: true });
      expect(orchestrator.editPlanStep).toHaveBeenCalledWith(payload);

      await fake.call(CHANNELS.missionsPlan, 'file:///app/index.html', {
        missionId: 'm1',
        instruction: 'mais testes',
      });
      expect(orchestrator.planMission).toHaveBeenCalledWith('m1', { instruction: 'mais testes' });
    } finally {
      error.mockRestore();
    }
  });
});

describe('revisão da conclusão (missions:approve-review:v1, missions:request-changes:v1)', () => {
  it('os canais existem com a versão no nome', () => {
    expect(CHANNELS.missionsApproveReview).toBe('missions:approve-review:v1');
    expect(CHANNELS.missionsRequestChanges).toBe('missions:request-changes:v1');
  });

  it('aprovar a revisão repassa o id ao orquestrador', async () => {
    const orchestrator = spyOrchestrator();

    await handleMissionAction(orchestrator, 'approveReview', { missionId: 'm1' });

    expect(orchestrator.approveReview).toHaveBeenCalledWith('m1');
  });

  it('pedir ajustes recusa texto vazio ou em branco, sem chamar o orquestrador', () => {
    const orchestrator = spyOrchestrator();

    for (const feedback of ['', '   ']) {
      expect(handleRequestChanges(orchestrator, { missionId: 'm1', feedback })).toMatchObject({
        ok: false,
        error: { code: 'VALIDATION_FAILED' },
      });
    }
    expect(orchestrator.requestChanges).not.toHaveBeenCalled();
  });

  it('pedir ajustes repassa o pedido ao orquestrador', async () => {
    const orchestrator = spyOrchestrator();

    await handleRequestChanges(orchestrator, { missionId: 'm1', feedback: 'Trocar a função' });

    expect(orchestrator.requestChanges).toHaveBeenCalledWith({
      missionId: 'm1',
      feedback: 'Trocar a função',
    });
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
      diffDeps: { repo: {}, diff: {} } as unknown as MissionDiffDeps,
      deleteDeps: { repo: {}, projects: {}, worktrees: {}, fs: {} } as unknown as DeleteMissionDeps,
    });
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
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
    } finally {
      error.mockRestore();
    }
  });
});

describe('alterações da missão (missions:diff:v1)', () => {
  it('recusa o id ausente sem consultar a aplicação', async () => {
    const diff = vi.fn();
    const deps = { repo: { getMission: vi.fn() }, diff: { diff } } as unknown as MissionDiffDeps;

    const result = await handleMissionDiff(deps, {});

    expect(result).toMatchObject({ ok: false, error: { code: 'VALIDATION_FAILED' } });
    expect(diff).not.toHaveBeenCalled();
  });

  it('entrega o caminho do worktree da missão à leitura e devolve o diff', async () => {
    const getMission = vi.fn(() => ({ id: 'm1', worktreePath: 'C:\\worktrees\\app\\m1' }));
    const diff = vi.fn(() => Promise.resolve({ files: [], truncatedFiles: false }));
    const deps = { repo: { getMission }, diff: { diff } } as unknown as MissionDiffDeps;

    const result = await handleMissionDiff(deps, { missionId: 'm1' });

    expect(diff).toHaveBeenCalledWith('C:\\worktrees\\app\\m1');
    expect(result).toEqual({ ok: true, data: { files: [], truncatedFiles: false } });
  });
});

describe('excluir missão (missions:delete:v1)', () => {
  it('o canal existe com a versão no nome', () => {
    expect(CHANNELS.missionsDelete).toBe('missions:delete:v1');
  });

  it('recusa o id ausente sem consultar a aplicação', async () => {
    const repo = { getMission: vi.fn(), deleteMission: vi.fn() };
    const deps = { repo, projects: {}, worktrees: {}, fs: {} } as unknown as DeleteMissionDeps;

    expect(await handleDeleteMission(deps, {})).toMatchObject({
      ok: false,
      error: { code: 'VALIDATION_FAILED' },
    });
    expect(repo.getMission).not.toHaveBeenCalled();
    expect(repo.deleteMission).not.toHaveBeenCalled();
  });

  it('entrega o id à aplicação, que recusa missão inexistente sem apagar nada', async () => {
    const repo = { getMission: vi.fn(() => undefined), deleteMission: vi.fn() };
    const deps = { repo, projects: {}, worktrees: {}, fs: {} } as unknown as DeleteMissionDeps;

    expect(await handleDeleteMission(deps, { missionId: 'm1' })).toMatchObject({
      ok: false,
      error: { code: 'MISSION_NOT_FOUND' },
    });
    expect(repo.getMission).toHaveBeenCalledWith('m1');
    expect(repo.deleteMission).not.toHaveBeenCalled();
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
      diffDeps: { repo: {}, diff: {} } as unknown as MissionDiffDeps,
      deleteDeps: { repo: {}, projects: {}, worktrees: {}, fs: {} } as unknown as DeleteMissionDeps,
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
