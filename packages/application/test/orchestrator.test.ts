import type { AppResult, MissionDiffDto } from '@project-hub/contracts';
import type { AuditEvent, Execution, Mission } from '@project-hub/domain';
import { describe, expect, it, vi } from 'vitest';
import { createOrchestrator, type Orchestrator } from '../src/missions/orchestrator';
import { fakeRepository } from './fakes';
import { fakeAgent, type FakeAgent, type FakeStep } from './fake-agent';
import {
  fakeMissionRepository,
  fakePlanner,
  fakeWorktrees,
  type FakeMissionRepository,
  type FakePlanner,
  type FakeWorktrees,
} from './fakes-missions';
import type { PlannedTask } from '../src/missions/plan-validation';

const T0 = '2026-10-20T09:00:00.000Z';

type HarnessOptions = {
  scripts?: FakeStep[][];
  failStarts?: number;
  failDelivery?: boolean;
  failStop?: boolean;
  failPause?: boolean;
  failResume?: boolean;
  pauseResume?: boolean;
  worktreeFailure?: { code: string; message: string };
  repositoryKind?: 'git' | 'none';
  /** Lê as alterações do worktree ao concluir. Sem ele, a missão conclui sem o resumo de arquivos. */
  diff?: (worktreePath: string) => Promise<MissionDiffDto>;
  /** Planejador do plano. Sem ele, o plano sai um passo por critério. */
  planner?: FakePlanner;
  /** Consulta à pasta do projeto. Sem ela, a pasta não é conferida. */
  isDirectory?: (path: string) => Promise<boolean>;
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
  const agent = fakeAgent(options.scripts ?? [], {
    failStarts: options.failStarts ?? 0,
    failDelivery: options.failDelivery === true,
    failStop: options.failStop === true,
    failPause: options.failPause === true,
    failResume: options.failResume === true,
    pauseResume: options.pauseResume !== false,
  });
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
    ...(options.diff === undefined ? {} : { diff: { diff: options.diff } }),
    ...(options.planner === undefined ? {} : { planner: options.planner }),
    ...(options.isDirectory === undefined ? {} : { fs: { isDirectory: options.isDirectory } }),
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
const WORKTREE_PATH = 'C:\\hub\\worktrees/app/missao-1-ajustar-login';

/** Eventos `execution.failed` da execução na auditoria. */
function executionFailedEvents(h: Harness, executionId: string | undefined): AuditEvent[] {
  return h.repo
    .audit()
    .filter((e) => e.aggregateId === executionId && e.eventType === 'execution.failed');
}

/** Execução `running` sem processo de agente: restou de um cancelamento que não a fechou. */
function orphanExecution(): Execution {
  return { id: 'exec-orfa', missionId: MISSION, attempt: 1, status: 'running', startedAt: T0 };
}

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

  it('replanejar uma missão planned troca as etapas e mantém a missão em planned (R161)', async () => {
    const h = harness();
    h.repo.insertMission(missionFixture({ status: 'draft' }));
    data(await h.orchestrator.planMission(MISSION));

    const again = data(await h.orchestrator.planMission(MISSION));

    expect(again.steps.map((step) => step.title)).toEqual(['Login funciona', 'Testes passam']);
    expect(h.repo.listSteps(MISSION).map((step) => step.title)).toEqual([
      'Login funciona',
      'Testes passam',
    ]);
    expect(h.repo.getMission(MISSION)?.status).toBe('planned');
    expect(h.repo.audit().filter((e) => e.eventType === 'plan.generated')).toHaveLength(2);
  });

  it('não planeja uma missão que já foi aprovada para a fila', async () => {
    const h = harness();
    h.repo.insertMission(missionFixture({ status: 'queued' }));

    expect(codeOf(await h.orchestrator.planMission(MISSION))).toBe('MISSION_INVALID_STATE');
    expect(h.repo.getMission(MISSION)?.status).toBe('queued');
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

const PLANNED_TASKS: PlannedTask[] = [
  { title: 'Ler o código', description: 'Entender o login', role: 'docs', dependsOn: [] },
  {
    title: 'Corrigir o login',
    description: 'Ajustar a regra',
    role: 'backend',
    dependsOn: [1],
  },
  { title: 'Rodar os testes', description: '', role: 'qa', dependsOn: [1, 2] },
];

const OK_PLAN: AppResult<PlannedTask[]> = { ok: true, data: PLANNED_TASKS };

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve: (value: T) => void = () => undefined;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

describe('planMission com o planejador', () => {
  it('grava as tarefas do planejador com papel e dependências e leva draft a planned', async () => {
    const planner = fakePlanner(() => OK_PLAN);
    const h = harness({ planner });
    h.repo.insertMission(missionFixture({ status: 'draft' }));

    const plan = data(await h.orchestrator.planMission(MISSION));

    expect(plan.steps.map((step) => [step.position, step.title, step.role])).toEqual([
      [1, 'Ler o código', 'docs'],
      [2, 'Corrigir o login', 'backend'],
      [3, 'Rodar os testes', 'qa'],
    ]);
    const stored = h.repo.listSteps(MISSION);
    expect(stored).toHaveLength(3);
    expect(stored[2]?.dependsOn).toEqual([stored[0]?.id, stored[1]?.id]);
    expect(h.repo.getMission(MISSION)?.status).toBe('planned');
    expect(planner.calls).toHaveLength(1);
    expect(planner.calls[0]).toMatchObject({
      objective: 'Corrigir o login',
      criteria: ['Login funciona', 'Testes passam'],
      cwd: 'C:\\dev\\app',
    });
    expect(planner.calls[0]?.instruction).toBeUndefined();
    const generated = h.repo.audit().find((e) => e.eventType === 'plan.generated');
    expect(generated?.payload).toEqual({
      steps: ['Ler o código', 'Corrigir o login', 'Rodar os testes'],
      source: 'claude',
    });
  });

  it('refaz o plano de uma missão planned com a instrução e troca as etapas', async () => {
    let answer: AppResult<PlannedTask[]> = OK_PLAN;
    const planner = fakePlanner(() => answer);
    const h = harness({ planner });
    h.repo.insertMission(missionFixture({ status: 'draft' }));
    data(await h.orchestrator.planMission(MISSION));
    answer = {
      ok: true,
      data: [{ title: 'Escrever testes', description: '', role: 'qa', dependsOn: [] }],
    };

    const plan = data(await h.orchestrator.planMission(MISSION, { instruction: 'inclua testes' }));

    expect(planner.calls[1]?.instruction).toBe('inclua testes');
    expect(plan.steps.map((step) => step.title)).toEqual(['Escrever testes']);
    expect(h.repo.listSteps(MISSION).map((step) => step.title)).toEqual(['Escrever testes']);
    expect(h.repo.getMission(MISSION)?.status).toBe('planned');
    const generated = h.repo.audit().filter((e) => e.eventType === 'plan.generated');
    expect(generated).toHaveLength(2);
    expect(generated[1]?.payload).toEqual({
      steps: ['Escrever testes'],
      source: 'claude',
      instruction: 'inclua testes',
    });
  });

  it('falha do planejador em planned mantém o plano antigo e registra plan.failed', async () => {
    let answer: AppResult<PlannedTask[]> = OK_PLAN;
    const h = harness({ planner: fakePlanner(() => answer) });
    h.repo.insertMission(missionFixture({ status: 'draft' }));
    data(await h.orchestrator.planMission(MISSION));
    const before = h.repo.listSteps(MISSION);
    answer = {
      ok: false,
      error: {
        code: 'AGENT_UNAVAILABLE',
        message: 'O Claude Code não respondeu.',
        retryable: true,
      },
    };

    const result = await h.orchestrator.planMission(MISSION, { instruction: 'tente de novo' });

    expect(codeOf(result)).toBe('AGENT_UNAVAILABLE');
    expect(h.repo.listSteps(MISSION)).toEqual(before);
    expect(h.repo.getMission(MISSION)?.status).toBe('planned');
    expect(h.repo.audit().filter((e) => e.eventType === 'plan.generated')).toHaveLength(1);
    const failed = h.repo.audit().filter((e) => e.eventType === 'plan.failed');
    expect(failed).toHaveLength(1);
    expect(failed[0]?.severity).toBe('warning');
    expect(failed[0]?.payload).toMatchObject({ message: 'O Claude Code não respondeu.' });
  });

  it('duas chamadas simultâneas: a segunda é recusada e o planejador roda uma vez', async () => {
    const gate = deferred<AppResult<PlannedTask[]>>();
    const planner = fakePlanner(() => gate.promise);
    const h = harness({ planner });
    h.repo.insertMission(missionFixture({ status: 'draft' }));

    const first = h.orchestrator.planMission(MISSION);
    const second = await h.orchestrator.planMission(MISSION);

    expect(codeOf(second)).toBe('MISSION_INVALID_STATE');
    expect(second.ok ? '' : second.error.message).toBe(
      'O plano desta missão já está sendo gerado.',
    );
    gate.resolve(OK_PLAN);
    data(await first);
    expect(planner.calls).toHaveLength(1);
  });

  it('libera a trava quando o planejador falha, e um novo pedido passa', async () => {
    let attempt = 0;
    const planner = fakePlanner(() =>
      ++attempt === 1
        ? { ok: false, error: { code: 'UNKNOWN', message: 'falhou', retryable: false } }
        : OK_PLAN,
    );
    const h = harness({ planner });
    h.repo.insertMission(missionFixture({ status: 'draft' }));

    expect(codeOf(await h.orchestrator.planMission(MISSION))).toBe('UNKNOWN');
    data(await h.orchestrator.planMission(MISSION));
    expect(planner.calls).toHaveLength(2);
  });

  it('libera a trava quando o planejador lança erro', async () => {
    let attempt = 0;
    const planner = fakePlanner(() => {
      if (++attempt === 1) throw new Error('quebrou');
      return OK_PLAN;
    });
    const h = harness({ planner });
    h.repo.insertMission(missionFixture({ status: 'draft' }));

    await expect(h.orchestrator.planMission(MISSION)).rejects.toThrow('quebrou');
    data(await h.orchestrator.planMission(MISSION));
  });

  it('missão cancelada enquanto o planejador aguarda: nada é gravado', async () => {
    const gate = deferred<AppResult<PlannedTask[]>>();
    const planner = fakePlanner(() => gate.promise);
    const h = harness({ planner });
    h.repo.insertMission(missionFixture({ status: 'draft' }));

    const pending = h.orchestrator.planMission(MISSION);
    await vi.waitFor(() => expect(planner.calls).toHaveLength(1));
    h.repo.updateMission(MISSION, { status: 'cancelled' });
    gate.resolve(OK_PLAN);
    const result = await pending;

    expect(codeOf(result)).toBe('MISSION_INVALID_STATE');
    expect(h.repo.listSteps(MISSION)).toEqual([]);
    expect(h.repo.getMission(MISSION)?.status).toBe('cancelled');
    expect(h.repo.audit().filter((e) => e.eventType.startsWith('plan.'))).toEqual([]);
  });

  it('missão apagada enquanto o planejador aguarda: nada é gravado', async () => {
    const gate = deferred<AppResult<PlannedTask[]>>();
    const planner = fakePlanner(() => gate.promise);
    const h = harness({ planner });
    h.repo.insertMission(missionFixture({ status: 'draft' }));

    const pending = h.orchestrator.planMission(MISSION);
    await vi.waitFor(() => expect(planner.calls).toHaveLength(1));
    h.repo.deleteMission(MISSION);
    gate.resolve(OK_PLAN);
    const result = await pending;

    expect(codeOf(result)).toBe('MISSION_NOT_FOUND');
    expect(h.repo.listSteps(MISSION)).toEqual([]);
    expect(h.repo.audit()).toEqual([]);
  });

  it('pasta do projeto indisponível: erro e o planejador não é chamado', async () => {
    const planner = fakePlanner(() => OK_PLAN);
    const h = harness({ planner, isDirectory: () => Promise.resolve(false) });
    h.repo.insertMission(missionFixture({ status: 'draft' }));

    expect(codeOf(await h.orchestrator.planMission(MISSION))).toBe('PROJECT_PATH_UNAVAILABLE');
    expect(planner.calls).toHaveLength(0);
    expect(h.repo.getMission(MISSION)?.status).toBe('draft');
  });

  it('projeto ausente: PROJECT_NOT_FOUND e o planejador não é chamado', async () => {
    const planner = fakePlanner(() => OK_PLAN);
    const h = harness({ planner });
    h.repo.insertMission(missionFixture({ status: 'draft', projectId: 'sumiu' }));

    expect(codeOf(await h.orchestrator.planMission(MISSION))).toBe('PROJECT_NOT_FOUND');
    expect(planner.calls).toHaveLength(0);
  });

  it('plano inválido do planejador vira VALIDATION_FAILED e nada do plano é gravado', async () => {
    const invalid: PlannedTask[] = [
      { title: 'Primeira', description: '', role: 'backend', dependsOn: [2] },
      { title: 'Segunda', description: '', role: 'qa', dependsOn: [] },
    ];
    const h = harness({ planner: fakePlanner(() => ({ ok: true, data: invalid })) });
    h.repo.insertMission(missionFixture({ status: 'draft' }));

    expect(codeOf(await h.orchestrator.planMission(MISSION))).toBe('VALIDATION_FAILED');
    expect(h.repo.listSteps(MISSION)).toEqual([]);
    expect(h.repo.getMission(MISSION)?.status).toBe('draft');
    expect(h.repo.audit().filter((e) => e.eventType === 'plan.generated')).toEqual([]);
  });

  it('sem planejador, o plano continua com um passo por critério', async () => {
    const h = harness({ isDirectory: () => Promise.resolve(false) });
    h.repo.insertMission(missionFixture({ status: 'draft' }));

    const plan = data(await h.orchestrator.planMission(MISSION, { instruction: 'ignorada' }));

    expect(plan.steps.map((step) => step.title)).toEqual(['Login funciona', 'Testes passam']);
    expect(h.repo.getMission(MISSION)?.status).toBe('planned');
  });
});

describe('editPlanStep', () => {
  /** Missão planned com o plano do planejador: 3 tarefas encadeadas. */
  async function plannedHarness(): Promise<{ h: Harness; ids: string[] }> {
    const h = harness({ planner: fakePlanner(() => OK_PLAN) });
    h.repo.insertMission(missionFixture({ status: 'draft' }));
    data(await h.orchestrator.planMission(MISSION));
    return { h, ids: h.repo.listSteps(MISSION).map((step) => step.id) };
  }

  it('renomeia, devolve o plano novo, grava na lista seguinte e audita plan.edited', async () => {
    const { h, ids } = await plannedHarness();

    const plan = data(
      await h.orchestrator.editPlanStep({
        missionId: MISSION,
        stepId: ids[1] as string,
        edit: { op: 'rename', title: '  Corrigir a senha  ' },
      }),
    );

    expect(plan.missionId).toBe(MISSION);
    expect(plan.steps.map((step) => step.title)).toEqual([
      'Ler o código',
      'Corrigir a senha',
      'Rodar os testes',
    ]);
    expect(h.repo.listSteps(MISSION)).toEqual(plan.steps);
    expect(h.repo.listSteps(MISSION).map((step) => step.id)).toEqual(ids);
    const edited = h.repo.audit().filter((e) => e.eventType === 'plan.edited');
    expect(edited).toHaveLength(1);
    expect(edited[0]).toMatchObject({
      aggregateType: 'mission',
      aggregateId: MISSION,
      actor: 'user',
      payload: { op: 'rename', title: 'Corrigir a senha' },
    });
    expect(h.repo.getMission(MISSION)?.status).toBe('planned');
  });

  it('remove uma tarefa e religa as dependências na lista seguinte', async () => {
    const { h, ids } = await plannedHarness();

    data(
      await h.orchestrator.editPlanStep({
        missionId: MISSION,
        stepId: ids[1] as string,
        edit: { op: 'remove' },
      }),
    );

    const stored = h.repo.listSteps(MISSION);
    expect(stored.map((step) => [step.position, step.title])).toEqual([
      [1, 'Ler o código'],
      [2, 'Rodar os testes'],
    ]);
    expect(stored[1]?.dependsOn).toEqual([ids[0]]);
    expect(h.repo.audit().find((e) => e.eventType === 'plan.edited')?.payload).toMatchObject({
      op: 'remove',
      title: 'Corrigir o login',
    });
  });

  it('uma edição inválida não grava nada nem audita', async () => {
    const { h, ids } = await plannedHarness();
    const before = h.repo.listSteps(MISSION);

    const result = await h.orchestrator.editPlanStep({
      missionId: MISSION,
      stepId: ids[2] as string,
      edit: { op: 'move', toPosition: 1 },
    });

    expect(codeOf(result)).toBe('VALIDATION_FAILED');
    expect(h.repo.listSteps(MISSION)).toEqual(before);
    expect(h.repo.audit().filter((e) => e.eventType === 'plan.edited')).toEqual([]);
  });

  it('tarefa que não está no plano devolve VALIDATION_FAILED', async () => {
    const { h } = await plannedHarness();

    const result = await h.orchestrator.editPlanStep({
      missionId: MISSION,
      stepId: 'outra',
      edit: { op: 'remove' },
    });

    expect(codeOf(result)).toBe('VALIDATION_FAILED');
  });

  it('só edita com a missão planned: em running devolve MISSION_INVALID_STATE', async () => {
    const h = harness();
    h.repo.insertMission(missionFixture({ status: 'running' }));
    h.repo.insertSteps([
      {
        id: 's1',
        missionId: MISSION,
        position: 1,
        title: 'Única',
        description: '',
        kind: 'custom',
        status: 'pending',
        dependsOn: [],
        agent: 'claude-code',
      },
    ]);

    const result = await h.orchestrator.editPlanStep({
      missionId: MISSION,
      stepId: 's1',
      edit: { op: 'rename', title: 'Outra' },
    });

    expect(codeOf(result)).toBe('MISSION_INVALID_STATE');
    expect(h.repo.listSteps(MISSION)[0]?.title).toBe('Única');
    expect(h.repo.audit().filter((e) => e.eventType === 'plan.edited')).toEqual([]);
  });

  it('missão em rascunho também é recusada, e missão inexistente devolve MISSION_NOT_FOUND', async () => {
    const h = harness();
    h.repo.insertMission(missionFixture({ status: 'draft' }));
    const edit = { op: 'remove' } as const;

    expect(
      codeOf(await h.orchestrator.editPlanStep({ missionId: MISSION, stepId: 's1', edit })),
    ).toBe('MISSION_INVALID_STATE');
    expect(
      codeOf(await h.orchestrator.editPlanStep({ missionId: 'nao-existe', stepId: 's1', edit })),
    ).toBe('MISSION_NOT_FOUND');
  });

  it('recusa editar enquanto o plano está sendo gerado, e o plano novo não é sobrescrito', async () => {
    const gate = deferred<AppResult<PlannedTask[]>>();
    let calls = 0;
    const planner = fakePlanner(() => (++calls === 1 ? OK_PLAN : gate.promise));
    const h = harness({ planner });
    h.repo.insertMission(missionFixture({ status: 'draft' }));
    data(await h.orchestrator.planMission(MISSION));
    const ids = h.repo.listSteps(MISSION).map((step) => step.id);

    const replanning = h.orchestrator.planMission(MISSION, { instruction: 'de novo' });
    const result = await h.orchestrator.editPlanStep({
      missionId: MISSION,
      stepId: ids[0] as string,
      edit: { op: 'rename', title: 'Editada no meio' },
    });

    expect(codeOf(result)).toBe('MISSION_INVALID_STATE');
    expect(result.ok ? '' : result.error.message).toBe(
      'O plano está sendo gerado de novo. Espere terminar para editar.',
    );
    gate.resolve({
      ok: true,
      data: [{ title: 'Plano novo', description: '', role: 'general', dependsOn: [] }],
    });
    data(await replanning);
    expect(h.repo.listSteps(MISSION).map((step) => step.title)).toEqual(['Plano novo']);
    expect(h.repo.audit().filter((e) => e.eventType === 'plan.edited')).toEqual([]);
  });

  it('libera a edição depois que o planejamento termina', async () => {
    const { h, ids } = await plannedHarness();

    data(
      await h.orchestrator.editPlanStep({
        missionId: MISSION,
        stepId: ids[0] as string,
        edit: { op: 'agent', agent: 'claude-code' },
      }),
    );

    expect(h.repo.audit().filter((e) => e.eventType === 'plan.edited')).toHaveLength(1);
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
    expect(h.repo.getMission(MISSION)?.status).toBe('review');
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
      { from: 'running', to: 'review' },
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

  it('missão que não altera código também roda num worktree (R160)', async () => {
    const h = harness({ scripts: [[]] });
    h.repo.insertMission(missionFixture({ altersCode: false }));

    data(await h.orchestrator.startMission(MISSION));

    expect(h.worktrees.created).toHaveLength(1);
    expect(h.agent.starts[0]?.cwd).toBe(WORKTREE_PATH);
    expect(h.repo.getMission(MISSION)?.worktreePath).toBe(WORKTREE_PATH);
  });

  it('missão que não altera código sem Git também retorna PROJECT_WITHOUT_GIT (R160)', async () => {
    const h = harness({ repositoryKind: 'none' });
    h.repo.insertMission(missionFixture({ altersCode: false }));

    expect(codeOf(await h.orchestrator.startMission(MISSION))).toBe('PROJECT_WITHOUT_GIT');
    expect(h.worktrees.created).toHaveLength(0);
    expect(h.agent.starts).toHaveLength(0);
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
    const h = harness({ failStarts: 1 });
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

    expect(h.repo.getMission(MISSION)?.status).toBe('review');
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
    expect(executionFailedEvents(h, execution?.id)).toMatchObject([
      { actor: 'user', severity: 'error', payload: { exitReason: 'approval_rejected' } },
    ]);
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

    expect(h.repo.getMission(MISSION)?.status).toBe('review');
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

  it('missão já concluída não pode ser cancelada, mas a que está em revisão pode', async () => {
    const h = harness({ scripts: [[]] });
    h.repo.insertMission(missionFixture());
    await h.orchestrator.startMission(MISSION);
    data(await h.orchestrator.approveReview(MISSION));

    expect(codeOf(await h.orchestrator.cancelMission(MISSION))).toBe('MISSION_INVALID_STATE');
    expect(h.repo.getMission(MISSION)?.status).toBe('succeeded');
  });
});

describe('worktree da missão (R135)', () => {
  it('worktree criado é gravado na missão antes de o agente iniciar, e a nova tentativa o reaproveita sem WORKTREE_COLLISION', async () => {
    const h = harness({ scripts: [[]], failStarts: 1 });
    h.repo.insertMission(missionFixture({ altersCode: true }));

    expect(codeOf(await h.orchestrator.startMission(MISSION))).toBe('AGENT_UNAVAILABLE');
    expect(h.repo.getMission(MISSION)).toMatchObject({
      status: 'queued',
      worktreePath: WORKTREE_PATH,
      worktreeId: expect.any(String),
    });
    expect(h.repo.audit().filter((e) => e.eventType === 'worktree.created')).toHaveLength(1);

    const execution = data(await h.orchestrator.startMission(MISSION));

    expect(execution).toMatchObject({ attempt: 1, status: 'succeeded' });
    expect(h.worktrees.created).toHaveLength(1);
    expect(h.agent.starts[1]?.cwd).toBe(WORKTREE_PATH);
    expect(h.repo.getMission(MISSION)?.worktreePath).toBe(WORKTREE_PATH);
    expect(h.worktrees.removed).toHaveLength(0);
  });
});

describe('falha na entrega ao agente (R137)', () => {
  it('aprovação que o agente não recebe encerra a execução como agent_failed e grava execution.failed', async () => {
    const h = harness({ scripts: [[{ kind: 'approval' }]], failDelivery: true });
    h.repo.insertMission(missionFixture());
    await h.orchestrator.startMission(MISSION);
    const approvalId = h.repo.approvals()[0]?.id ?? '';

    expect(codeOf(await h.orchestrator.decideApproval({ approvalId, decision: 'approved' }))).toBe(
      'AGENT_UNAVAILABLE',
    );

    const [execution] = h.repo.listExecutions(MISSION);
    expect(execution).toMatchObject({ status: 'failed', exitReason: 'agent_failed' });
    expect(h.repo.getMission(MISSION)?.status).toBe('failed');
    expect(executionFailedEvents(h, execution?.id)).toMatchObject([
      { actor: 'system', severity: 'error', payload: { exitReason: 'agent_failed' } },
    ]);
    expect(h.agent.sessions[0]?.stopReasons).toHaveLength(1);
  });

  it('entrada que o agente não recebe encerra a execução como agent_failed e grava execution.failed', async () => {
    const h = harness({ scripts: [[{ kind: 'input' }]], failDelivery: true });
    h.repo.insertMission(missionFixture());
    await h.orchestrator.startMission(MISSION);

    expect(
      codeOf(await h.orchestrator.provideInput({ missionId: MISSION, text: 'resposta' })),
    ).toBe('AGENT_UNAVAILABLE');

    const [execution] = h.repo.listExecutions(MISSION);
    expect(execution).toMatchObject({ status: 'failed', exitReason: 'agent_failed' });
    expect(h.repo.getMission(MISSION)?.status).toBe('failed');
    expect(executionFailedEvents(h, execution?.id)).toMatchObject([
      { actor: 'system', payload: { exitReason: 'agent_failed' } },
    ]);
  });
});

describe('recusa com entrega que falha (R147)', () => {
  it('a recusa que o agente não recebe devolve AGENT_UNAVAILABLE, grava execution.failed com approval_rejected e deixa a missão em failed', async () => {
    const h = harness({ scripts: [[{ kind: 'approval' }]], failDelivery: true });
    h.repo.insertMission(missionFixture());
    await h.orchestrator.startMission(MISSION);
    const approvalId = h.repo.approvals()[0]?.id ?? '';

    expect(codeOf(await h.orchestrator.decideApproval({ approvalId, decision: 'rejected' }))).toBe(
      'AGENT_UNAVAILABLE',
    );

    const [execution] = h.repo.listExecutions(MISSION);
    expect(execution).toMatchObject({ status: 'failed', exitReason: 'approval_rejected' });
    expect(h.repo.getMission(MISSION)?.status).toBe('failed');
    expect(executionFailedEvents(h, execution?.id)).toMatchObject([
      { actor: 'user', severity: 'error', payload: { exitReason: 'approval_rejected' } },
    ]);
  });
});

describe('recusa com falha ao encerrar a sessão ou a execução (R154)', () => {
  it('session.stop que falha na recusa não escapa: devolve AGENT_UNAVAILABLE e deixa a missão em failed', async () => {
    const h = harness({ scripts: [[{ kind: 'approval' }]], failStop: true });
    h.repo.insertMission(missionFixture());
    await h.orchestrator.startMission(MISSION);
    const approvalId = h.repo.approvals()[0]?.id ?? '';

    expect(codeOf(await h.orchestrator.decideApproval({ approvalId, decision: 'rejected' }))).toBe(
      'AGENT_UNAVAILABLE',
    );

    expect(h.repo.getMission(MISSION)?.status).toBe('failed');
    expect(h.repo.listExecutions(MISSION)[0]).toMatchObject({
      status: 'failed',
      exitReason: 'approval_rejected',
    });
  });

  it('falha ao gravar o encerramento da recusa devolve um resultado, sem exceção', async () => {
    const h = harness({ scripts: [[{ kind: 'approval' }]] });
    h.repo.insertMission(missionFixture());
    await h.orchestrator.startMission(MISSION);
    const approvalId = h.repo.approvals()[0]?.id ?? '';
    h.repo.failNextAudit('execution.failed');

    expect(codeOf(await h.orchestrator.decideApproval({ approvalId, decision: 'rejected' }))).toBe(
      'UNKNOWN',
    );
  });
});

describe('cancelamento sem execução ativa (R136)', () => {
  it('fecha as execuções running da missão com o motivo de cancelamento', async () => {
    const h = harness();
    h.repo.insertMission(missionFixture({ status: 'running' }));
    h.repo.insertExecution(orphanExecution());

    data(await h.orchestrator.cancelMission(MISSION));

    expect(h.repo.getMission(MISSION)?.status).toBe('cancelled');
    expect(h.repo.getExecution('exec-orfa')).toMatchObject({
      status: 'cancelled',
      exitReason: 'cancelled_by_user',
    });
    expect(
      h.repo
        .audit()
        .filter((e) => e.aggregateId === 'exec-orfa' && e.eventType === 'execution.cancelled'),
    ).toHaveLength(1);
  });

  it('transação de cancelamento que falha não muda nada, e o cancelamento roda de novo', async () => {
    const h = harness();
    h.repo.insertMission(missionFixture({ status: 'running' }));
    h.repo.insertExecution(orphanExecution());
    h.repo.failNextAudit('execution.cancelled');

    await expect(h.orchestrator.cancelMission(MISSION)).rejects.toThrow(
      'falha simulada na auditoria',
    );
    expect(h.repo.getMission(MISSION)?.status).toBe('running');
    expect(h.repo.getExecution('exec-orfa')?.status).toBe('running');

    data(await h.orchestrator.cancelMission(MISSION));

    expect(h.repo.getExecution('exec-orfa')).toMatchObject({ status: 'cancelled' });
    expect(h.repo.getMission(MISSION)?.status).toBe('cancelled');
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
    expect(h.repo.getMission(MISSION)?.status).toBe('review');
  });

  it('retry reaproveita o worktree da missão, sem criar outro', async () => {
    const h = harness({ scripts: [[{ kind: 'fail', message: 'Falhou.' }], []] });
    h.repo.insertMission(missionFixture({ altersCode: true }));
    await h.orchestrator.startMission(MISSION);

    data(await h.orchestrator.retryMission(MISSION));

    expect(h.worktrees.created).toHaveLength(1);
    expect(h.agent.starts[1]?.cwd).toBe(h.agent.starts[0]?.cwd);
  });

  it('nova tentativa depois de cancelar abre a tentativa 2 e espera a aprovação de novo (R180)', async () => {
    const h = harness({ scripts: [[{ kind: 'approval' }], [{ kind: 'approval' }]] });
    h.repo.insertMission(missionFixture());
    await h.orchestrator.startMission(MISSION);
    data(await h.orchestrator.cancelMission(MISSION));

    const second = data(await h.orchestrator.retryMission(MISSION));

    expect(second).toMatchObject({ attempt: 2, status: 'running' });
    expect(h.repo.getMission(MISSION)?.status).toBe('waiting_approval');
    expect(h.repo.listExecutions(MISSION).map((e) => [e.attempt, e.status])).toEqual([
      [1, 'cancelled'],
      [2, 'running'],
    ]);
  });

  it('retry de missão em andamento retorna MISSION_INVALID_STATE', async () => {
    const h = harness({ scripts: [[{ kind: 'approval' }]] });
    h.repo.insertMission(missionFixture());
    await h.orchestrator.startMission(MISSION);

    expect(codeOf(await h.orchestrator.retryMission(MISSION))).toBe('MISSION_INVALID_STATE');
    expect(h.repo.getMission(MISSION)?.status).toBe('waiting_approval');
  });
});

/** Conteúdos dos deltas gravados na auditoria, na ordem em que foram gravados. */
function deltas(h: Harness): unknown[] {
  return h.repo
    .audit()
    .filter((e) => e.eventType === 'message.delta')
    .map((e) => e.payload['content']);
}

/** Espera uma condição, uma volta de tarefas assíncronas por vez. Falha se ela não acontecer. */
async function until(condition: () => boolean): Promise<void> {
  for (let turn = 0; turn < 200 && !condition(); turn += 1) {
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  if (!condition()) throw new Error('a condição não aconteceu a tempo');
}

/** Deixa as tarefas pendentes rodarem, para provar que nada mais aconteceu. */
async function settle(): Promise<void> {
  for (let turn = 0; turn < 20; turn += 1) {
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
}

describe('pausa e retomada (R181)', () => {
  it('pausar leva missão e execução a paused, pausa a sessão e audita com o ator do usuário', async () => {
    const h = harness({
      scripts: [
        [
          { kind: 'event', event: { type: 'message.delta', content: 'antes' } },
          { kind: 'hold' },
          { kind: 'event', event: { type: 'message.delta', content: 'depois' } },
        ],
      ],
    });
    h.repo.insertMission(missionFixture());
    const starting = h.orchestrator.startMission(MISSION);
    await until(() => deltas(h).includes('antes'));

    data(await h.orchestrator.pauseMission(MISSION));

    expect(h.repo.getMission(MISSION)?.status).toBe('paused');
    const [execution] = h.repo.listExecutions(MISSION);
    expect(execution?.status).toBe('paused');
    expect(h.agent.sessions[0]?.pauses).toBe(1);
    expect(
      h.repo
        .audit()
        .filter((e) => e.aggregateId === execution?.id && e.eventType === 'execution.paused'),
    ).toMatchObject([{ actor: 'user', severity: 'info' }]);
    expect(
      h.repo
        .audit()
        .filter((e) => e.aggregateId === MISSION && e.eventType === 'mission.status_changed')
        .map((e) => e.payload),
    ).toContainEqual({ from: 'running', to: 'paused' });
    data(await h.orchestrator.cancelMission(MISSION));
    await starting;
  });

  it('enquanto pausada nada é emitido; retomar continua a execução até o fim', async () => {
    const h = harness({
      scripts: [
        [
          { kind: 'event', event: { type: 'message.delta', content: 'antes' } },
          { kind: 'hold' },
          { kind: 'event', event: { type: 'message.delta', content: 'depois' } },
        ],
      ],
    });
    h.repo.insertMission(missionFixture());
    const starting = h.orchestrator.startMission(MISSION);
    await until(() => deltas(h).includes('antes'));
    data(await h.orchestrator.pauseMission(MISSION));

    h.agent.sessions[0]?.releaseHold();
    await settle();

    expect(deltas(h)).toEqual(['antes']);
    expect(h.repo.getMission(MISSION)?.status).toBe('paused');

    data(await h.orchestrator.resumeMission(MISSION));
    expect(data(await starting)).toMatchObject({ status: 'succeeded' });
    expect(h.agent.sessions[0]?.resumes).toBe(1);
    expect(deltas(h)).toEqual(['antes', 'depois']);
    expect(h.repo.getMission(MISSION)?.status).toBe('review');
    const [execution] = h.repo.listExecutions(MISSION);
    expect(
      h.repo
        .audit()
        .filter((e) => e.aggregateId === execution?.id && e.eventType === 'execution.resumed'),
    ).toHaveLength(1);
  });

  it('cancelar uma missão pausada encerra a execução como cancelada e chama stop() (R181)', async () => {
    const h = harness({ scripts: [[{ kind: 'hold' }]] });
    h.repo.insertMission(missionFixture());
    const starting = h.orchestrator.startMission(MISSION);
    await until(() => h.repo.getMission(MISSION)?.status === 'running');
    data(await h.orchestrator.pauseMission(MISSION));

    data(await h.orchestrator.cancelMission(MISSION));

    expect(h.repo.getMission(MISSION)?.status).toBe('cancelled');
    const [execution] = h.repo.listExecutions(MISSION);
    expect(execution).toMatchObject({ status: 'cancelled', exitReason: 'cancelled_by_user' });
    expect(h.agent.sessions[0]?.stopReasons).toHaveLength(1);
    expect(data(await starting)).toMatchObject({ status: 'cancelled' });
  });

  it('pausar ou retomar fora do estado certo retorna MISSION_INVALID_STATE e não grava nada', async () => {
    const h = harness();
    h.repo.insertMission(missionFixture());

    expect(codeOf(await h.orchestrator.pauseMission(MISSION))).toBe('MISSION_INVALID_STATE');
    expect(codeOf(await h.orchestrator.resumeMission(MISSION))).toBe('MISSION_INVALID_STATE');
    expect(h.repo.getMission(MISSION)?.status).toBe('queued');
    expect(h.repo.audit()).toHaveLength(0);
  });

  it('pausar uma missão que espera aprovação retorna MISSION_INVALID_STATE', async () => {
    const h = harness({ scripts: [[{ kind: 'approval' }]] });
    h.repo.insertMission(missionFixture());
    await h.orchestrator.startMission(MISSION);

    expect(codeOf(await h.orchestrator.pauseMission(MISSION))).toBe('MISSION_INVALID_STATE');
    expect(h.repo.getMission(MISSION)?.status).toBe('waiting_approval');
  });

  it('pausar e retomar missão inexistente retornam MISSION_NOT_FOUND', async () => {
    const h = harness();

    expect(codeOf(await h.orchestrator.pauseMission('nao-existe'))).toBe('MISSION_NOT_FOUND');
    expect(codeOf(await h.orchestrator.resumeMission('nao-existe'))).toBe('MISSION_NOT_FOUND');
  });

  it('agente que recusa a pausa devolve AGENT_UNAVAILABLE e a missão segue running', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      const h = harness({
        scripts: [
          [{ kind: 'hold' }, { kind: 'event', event: { type: 'message.delta', content: 'x' } }],
        ],
        failPause: true,
      });
      h.repo.insertMission(missionFixture());
      const starting = h.orchestrator.startMission(MISSION);
      await until(() => h.repo.getMission(MISSION)?.status === 'running');

      expect(codeOf(await h.orchestrator.pauseMission(MISSION))).toBe('AGENT_UNAVAILABLE');
      expect(h.repo.getMission(MISSION)?.status).toBe('running');

      h.agent.sessions[0]?.releaseHold();
      expect(data(await starting)).toMatchObject({ status: 'succeeded' });
    } finally {
      error.mockRestore();
    }
  });

  it('agente que recusa a retomada devolve AGENT_UNAVAILABLE e a missão segue paused', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      const h = harness({ scripts: [[{ kind: 'hold' }]], failResume: true });
      h.repo.insertMission(missionFixture());
      const starting = h.orchestrator.startMission(MISSION);
      await until(() => h.repo.getMission(MISSION)?.status === 'running');
      data(await h.orchestrator.pauseMission(MISSION));

      expect(codeOf(await h.orchestrator.resumeMission(MISSION))).toBe('AGENT_UNAVAILABLE');
      expect(h.repo.getMission(MISSION)?.status).toBe('paused');

      data(await h.orchestrator.cancelMission(MISSION));
      await starting;
    } finally {
      error.mockRestore();
    }
  });

  it('capacidade pauseResume falsa: pausar devolve AGENT_CAPABILITY_UNSUPPORTED, o agente não recebe pause() e o estado não muda', async () => {
    const h = harness({ scripts: [[{ kind: 'hold' }]], pauseResume: false });
    h.repo.insertMission(missionFixture());
    const starting = h.orchestrator.startMission(MISSION);
    await until(() => h.repo.getMission(MISSION)?.status === 'running');

    expect(codeOf(await h.orchestrator.pauseMission(MISSION))).toBe('AGENT_CAPABILITY_UNSUPPORTED');
    expect(h.agent.sessions[0]?.pauses).toBe(0);
    expect(h.repo.getMission(MISSION)?.status).toBe('running');
    expect(h.repo.listExecutions(MISSION)[0]?.status).toBe('running');

    data(await h.orchestrator.cancelMission(MISSION));
    await starting;
  });

  it('capacidade pauseResume falsa: retomar devolve AGENT_CAPABILITY_UNSUPPORTED e não chama resume()', async () => {
    const h = harness({ scripts: [[{ kind: 'hold' }]] });
    h.repo.insertMission(missionFixture());
    const starting = h.orchestrator.startMission(MISSION);
    await until(() => h.repo.getMission(MISSION)?.status === 'running');
    data(await h.orchestrator.pauseMission(MISSION));
    h.agent.setPauseResume(false);

    expect(codeOf(await h.orchestrator.resumeMission(MISSION))).toBe(
      'AGENT_CAPABILITY_UNSUPPORTED',
    );
    expect(h.agent.sessions[0]?.resumes).toBe(0);
    expect(h.repo.getMission(MISSION)?.status).toBe('paused');

    data(await h.orchestrator.cancelMission(MISSION));
    await starting;
  });

  it('a execução termina entre a pausa do agente e a transação: MISSION_INVALID_STATE, e o agente volta a rodar', async () => {
    const h = harness({ scripts: [[{ kind: 'hold' }]] });
    h.repo.insertMission(missionFixture());
    void h.orchestrator.startMission(MISSION);
    await until(() => h.repo.getMission(MISSION)?.status === 'running');
    h.agent.setPauseHook(() => {
      const [execution] = h.repo.listExecutions(MISSION);
      if (execution === undefined) throw new Error('sem execução');
      h.repo.updateExecution(execution.id, {
        status: 'cancelled',
        exitReason: 'cancelled_by_user',
        finishedAt: T0,
      });
      h.repo.updateMission(MISSION, { status: 'cancelled', finishedAt: T0, updatedAt: T0 });
    });

    expect(codeOf(await h.orchestrator.pauseMission(MISSION))).toBe('MISSION_INVALID_STATE');
    expect(h.agent.sessions[0]?.resumes).toBe(1);
    expect(h.repo.getMission(MISSION)?.status).toBe('cancelled');
  });

  it('duas pausas concorrentes: a segunda vê a pausa já feita, não desfaz nada e termina ok', async () => {
    const h = harness({ scripts: [[{ kind: 'hold' }]] });
    h.repo.insertMission(missionFixture());
    const starting = h.orchestrator.startMission(MISSION);
    await until(() => h.repo.getMission(MISSION)?.status === 'running');

    const results = await Promise.all([
      h.orchestrator.pauseMission(MISSION),
      h.orchestrator.pauseMission(MISSION),
    ]);

    expect(results).toEqual([
      { ok: true, data: undefined },
      { ok: true, data: undefined },
    ]);
    expect(h.agent.sessions[0]?.resumes).toBe(0);
    expect(h.repo.getMission(MISSION)?.status).toBe('paused');
    data(await h.orchestrator.cancelMission(MISSION));
    await starting;
  });

  it('duas retomadas concorrentes: a segunda vê a retomada já feita, não pausa de volta e termina ok', async () => {
    const h = harness({ scripts: [[{ kind: 'hold' }]] });
    h.repo.insertMission(missionFixture());
    const starting = h.orchestrator.startMission(MISSION);
    await until(() => h.repo.getMission(MISSION)?.status === 'running');
    data(await h.orchestrator.pauseMission(MISSION));

    const results = await Promise.all([
      h.orchestrator.resumeMission(MISSION),
      h.orchestrator.resumeMission(MISSION),
    ]);

    expect(results).toEqual([
      { ok: true, data: undefined },
      { ok: true, data: undefined },
    ]);
    expect(h.agent.sessions[0]?.pauses).toBe(1);
    expect(h.repo.getMission(MISSION)?.status).toBe('running');
    data(await h.orchestrator.cancelMission(MISSION));
    await starting;
  });

  it('pausar e retomar gravam execution.paused e depois execution.resumed, nessa ordem, com sequence crescente', async () => {
    const h = harness({ scripts: [[{ kind: 'hold' }]] });
    h.repo.insertMission(missionFixture());
    const starting = h.orchestrator.startMission(MISSION);
    await until(() => h.repo.getMission(MISSION)?.status === 'running');
    data(await h.orchestrator.pauseMission(MISSION));
    data(await h.orchestrator.resumeMission(MISSION));

    const [execution] = h.repo.listExecutions(MISSION);
    const changes = h.repo
      .audit()
      .filter(
        (e) =>
          e.aggregateId === execution?.id &&
          (e.eventType === 'execution.paused' || e.eventType === 'execution.resumed'),
      );
    expect(changes.map((e) => [e.eventType, e.actor])).toEqual([
      ['execution.paused', 'user'],
      ['execution.resumed', 'user'],
    ]);
    const [paused, resumed] = changes;
    expect(resumed?.sequence ?? 0).toBeGreaterThan(paused?.sequence ?? 0);
    data(await h.orchestrator.cancelMission(MISSION));
    await starting;
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

    expect(codeOf(await h.orchestrator.startMission('nao-existe'))).toBe('MISSION_NOT_FOUND');

    expect(h.repo.audit()).toHaveLength(0);
    expect(h.agent.starts).toHaveLength(0);
  });
});

describe('resumo de conclusão (R130)', () => {
  const changedFile = (path: string): MissionDiffDto['files'][number] => ({
    path,
    status: 'modified',
    added: 1,
    removed: 0,
    binary: false,
    truncated: false,
  });
  const concludedEvents = (h: Harness): AuditEvent[] =>
    h.repo.audit().filter((e) => e.eventType === 'execution.concluded');

  it('missão concluída grava arquivos alterados e estado Git, lidos do worktree', async () => {
    const diff = vi.fn(() =>
      Promise.resolve<MissionDiffDto>({
        files: [changedFile('a.ts'), changedFile('b.ts')],
        truncatedFiles: false,
      }),
    );
    const h = harness({ scripts: [[]], diff });
    h.repo.insertMission(missionFixture());

    const execution = data(await h.orchestrator.startMission(MISSION));

    expect(diff).toHaveBeenCalledWith(WORKTREE_PATH);
    expect(h.repo.getMission(MISSION)?.status).toBe('review');
    expect(concludedEvents(h)).toEqual([
      expect.objectContaining({
        aggregateType: 'execution',
        aggregateId: execution.id,
        payload: { changedFiles: 2, gitState: 'uncommitted' },
      }),
    ]);
  });

  it('worktree sem alteração grava zero arquivos e estado clean', async () => {
    const h = harness({
      scripts: [[]],
      diff: () => Promise.resolve({ files: [], truncatedFiles: false }),
    });
    h.repo.insertMission(missionFixture());

    data(await h.orchestrator.startMission(MISSION));

    expect(concludedEvents(h).map((e) => e.payload)).toEqual([
      { changedFiles: 0, gitState: 'clean' },
    ]);
  });

  it('o evento sai na mesma transação do fim: antes de session.completed, a missão ainda não terminou', async () => {
    const h = harness({
      scripts: [[]],
      diff: () => Promise.resolve({ files: [], truncatedFiles: false }),
    });
    h.repo.insertMission(missionFixture());

    const execution = data(await h.orchestrator.startMission(MISSION));

    const types = h.repo
      .audit()
      .filter((e) => e.aggregateId === execution.id)
      .map((e) => e.eventType);
    expect(types).toContain('execution.concluded');
    expect(types.indexOf('execution.concluded')).toBeGreaterThan(
      types.indexOf('session.completed'),
    );
  });

  it('se o Git falha ao ler as alterações, a missão conclui mesmo assim, sem inventar o resumo', async () => {
    const h = harness({ scripts: [[]], diff: () => Promise.reject(new Error('git quebrou')) });
    h.repo.insertMission(missionFixture());
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    data(await h.orchestrator.startMission(MISSION));
    spy.mockRestore();

    expect(h.repo.getMission(MISSION)?.status).toBe('review');
    expect(concludedEvents(h)).toHaveLength(0);
  });

  it('sem a porta de alterações, a missão conclui sem o resumo', async () => {
    const h = harness({ scripts: [[]] });
    h.repo.insertMission(missionFixture());

    data(await h.orchestrator.startMission(MISSION));

    expect(h.repo.getMission(MISSION)?.status).toBe('review');
    expect(concludedEvents(h)).toHaveLength(0);
  });

  it('missão que falha não lê o Git nem grava resumo', async () => {
    const diff = vi.fn(() => Promise.resolve<MissionDiffDto>({ files: [], truncatedFiles: false }));
    const h = harness({ scripts: [[{ kind: 'fail', message: 'quebrou' }]], diff });
    h.repo.insertMission(missionFixture());

    data(await h.orchestrator.startMission(MISSION));

    expect(h.repo.getMission(MISSION)?.status).toBe('failed');
    expect(diff).not.toHaveBeenCalled();
    expect(concludedEvents(h)).toHaveLength(0);
  });

  it('missão cancelada não lê o Git nem grava resumo', async () => {
    const diff = vi.fn(() => Promise.resolve<MissionDiffDto>({ files: [], truncatedFiles: false }));
    const h = harness({ scripts: [[{ kind: 'approval' }]], diff });
    h.repo.insertMission(missionFixture());
    data(await h.orchestrator.startMission(MISSION));

    data(await h.orchestrator.cancelMission(MISSION));

    expect(h.repo.getMission(MISSION)?.status).toBe('cancelled');
    expect(diff).not.toHaveBeenCalled();
    expect(concludedEvents(h)).toHaveLength(0);
  });
});

describe('revisão da conclusão', () => {
  const finish = [
    { kind: 'event', event: { type: 'message.completed', messageId: 'm1' } },
  ] as const;

  it('o agente que termina deixa a missão em review, e a tentativa fica concluída', async () => {
    const h = harness({ scripts: [[...finish]] });
    h.repo.insertMission(missionFixture());

    const execution = data(await h.orchestrator.startMission(MISSION));

    expect(execution.status).toBe('succeeded');
    expect(h.repo.getMission(MISSION)?.status).toBe('review');
  });

  it('aprovar a revisão conclui a missão e grava review.approved pela pessoa', async () => {
    const h = harness({ scripts: [[...finish]] });
    h.repo.insertMission(missionFixture());
    await h.orchestrator.startMission(MISSION);

    data(await h.orchestrator.approveReview(MISSION));

    expect(h.repo.getMission(MISSION)?.status).toBe('succeeded');
    const approved = h.repo.audit().filter((e) => e.eventType === 'review.approved');
    expect(approved).toHaveLength(1);
    expect(approved[0]).toMatchObject({ actor: 'user', aggregateId: MISSION });
  });

  it('aprovar fora da revisão é recusado e a missão não muda', async () => {
    const h = harness();
    h.repo.insertMission(missionFixture({ status: 'queued' }));

    expect(codeOf(await h.orchestrator.approveReview(MISSION))).toBe('MISSION_INVALID_STATE');
    expect(h.repo.getMission(MISSION)?.status).toBe('queued');
  });

  it('pedir ajustes abre nova tentativa no mesmo worktree, com o pedido no prompt', async () => {
    const h = harness({ scripts: [[...finish], []] });
    h.repo.insertMission(missionFixture({ altersCode: true }));
    await h.orchestrator.startMission(MISSION);

    const second = data(
      await h.orchestrator.requestChanges({
        missionId: MISSION,
        feedback: '  Trocar o nome da função  ',
      }),
    );

    expect(second).toMatchObject({ attempt: 2, status: 'succeeded' });
    expect(h.worktrees.created).toHaveLength(1);
    expect(h.agent.starts[1]?.cwd).toBe(h.agent.starts[0]?.cwd);
    expect(h.agent.starts[1]?.prompt).toBe(
      'Corrigir o login\n\nAjustes pedidos na revisão:\nTrocar o nome da função',
    );
    expect(h.agent.starts[0]?.prompt).toBe('Corrigir o login');
    expect(h.repo.getMission(MISSION)?.status).toBe('review');
  });

  it('o prompt leva só o pedido mais recente, quando a revisão pede ajustes mais de uma vez', async () => {
    const h = harness({ scripts: [[...finish], [...finish], []] });
    h.repo.insertMission(missionFixture());
    await h.orchestrator.startMission(MISSION);
    data(await h.orchestrator.requestChanges({ missionId: MISSION, feedback: 'Primeiro pedido' }));

    data(await h.orchestrator.requestChanges({ missionId: MISSION, feedback: 'Segundo pedido' }));

    expect(h.agent.starts[2]?.prompt).toContain('Segundo pedido');
    expect(h.agent.starts[2]?.prompt).not.toContain('Primeiro pedido');
  });

  it('pedido de ajuste vazio é recusado antes de qualquer mudança', async () => {
    const h = harness({ scripts: [[...finish]] });
    h.repo.insertMission(missionFixture());
    await h.orchestrator.startMission(MISSION);

    const error = await h.orchestrator.requestChanges({ missionId: MISSION, feedback: '   ' });

    expect(codeOf(error)).toBe('VALIDATION_FAILED');
    expect(h.repo.getMission(MISSION)?.status).toBe('review');
    expect(h.repo.audit().some((e) => e.eventType === 'review.changes_requested')).toBe(false);
  });

  it('pedir ajustes fora da revisão é recusado', async () => {
    const h = harness();
    h.repo.insertMission(missionFixture({ status: 'queued' }));

    const error = await h.orchestrator.requestChanges({ missionId: MISSION, feedback: 'Ajuste' });

    expect(codeOf(error)).toBe('MISSION_INVALID_STATE');
    expect(h.repo.getMission(MISSION)?.status).toBe('queued');
  });

  it('cancelar uma missão em revisão a encerra como cancelada', async () => {
    const h = harness({ scripts: [[...finish]] });
    h.repo.insertMission(missionFixture());
    await h.orchestrator.startMission(MISSION);

    data(await h.orchestrator.cancelMission(MISSION));

    expect(h.repo.getMission(MISSION)?.status).toBe('cancelled');
  });
});

describe('tarefas do plano, em sequência', () => {
  function task(id: string, position: number, dependsOn: string[] = []) {
    return {
      id,
      missionId: MISSION,
      position,
      title: `Tarefa ${id}`,
      description: '',
      kind: 'custom' as const,
      status: 'pending' as const,
      dependsOn,
      agent: 'claude-code' as const,
      role: 'general' as const,
    };
  }

  it('roda uma sessão por tarefa, na ordem, no mesmo worktree, e a missão só vai a review no fim', async () => {
    const h = harness();
    h.repo.insertMission(missionFixture());
    h.repo.insertSteps([task('a', 1), task('b', 2, ['a']), task('c', 3, ['b'])]);

    const last = data(await h.orchestrator.startMission(MISSION));

    expect(h.agent.starts).toHaveLength(3);
    expect(h.agent.starts.map((s) => s.prompt)).toEqual([
      expect.stringContaining('Tarefa a'),
      expect.stringContaining('Tarefa b'),
      expect.stringContaining('Tarefa c'),
    ]);
    expect(h.agent.starts[2]?.prompt).toContain('Tarefas já concluídas');
    expect(new Set(h.agent.starts.map((s) => s.cwd)).size).toBe(1);
    expect(h.worktrees.created).toHaveLength(1);
    expect(h.repo.steps().map((s) => s.status)).toEqual(['succeeded', 'succeeded', 'succeeded']);
    const executions = h.repo.listExecutions(MISSION);
    expect(executions.map((e) => [e.attempt, e.stepId, e.status])).toEqual([
      [1, 'a', 'succeeded'],
      [2, 'b', 'succeeded'],
      [3, 'c', 'succeeded'],
    ]);
    expect(last.id).toBe(executions[2]?.id);
    expect(h.repo.getMission(MISSION)?.status).toBe('review');
  });

  it('só começa uma tarefa depois das que ela depende, mesmo fora de ordem no plano', async () => {
    const h = harness();
    h.repo.insertMission(missionFixture());
    h.repo.insertSteps([task('a', 1, ['b']), task('b', 2)]);

    data(await h.orchestrator.startMission(MISSION));

    expect(h.repo.listExecutions(MISSION).map((e) => e.stepId)).toEqual(['b', 'a']);
  });

  it('falha numa tarefa: a missão falha e as seguintes não começam', async () => {
    const h = harness({ scripts: [[], [{ kind: 'fail', message: 'quebrou' }]] });
    h.repo.insertMission(missionFixture());
    h.repo.insertSteps([task('a', 1), task('b', 2, ['a']), task('c', 3, ['b'])]);

    data(await h.orchestrator.startMission(MISSION));

    expect(h.agent.starts).toHaveLength(2);
    expect(h.repo.steps().map((s) => s.status)).toEqual(['succeeded', 'failed', 'pending']);
    expect(h.repo.getMission(MISSION)?.status).toBe('failed');
  });

  it('nova tentativa recomeça na tarefa que falhou, sem repetir as concluídas', async () => {
    const h = harness({ scripts: [[], [{ kind: 'fail', message: 'quebrou' }]] });
    h.repo.insertMission(missionFixture());
    h.repo.insertSteps([task('a', 1), task('b', 2, ['a'])]);
    data(await h.orchestrator.startMission(MISSION));

    data(await h.orchestrator.retryMission(MISSION));

    expect(h.agent.starts).toHaveLength(3);
    expect(h.agent.starts[2]?.prompt).toContain('Tarefa b');
    expect(h.repo.steps().map((s) => s.status)).toEqual(['succeeded', 'succeeded']);
    expect(h.repo.getMission(MISSION)?.status).toBe('review');
  });

  it('etapas sem papel continuam numa sessão só, com o objetivo da missão', async () => {
    const h = harness();
    h.repo.insertMission(missionFixture());
    h.repo.insertSteps([task('a', 1), task('b', 2)].map(({ role: _role, ...plain }) => plain));

    data(await h.orchestrator.startMission(MISSION));

    expect(h.agent.starts).toHaveLength(1);
    expect(h.agent.starts[0]?.prompt).toBe('Corrigir o login');
    expect(h.repo.steps().map((s) => s.status)).toEqual(['pending', 'pending']);
  });
});
