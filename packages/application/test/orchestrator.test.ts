import type { AppResult } from '@project-hub/contracts';
import type { Execution, Mission } from '@project-hub/domain';
import { describe, expect, it } from 'vitest';
import { createOrchestrator, type Orchestrator } from '../src/missions/orchestrator';
import { fakeRepository } from './fakes';
import { fakeAgent, type FakeAgent, type FakeStep } from './fake-agent';
import {
  fakeMissionRepository,
  fakeWorktrees,
  type FakeMissionRepository,
  type FakeWorktrees,
} from './fakes-missions';

const T0 = '2026-10-20T09:00:00.000Z';

type HarnessOptions = {
  scripts?: FakeStep[][];
  failStart?: boolean;
  worktreeFailure?: { code: string; message: string };
  repositoryKind?: 'git' | 'none';
};

type Harness = {
  repo: FakeMissionRepository;
  worktrees: FakeWorktrees;
  agent: FakeAgent;
  orchestrator: Orchestrator;
};

function harness(options: HarnessOptions = {}): Harness {
  const repo = fakeMissionRepository();
  const projects = fakeRepository();
  projects.insert({
    id: 'p1',
    name: 'app',
    path: 'C:\\dev\\app',
    normalizedPath: 'c:/dev/app',
    repositoryKind: options.repositoryKind ?? 'git',
    defaultBranch: 'main',
    createdAt: T0,
  });
  const worktrees = fakeWorktrees(options.worktreeFailure);
  const agent = fakeAgent(options.scripts ?? [], { failStart: options.failStart === true });
  let tick = 0;
  let ids = 0;
  const orchestrator = createOrchestrator({
    repo,
    projects,
    worktrees,
    worktreeNames: ({ missionId }) => ({
      missionShortId: missionId.slice(0, 8),
      slug: 'ajustar-login',
      branch: `ph/${missionId.slice(0, 8)}-ajustar-login`,
      relativeDir: `app/${missionId.slice(0, 8)}-ajustar-login`,
    }),
    worktreesRoot: 'C:\\hub\\worktrees',
    agent,
    now: () => new Date(Date.UTC(2026, 9, 20, 10, 0, tick++)).toISOString(),
    newId: () => `id-${++ids}`,
  });
  return { repo, worktrees, agent, orchestrator };
}

function missionFixture(overrides: Partial<Mission> = {}): Mission {
  return {
    id: 'missao-1-abcdef',
    projectId: 'p1',
    title: 'Ajustar login',
    objective: 'Corrigir o login',
    acceptanceCriteria: [
      { id: 'c1', position: 1, text: 'Login funciona' },
      { id: 'c2', position: 2, text: 'Testes passam' },
    ],
    status: 'queued',
    priority: 'normal',
    agentProfileId: 'simulado',
    executionProfileId: 'padrao',
    altersCode: false,
    createdAt: T0,
    updatedAt: T0,
    ...overrides,
  };
}

/** Dado do resultado; falha o teste com a mensagem do erro se o resultado for uma falha. */
function data<T>(result: AppResult<T>): T {
  if (!result.ok) throw new Error(`esperava sucesso: ${result.error.code} ${result.error.message}`);
  return result.data;
}

/** Código da falha; falha o teste se o resultado for um sucesso. */
function codeOf(result: AppResult<unknown>): string {
  if (result.ok) throw new Error('esperava falha, veio sucesso');
  return result.error.code;
}

const MISSION = 'missao-1-abcdef';

describe('planMission e approvePlan', () => {
  it('gera um passo por critério, grava o plano e leva a missão a planned', async () => {
    const h = harness();
    h.repo.insertMission(missionFixture({ status: 'draft' }));

    const plan = data(await h.orchestrator.planMission(MISSION));

    expect(plan.steps.map((step) => [step.position, step.title])).toEqual([
      [1, 'Login funciona'],
      [2, 'Testes passam'],
    ]);
    expect(h.repo.steps().map((step) => step.missionId)).toEqual([MISSION, MISSION]);
    expect(h.repo.getMission(MISSION)?.status).toBe('planned');
  });

  it('não planeja de novo uma missão que já saiu de draft', async () => {
    const h = harness();
    h.repo.insertMission(missionFixture({ status: 'planned' }));

    expect(codeOf(await h.orchestrator.planMission(MISSION))).toBe('MISSION_INVALID_STATE');
  });

  it('recusa planejar uma missão sem critério de aceite', async () => {
    const h = harness();
    h.repo.insertMission(missionFixture({ status: 'draft', acceptanceCriteria: [] }));

    expect(codeOf(await h.orchestrator.planMission(MISSION))).toBe('VALIDATION_FAILED');
    expect(h.repo.getMission(MISSION)?.status).toBe('draft');
  });

  it('missão inexistente retorna MISSION_NOT_FOUND', async () => {
    const h = harness();

    expect(codeOf(await h.orchestrator.planMission('nao-existe'))).toBe('MISSION_NOT_FOUND');
  });

  it('aprova um plano planned e leva a missão a queued', async () => {
    const h = harness();
    h.repo.insertMission(missionFixture({ status: 'planned' }));

    data(await h.orchestrator.approvePlan(MISSION));

    expect(h.repo.getMission(MISSION)?.status).toBe('queued');
  });

  it('aprovar antes de planejar retorna MISSION_INVALID_STATE', async () => {
    const h = harness();
    h.repo.insertMission(missionFixture({ status: 'draft' }));

    expect(codeOf(await h.orchestrator.approvePlan(MISSION))).toBe('MISSION_INVALID_STATE');
  });
});

describe('startMission', () => {
  it('iniciar antes de aprovar o plano retorna MISSION_INVALID_STATE', async () => {
    const h = harness();
    h.repo.insertMission(missionFixture({ status: 'planned' }));

    expect(codeOf(await h.orchestrator.startMission(MISSION))).toBe('MISSION_INVALID_STATE');
    expect(h.repo.getMission(MISSION)?.status).toBe('planned');
    expect(h.agent.starts).toHaveLength(0);
  });

  it('missão que altera código sem Git retorna PROJECT_WITHOUT_GIT', async () => {
    const h = harness({ repositoryKind: 'none' });
    h.repo.insertMission(missionFixture({ altersCode: true }));

    expect(codeOf(await h.orchestrator.startMission(MISSION))).toBe('PROJECT_WITHOUT_GIT');
    expect(h.repo.getMission(MISSION)?.status).toBe('queued');
    expect(h.worktrees.created).toHaveLength(0);
    expect(h.agent.starts).toHaveLength(0);
  });

  it('execução bem-sucedida grava eventos com sequence crescente e termina em succeeded', async () => {
    const h = harness({
      scripts: [
        [
          { kind: 'event', event: { type: 'message.delta', content: 'olá' } },
          { kind: 'event', event: { type: 'message.completed', messageId: 'm1' } },
        ],
      ],
    });
    h.repo.insertMission(missionFixture());

    const execution = data(await h.orchestrator.startMission(MISSION));

    expect(execution).toMatchObject({ attempt: 1, status: 'succeeded', exitReason: 'completed' });
    expect(h.repo.getMission(MISSION)?.status).toBe('succeeded');
    const executionEvents = h.repo.audit().filter((e) => e.aggregateId === execution.id);
    expect(executionEvents.map((e) => e.sequence)).toEqual(
      executionEvents.map((_, index) => index + 1),
    );
    expect(executionEvents.map((e) => e.eventType)).toEqual(
      expect.arrayContaining(['session.started', 'message.delta', 'session.completed']),
    );
  });

  it('cada transição de missão é auditada, na ordem em que aconteceu', async () => {
    const h = harness({ scripts: [[]] });
    h.repo.insertMission(missionFixture());

    data(await h.orchestrator.startMission(MISSION));

    const transitions = h.repo
      .audit()
      .filter((e) => e.aggregateId === MISSION && e.eventType === 'mission.status_changed')
      .map((e) => e.payload);
    expect(transitions).toEqual([
      { from: 'queued', to: 'running' },
      { from: 'running', to: 'succeeded' },
    ]);
  });

  it('altera código: cria o worktree, grava o caminho e roda o agente nele', async () => {
    const h = harness({ scripts: [[]] });
    h.repo.insertMission(missionFixture({ altersCode: true }));

    data(await h.orchestrator.startMission(MISSION));

    const created = h.worktrees.created[0];
    expect(created).toMatchObject({
      repoPath: 'C:\\dev\\app',
      worktreesRoot: 'C:\\hub\\worktrees',
      baseRef: 'main',
      names: { branch: 'ph/missao-1-ajustar-login' },
    });
    const worktreePath = `C:\\hub\\worktrees/app/missao-1-ajustar-login`;
    expect(h.repo.getMission(MISSION)).toMatchObject({ worktreePath });
    expect(h.agent.starts[0]?.cwd).toBe(worktreePath);
  });

  it('falha ao criar o worktree devolve o código da falha e deixa a missão em queued', async () => {
    const h = harness({
      scripts: [[]],
      worktreeFailure: { code: 'WORKTREE_COLLISION', message: 'Já existe um worktree.' },
    });
    h.repo.insertMission(missionFixture({ altersCode: true }));

    expect(codeOf(await h.orchestrator.startMission(MISSION))).toBe('WORKTREE_COLLISION');
    expect(h.repo.getMission(MISSION)?.status).toBe('queued');
    expect(h.repo.listExecutions(MISSION)).toHaveLength(0);
    expect(h.agent.starts).toHaveLength(0);
  });

  it('agente indisponível devolve AGENT_UNAVAILABLE e deixa a missão em queued', async () => {
    const h = harness({ failStart: true });
    h.repo.insertMission(missionFixture());

    expect(codeOf(await h.orchestrator.startMission(MISSION))).toBe('AGENT_UNAVAILABLE');
    expect(h.repo.getMission(MISSION)?.status).toBe('queued');
    expect(h.repo.listExecutions(MISSION)).toHaveLength(0);
  });

  it('falha do agente leva execução e missão a failed com exitReason agent_failed', async () => {
    const h = harness({ scripts: [[{ kind: 'fail', message: 'Falhou.' }]] });
    h.repo.insertMission(missionFixture());

    const execution = data(await h.orchestrator.startMission(MISSION));

    expect(execution).toMatchObject({ status: 'failed', exitReason: 'agent_failed' });
    expect(h.repo.getMission(MISSION)?.status).toBe('failed');
  });

  it('erro inesperado do agente termina em failed com exitReason agent_failed', async () => {
    const h = harness({ scripts: [[{ kind: 'throw' }]] });
    h.repo.insertMission(missionFixture());

    const execution = data(await h.orchestrator.startMission(MISSION));

    expect(execution).toMatchObject({ status: 'failed', exitReason: 'agent_failed' });
    expect(h.repo.getMission(MISSION)?.status).toBe('failed');
  });

  it('agente que encerra sem concluir termina em failed', async () => {
    const h = harness({ scripts: [[{ kind: 'end' }]] });
    h.repo.insertMission(missionFixture());

    const execution = data(await h.orchestrator.startMission(MISSION));

    expect(execution).toMatchObject({ status: 'failed', exitReason: 'agent_failed' });
  });

  it('aprovação pendente deixa a missão em waiting_approval; cancelar encerra a execução e chama stop()', async () => {
    const h = harness({
      scripts: [
        [
          { kind: 'event', event: { type: 'message.delta', content: 'antes' } },
          { kind: 'approval' },
          { kind: 'event', event: { type: 'message.delta', content: 'nunca' } },
        ],
      ],
    });
    h.repo.insertMission(missionFixture());

    const execution = data(await h.orchestrator.startMission(MISSION));

    expect(execution.status).toBe('running');
    expect(h.repo.getMission(MISSION)?.status).toBe('waiting_approval');
    expect(h.repo.approvals()).toMatchObject([{ status: 'pending', missionId: MISSION }]);

    data(await h.orchestrator.cancelMission(MISSION));

    expect(h.repo.getMission(MISSION)?.status).toBe('cancelled');
    expect(h.repo.getExecution(execution.id)).toMatchObject({
      status: 'cancelled',
      exitReason: 'cancelled_by_user',
    });
    expect(h.repo.approvals()[0]?.status).toBe('expired');
    expect(h.agent.sessions[0]?.stopReasons).toHaveLength(1);
    const payloads = h.repo
      .audit()
      .filter((e) => e.aggregateId === execution.id && e.eventType === 'message.delta')
      .map((e) => e.payload);
    // Só o delta anterior à aprovação foi emitido: o que vem depois do pedido nunca chega.
    expect(payloads).toEqual([expect.objectContaining({ content: 'antes' })]);
  });

  it('aprovação aprovada retoma a execução até o fim', async () => {
    const h = harness({ scripts: [[{ kind: 'approval' }]] });
    h.repo.insertMission(missionFixture());
    await h.orchestrator.startMission(MISSION);
    const approvalId = h.repo.approvals()[0]?.id ?? '';

    data(await h.orchestrator.decideApproval({ approvalId, decision: 'approved' }));

    expect(h.repo.getMission(MISSION)?.status).toBe('succeeded');
    expect(h.repo.approvals()[0]).toMatchObject({ status: 'approved' });
    expect(h.agent.sessions[0]?.decisions).toEqual([{ decision: 'approved' }]);
  });

  it('aprovação rejeitada leva a execução e a missão a failed com approval_rejected', async () => {
    const h = harness({ scripts: [[{ kind: 'approval' }]] });
    h.repo.insertMission(missionFixture());
    await h.orchestrator.startMission(MISSION);
    const approvalId = h.repo.approvals()[0]?.id ?? '';

    data(
      await h.orchestrator.decideApproval({
        approvalId,
        decision: 'rejected',
        note: 'não nesta pasta',
      }),
    );

    expect(h.repo.getMission(MISSION)?.status).toBe('failed');
    const [execution] = h.repo.listExecutions(MISSION);
    expect(execution).toMatchObject({ status: 'failed', exitReason: 'approval_rejected' });
    expect(h.agent.sessions[0]?.decisions).toEqual([
      { decision: 'rejected', note: 'não nesta pasta' },
    ]);
    expect(h.agent.sessions[0]?.stopReasons).toHaveLength(1);
    const transitions = h.repo
      .audit()
      .filter((e) => e.aggregateId === MISSION && e.eventType === 'mission.status_changed')
      .map((e) => e.payload);
    expect(transitions).toEqual([
      { from: 'queued', to: 'running' },
      { from: 'running', to: 'waiting_approval' },
      { from: 'waiting_approval', to: 'running' },
      { from: 'running', to: 'failed' },
    ]);
  });

  it('pedido de entrada deixa a missão em waiting_input até provideInput', async () => {
    const h = harness({
      scripts: [
        [{ kind: 'input' }, { kind: 'event', event: { type: 'message.delta', content: 'ok' } }],
      ],
    });
    h.repo.insertMission(missionFixture());

    const waiting = data(await h.orchestrator.startMission(MISSION));

    expect(waiting.status).toBe('running');
    expect(h.repo.getMission(MISSION)?.status).toBe('waiting_input');

    data(await h.orchestrator.provideInput({ missionId: MISSION, text: 'use a opção B' }));

    expect(h.repo.getMission(MISSION)?.status).toBe('succeeded');
    expect(h.agent.sessions[0]?.inputs).toEqual([{ text: 'use a opção B' }]);
  });

  it('provideInput sem pedido pendente retorna MISSION_INVALID_STATE', async () => {
    const h = harness({ scripts: [[]] });
    h.repo.insertMission(missionFixture());

    expect(codeOf(await h.orchestrator.provideInput({ missionId: MISSION, text: 'x' }))).toBe(
      'MISSION_INVALID_STATE',
    );
  });
});

describe('cancelMission', () => {
  it('cancela missão em fila sem chamar o agente', async () => {
    const h = harness();
    h.repo.insertMission(missionFixture());

    data(await h.orchestrator.cancelMission(MISSION));

    expect(h.repo.getMission(MISSION)?.status).toBe('cancelled');
    expect(h.agent.starts).toHaveLength(0);
  });

  it('missão já encerrada não pode ser cancelada', async () => {
    const h = harness({ scripts: [[]] });
    h.repo.insertMission(missionFixture());
    await h.orchestrator.startMission(MISSION);

    expect(codeOf(await h.orchestrator.cancelMission(MISSION))).toBe('MISSION_INVALID_STATE');
    expect(h.repo.getMission(MISSION)?.status).toBe('succeeded');
  });
});

describe('retryMission', () => {
  it('nova tentativa cria attempt 2 e preserva a attempt 1', async () => {
    const h = harness({
      scripts: [[{ kind: 'fail', message: 'Falhou.' }], []],
    });
    h.repo.insertMission(missionFixture());
    const first = data(await h.orchestrator.startMission(MISSION));

    const second = data(await h.orchestrator.retryMission(MISSION));

    expect(second).toMatchObject({ attempt: 2, status: 'succeeded' });
    const attempts = h.repo.listExecutions(MISSION);
    expect(attempts.map((e) => [e.attempt, e.status])).toEqual([
      [1, 'failed'],
      [2, 'succeeded'],
    ]);
    expect(attempts[0]).toMatchObject({ id: first.id, exitReason: 'agent_failed' });
    expect(h.repo.getMission(MISSION)?.status).toBe('succeeded');
  });

  it('retry reaproveita o worktree da missão, sem criar outro', async () => {
    const h = harness({ scripts: [[{ kind: 'fail', message: 'Falhou.' }], []] });
    h.repo.insertMission(missionFixture({ altersCode: true }));
    await h.orchestrator.startMission(MISSION);

    data(await h.orchestrator.retryMission(MISSION));

    expect(h.worktrees.created).toHaveLength(1);
    expect(h.agent.starts[1]?.cwd).toBe(h.agent.starts[0]?.cwd);
  });

  it('retry de missão em andamento retorna MISSION_INVALID_STATE', async () => {
    const h = harness({ scripts: [[{ kind: 'approval' }]] });
    h.repo.insertMission(missionFixture());
    await h.orchestrator.startMission(MISSION);

    expect(codeOf(await h.orchestrator.retryMission(MISSION))).toBe('MISSION_INVALID_STATE');
    expect(h.repo.getMission(MISSION)?.status).toBe('waiting_approval');
  });
});

describe('decideApproval', () => {
  it('aprovação desconhecida retorna APPROVAL_NOT_FOUND', async () => {
    const h = harness();

    expect(
      codeOf(
        await h.orchestrator.decideApproval({ approvalId: 'nao-existe', decision: 'approved' }),
      ),
    ).toBe('APPROVAL_NOT_FOUND');
  });

  it('decidir uma aprovação que já foi decidida retorna MISSION_INVALID_STATE', async () => {
    const h = harness({ scripts: [[{ kind: 'approval' }]] });
    h.repo.insertMission(missionFixture());
    await h.orchestrator.startMission(MISSION);
    const approvalId = h.repo.approvals()[0]?.id ?? '';
    data(await h.orchestrator.decideApproval({ approvalId, decision: 'approved' }));

    expect(codeOf(await h.orchestrator.decideApproval({ approvalId, decision: 'rejected' }))).toBe(
      'MISSION_INVALID_STATE',
    );
  });
});

describe('estado da missão ao iniciar', () => {
  it('a execução criada aparece como running até o agente terminar', async () => {
    const h = harness({ scripts: [[{ kind: 'approval' }]] });
    h.repo.insertMission(missionFixture());

    const execution: Execution = data(await h.orchestrator.startMission(MISSION));

    expect(h.repo.getExecution(execution.id)).toMatchObject({
      status: 'running',
      attempt: 1,
      missionId: MISSION,
    });
    expect(h.repo.getMission(MISSION)?.startedAt).toBeDefined();
  });
});

describe('missão inexistente', () => {
  it('startMission retorna MISSION_NOT_FOUND', async () => {
    const h = harness();

    expect(codeOf(await h.orchestrator.startMission('nao-existe'))).toBe('MISSION_NOT_FOUND');
  });

  it('startMission não grava nenhuma mudança quando a missão não existe', async () => {
    const h = harness();
    await h.orchestrator.startMission('nao-existe');

    expect(h.repo.audit()).toHaveLength(0);
    expect(h.agent.starts).toHaveLength(0);
  });
});
