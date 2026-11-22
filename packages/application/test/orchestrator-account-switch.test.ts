import type { AppResult } from '@project-hub/contracts';
import { failure } from '../src/result';
import type { Mission, MissionStep } from '@project-hub/domain';
import { describe, expect, it, vi } from 'vitest';
import {
  createOrchestrator,
  type AccountSwitchNotice,
  type Orchestrator,
} from '../src/missions/orchestrator';
import { RESUME_PROMPT } from '../src/missions/tasks';
import type { AccountPick, Planner } from '../src/ports';
import { fakeRepository } from './fakes';
import { fakeAgent, type FakeAgent, type FakeStep } from './fake-agent';
import { fakeMissionRepository, fakeWorktrees, type FakeMissionRepository } from './fakes-missions';

// A missão que bate no limite da conta: com a troca ligada, a tentativa fecha e a mesma tarefa continua na
// próxima conta; sem a troca, ou sem conta que sirva, a missão espera resposta com o motivo gravado.

const T0 = '2026-10-20T09:00:00.000Z';
const MISSION = 'missao-1-abcdef';
const RESET = '2026-10-20T15:10:00.000Z';
const SESSION = '11111111-2222-3333-4444-555555555555';
const TRANSCRIPT = 'C:\\Users\\eu\\.claude\\projects\\C--app\\11111111-2222-3333-4444-555555555555.jsonl';
const NAMES: Record<string, string> = { trabalho: 'Trabalho', pessoal: 'Pessoal', estudo: 'Estudo' };

type Options = {
  scripts: FakeStep[][];
  enabled?: boolean;
  /** As contas da troca, na ordem; `pick` real sobre as marcações. Sem `pick`, este é o roteiro. */
  order?: string[];
  pick?: (input: { exclude: string | null }) => Promise<AccountPick>;
  failStarts?: (call: number) => Error | undefined;
  planner?: Planner;
  limitMessage?: (accountId: string | null) => string | undefined;
};

type Harness = {
  repo: FakeMissionRepository;
  agent: FakeAgent;
  orchestrator: Orchestrator;
  marks: Map<string | null, string>;
  notices: AccountSwitchNotice[];
};

function harness(options: Options): Harness {
  const repo = fakeMissionRepository();
  const projects = fakeRepository();
  projects.insert({
    id: 'p1',
    name: 'app',
    path: 'C:\\dev\\app',
    normalizedPath: 'c:/dev/app',
    repositoryKind: 'git',
    defaultBranch: 'main',
    createdAt: T0,
  });
  const agent = fakeAgent(options.scripts, {
    startError: (_input, call) => options.failStarts?.(call),
  });
  const marks = new Map<string | null, string>();
  const notices: AccountSwitchNotice[] = [];
  let tick = 0;
  let ids = 0;
  const now = () => new Date(Date.UTC(2026, 9, 20, 10, 0, tick++)).toISOString();
  const order = options.order ?? ['trabalho', 'pessoal'];
  const realPick = (input: { exclude: string | null }): Promise<AccountPick> => {
    const free = order.find((id) => id !== input.exclude && !marks.has(id));
    if (free !== undefined) return Promise.resolve({ kind: 'account', accountId: free });
    const resets = [...marks.values()].sort();
    return Promise.resolve(
      resets[0] === undefined ? { kind: 'none' } : { kind: 'none', resetsAt: resets[0] },
    );
  };
  const orchestrator = createOrchestrator({
    repo,
    projects,
    worktrees: fakeWorktrees(),
    worktreeNames: ({ missionId }) => ({
      missionShortId: missionId.slice(0, 8),
      slug: 'ajustar-login',
      branch: `ph/${missionId.slice(0, 8)}-ajustar-login`,
      relativeDir: `app/${missionId.slice(0, 8)}-ajustar-login`,
    }),
    worktreesRoot: 'C:\\hub\\worktrees',
    agent,
    accounts: {
      labelOf: (_provider, accountId) => ({
        name: accountId === null ? 'Principal' : (NAMES[accountId] ?? ''),
        removed: false,
      }),
      autoSwitchEnabled: () => options.enabled === true,
      exhaustedUntil: (accountId) => marks.get(accountId),
      markExhausted: (accountId, until) => void marks.set(accountId, until),
      pickAccount: options.pick ?? realPick,
      ...(options.limitMessage === undefined ? {} : { limitMessage: options.limitMessage }),
    },
    ...(options.planner === undefined ? {} : { planner: options.planner }),
    onAccountSwitched: (notice) => void notices.push(notice),
    now,
    newId: () => `id-${++ids}`,
  });
  return { repo, agent, orchestrator, marks, notices };
}

function mission(overrides: Partial<Mission> = {}): Mission {
  return {
    id: MISSION,
    projectId: 'p1',
    title: 'Ajustar login',
    objective: 'Corrigir o login',
    acceptanceCriteria: [{ id: 'c1', position: 1, text: 'Login funciona' }],
    status: 'queued',
    priority: 'normal',
    agentProfileId: 'simulado',
    executionProfileId: 'padrao',
    altersCode: false,
    createdAt: T0,
    updatedAt: T0,
    accountId: 'trabalho',
    ...overrides,
  };
}

function task(id: string, position: number, dependsOn: string[] = []): MissionStep {
  return {
    id,
    missionId: MISSION,
    position,
    title: `Tarefa ${id}`,
    description: '',
    kind: 'custom',
    status: 'pending',
    dependsOn,
    agent: 'claude-code',
    role: 'general',
  };
}

function limit(extra: { resetsAt?: string; sessionId?: string; transcriptPath?: string } = {}): FakeStep {
  return { kind: 'event', event: { type: 'limit.reached', window: 'session', ...extra } };
}

const FULL_LIMIT = limit({ resetsAt: RESET, sessionId: SESSION, transcriptPath: TRANSCRIPT });

function audit(h: Harness, eventType: string): Record<string, unknown>[] {
  return h.repo
    .audit()
    .filter((event) => event.aggregateId === MISSION && event.eventType === eventType)
    .map((event) => event.payload);
}

function data<T>(result: AppResult<T>): T {
  if (!result.ok) throw new Error(`esperava sucesso: ${result.error.code} ${result.error.message}`);
  return result.data;
}

describe('troca automática de conta na missão', () => {
  it('com a opção ligada, encerra a tentativa e continua a mesma tarefa na próxima conta', async () => {
    const h = harness({ enabled: true, scripts: [[FULL_LIMIT, { kind: 'hold' }], [{ kind: 'hold' }]] });
    h.repo.insertMission(mission());
    h.repo.insertSteps([task('a', 1), task('b', 2, ['a'])]);

    void h.orchestrator.startMission(MISSION);
    await vi.waitFor(() => expect(h.repo.listExecutions(MISSION)).toHaveLength(2));

    const [first, second] = h.repo.listExecutions(MISSION);
    expect(h.agent.sessions[0]?.stopReasons).toEqual(['Limite da conta.']);
    expect(first).toMatchObject({ status: 'failed', exitReason: 'account_limit', stepId: 'a' });
    expect(first?.finishedAt).toBeDefined();
    expect(second).toMatchObject({ stepId: 'a', attempt: 2 });
    expect(h.repo.getMission(MISSION)?.accountId).toBe('pessoal');
    expect(h.agent.starts[1]).toMatchObject({
      accountId: 'pessoal',
      cwd: h.agent.starts[0]?.cwd,
      resume: {
        sessionId: SESSION,
        transcriptPath: TRANSCRIPT,
        fromAccountId: 'trabalho',
        prompt: RESUME_PROMPT,
      },
    });
    expect(h.agent.starts[1]?.prompt).toContain('Esta tarefa já tinha começado em outra conta');
    expect(h.agent.starts[1]?.prompt).toContain('Tarefa a');
    expect(audit(h, 'mission.account_switched')).toEqual([
      expect.objectContaining({
        cause: 'limit',
        fromName: 'Trabalho',
        toName: 'Pessoal',
        resetsAt: RESET,
      }),
    ]);
    // O agente falso não diz que levou a conversa.
    expect(audit(h, 'mission.resume_failed')).toHaveLength(1);
    expect(h.notices).toEqual([
      { missionId: MISSION, cause: 'limit', fromName: 'Trabalho', toName: 'Pessoal', resetsAt: RESET },
    ]);
    expect(h.marks.get('trabalho')).toBe(RESET);
    data(await h.orchestrator.cancelMission(MISSION));
  });

  it('a sessão que diz ter levado a conversa não grava resume_failed', async () => {
    const h = harness({ enabled: true, scripts: [[FULL_LIMIT, { kind: 'hold' }], [{ kind: 'hold' }]] });
    const start = h.agent.start.bind(h.agent);
    h.agent.start = async (input, signal) => {
      const session = await start(input, signal);
      return input.resume === undefined ? session : { ...session, resumed: true };
    };
    h.repo.insertMission(mission());

    void h.orchestrator.startMission(MISSION);
    await vi.waitFor(() => expect(h.repo.listExecutions(MISSION)).toHaveLength(2));
    expect(audit(h, 'mission.resume_failed')).toEqual([]);
    data(await h.orchestrator.cancelMission(MISSION));
  });

  it('sem tarefa no plano, a nova tentativa leva a missão inteira com o aviso de continuação', async () => {
    const h = harness({ enabled: true, scripts: [[FULL_LIMIT, { kind: 'hold' }], []] });
    h.repo.insertMission(mission());

    data(await h.orchestrator.startMission(MISSION));
    await vi.waitFor(() => expect(h.repo.getMission(MISSION)?.status).toBe('review'));
    expect(h.agent.starts[1]?.prompt).toMatch(/^Corrigir o login/);
    expect(h.agent.starts[1]?.prompt).toContain('Esta tarefa já tinha começado em outra conta');
  });

  it('sem hora de renovação, marca por 5 horas', async () => {
    const h = harness({ enabled: true, scripts: [[limit(), { kind: 'hold' }], []] });
    h.repo.insertMission(mission());

    data(await h.orchestrator.startMission(MISSION));
    await vi.waitFor(() => expect(h.agent.starts).toHaveLength(2));
    const until = h.marks.get('trabalho');
    expect(until).toBeDefined();
    const hours = (Date.parse(until ?? '') - Date.parse('2026-10-20T10:00:00.000Z')) / 3_600_000;
    expect(hours).toBeGreaterThanOrEqual(5);
    expect(hours).toBeLessThan(5.1);
    // Sem o id da sessão e o caminho, a nova tentativa não tenta levar a conversa.
    expect(h.agent.starts[1]).not.toHaveProperty('resume');
  });

  it('com a opção desligada, espera resposta e grava o motivo, sem trocar', async () => {
    const h = harness({ enabled: false, scripts: [[FULL_LIMIT, { kind: 'hold' }]] });
    h.repo.insertMission(mission());

    void h.orchestrator.startMission(MISSION);
    await vi.waitFor(() => expect(h.repo.getMission(MISSION)?.status).toBe('waiting_input'));
    expect(audit(h, 'mission.account_limit')).toEqual([
      expect.objectContaining({ accountName: 'Trabalho', resetsAt: RESET, allExhausted: false }),
    ]);
    expect(h.agent.starts).toHaveLength(1);
    expect(h.agent.sessions[0]?.stopReasons).toEqual([]);
    expect(h.marks.get('trabalho')).toBe(RESET);
    data(await h.orchestrator.cancelMission(MISSION));
  });

  it('a resposta no terminal leva a missão de volta a running', async () => {
    const h = harness({
      enabled: false,
      // O pedido de aprovação depois da resposta só vale com a missão em `running`: chegar a ele prova a volta.
      scripts: [
        [
          FULL_LIMIT,
          { kind: 'hold' },
          { kind: 'event', event: { type: 'input.received' } },
          { kind: 'approval' },
        ],
      ],
    });
    h.repo.insertMission(mission());

    void h.orchestrator.startMission(MISSION);
    await vi.waitFor(() => expect(h.repo.getMission(MISSION)?.status).toBe('waiting_input'));
    h.agent.sessions[0]?.releaseHold();
    await vi.waitFor(() => expect(h.repo.getMission(MISSION)?.status).toBe('waiting_approval'));
    data(await h.orchestrator.cancelMission(MISSION));
  });

  it('sem nenhuma conta elegível, espera e diz quando a primeira renova', async () => {
    const h = harness({
      enabled: true,
      scripts: [[FULL_LIMIT, { kind: 'hold' }]],
      pick: () => Promise.resolve({ kind: 'none', resetsAt: '2026-10-20T12:00:00.000Z' }),
    });
    h.repo.insertMission(mission());

    void h.orchestrator.startMission(MISSION);
    await vi.waitFor(() => expect(h.repo.getMission(MISSION)?.status).toBe('waiting_input'));
    expect(audit(h, 'mission.account_limit')).toEqual([
      expect.objectContaining({
        accountName: 'Trabalho',
        allExhausted: true,
        firstResetAt: '2026-10-20T12:00:00.000Z',
      }),
    ]);
    expect(h.agent.starts).toHaveLength(1);
    data(await h.orchestrator.cancelMission(MISSION));
  });

  it('troca em cadeia até acabar as contas, sem laço', async () => {
    const h = harness({
      enabled: true,
      order: ['trabalho', 'pessoal', 'estudo'],
      scripts: [
        [FULL_LIMIT, { kind: 'hold' }],
        [limit({ resetsAt: '2026-10-20T16:00:00.000Z' }), { kind: 'hold' }],
        [limit({ resetsAt: '2026-10-20T17:00:00.000Z' }), { kind: 'hold' }],
        [],
      ],
    });
    h.repo.insertMission(mission());

    void h.orchestrator.startMission(MISSION);
    await vi.waitFor(() => expect(h.repo.getMission(MISSION)?.status).toBe('waiting_input'));
    expect(h.agent.starts.map((start) => start.accountId)).toEqual([
      'trabalho',
      'pessoal',
      'estudo',
    ]);
    expect(audit(h, 'mission.account_switched')).toHaveLength(2);
    expect(audit(h, 'mission.account_limit')).toEqual([
      expect.objectContaining({ accountName: 'Estudo', allExhausted: true, firstResetAt: RESET }),
    ]);
    data(await h.orchestrator.cancelMission(MISSION));
  });

  it('não troca missão pausada pela pessoa', async () => {
    const h = harness({ enabled: true, scripts: [[{ kind: 'hold' }, FULL_LIMIT, { kind: 'block' }]] });
    h.repo.insertMission(mission());

    void h.orchestrator.startMission(MISSION);
    await vi.waitFor(() => expect(h.repo.getMission(MISSION)?.status).toBe('running'));
    // A pausa entra antes da linha de limite chegar (a sessão do terminal segue lendo o transcript).
    h.repo.updateMission(MISSION, { status: 'paused' });
    h.agent.sessions[0]?.releaseHold();
    await vi.waitFor(() => expect(h.marks.get('trabalho')).toBe(RESET));
    expect(h.agent.sessions[0]?.stopReasons).toEqual([]);
    expect(h.agent.starts).toHaveLength(1);
    expect(h.repo.getMission(MISSION)?.status).toBe('paused');
    expect(audit(h, 'mission.account_limit')).toEqual([]);
    data(await h.orchestrator.cancelMission(MISSION));
  });

  it('cancelar durante a troca não abre sessão nova', async () => {
    let release: (pick: AccountPick) => void = () => undefined;
    const h = harness({
      enabled: true,
      scripts: [[FULL_LIMIT, { kind: 'hold' }], []],
      pick: () =>
        new Promise<AccountPick>((resolve) => {
          release = resolve;
        }),
    });
    h.repo.insertMission(mission());

    const started = h.orchestrator.startMission(MISSION);
    await vi.waitFor(() => expect(h.marks.get('trabalho')).toBe(RESET));
    data(await h.orchestrator.cancelMission(MISSION));
    release({ kind: 'account', accountId: 'pessoal' });
    await started;

    expect(h.repo.getMission(MISSION)?.status).toBe('cancelled');
    expect(h.agent.starts).toHaveLength(1);
    expect(audit(h, 'mission.account_switched')).toEqual([]);
  });

  it('a falha ao abrir a nova tentativa leva a missão a failed', async () => {
    const h = harness({
      enabled: true,
      scripts: [[FULL_LIMIT, { kind: 'hold' }]],
      failStarts: (call) => (call === 2 ? new Error('agente indisponível') : undefined),
    });
    h.repo.insertMission(mission());

    data(await h.orchestrator.startMission(MISSION));
    await vi.waitFor(() => expect(h.repo.getMission(MISSION)?.status).toBe('failed'));
    expect(h.repo.listExecutions(MISSION)).toHaveLength(1);
    expect(h.repo.listExecutions(MISSION)[0]).toMatchObject({ exitReason: 'account_limit' });
  });

  it('não grava o id da sessão nem o caminho do transcript na auditoria', async () => {
    const h = harness({ enabled: false, scripts: [[FULL_LIMIT, { kind: 'hold' }]] });
    h.repo.insertMission(mission());

    void h.orchestrator.startMission(MISSION);
    await vi.waitFor(() => expect(h.repo.getMission(MISSION)?.status).toBe('waiting_input'));
    const recorded = h.repo.audit().filter((event) => event.eventType === 'limit.reached');
    expect(recorded.map((event) => event.payload)).toEqual([
      { type: 'limit.reached', window: 'session', resetsAt: RESET, at: expect.any(String) as unknown },
    ]);
    const all = JSON.stringify(h.repo.audit());
    expect(all).not.toContain(SESSION);
    expect(all).not.toContain('C--app');
    data(await h.orchestrator.cancelMission(MISSION));
  });

  it('a linha repetida na mesma tentativa só grava o motivo uma vez', async () => {
    const h = harness({
      enabled: false,
      scripts: [[FULL_LIMIT, limit({ resetsAt: '2026-10-20T16:00:00.000Z' }), { kind: 'hold' }]],
    });
    h.repo.insertMission(mission());

    void h.orchestrator.startMission(MISSION);
    await vi.waitFor(() => expect(h.marks.get('trabalho')).toBe('2026-10-20T16:00:00.000Z'));
    expect(audit(h, 'mission.account_limit')).toHaveLength(1);
    expect(h.repo.getMission(MISSION)?.status).toBe('waiting_input');
    data(await h.orchestrator.cancelMission(MISSION));
  });

  it('o pedido de resposta com a missão já esperando só grava o evento', async () => {
    const h = harness({ enabled: false, scripts: [[FULL_LIMIT, { kind: 'input' }]] });
    h.repo.insertMission(mission());

    void h.orchestrator.startMission(MISSION);
    await vi.waitFor(() =>
      expect(h.repo.audit().some((event) => event.eventType === 'input.requested')).toBe(true),
    );
    expect(h.repo.getMission(MISSION)?.status).toBe('waiting_input');
    data(await h.orchestrator.cancelMission(MISSION));
  });
});

describe('a abertura evita a conta esgotada', () => {
  const QUOTA = 'A cota do Claude acabou. Renova às 20:10. Veja o uso no Início, em Uso do Claude.';

  it('iniciar com a conta esgotada troca antes de abrir o agente e registra', async () => {
    const h = harness({ enabled: true, scripts: [[{ kind: 'hold' }]] });
    h.marks.set('trabalho', RESET);
    h.repo.insertMission(mission());

    void h.orchestrator.startMission(MISSION);
    await vi.waitFor(() => expect(h.agent.starts).toHaveLength(1));

    expect(h.agent.starts[0]?.accountId).toBe('pessoal');
    expect(h.repo.getMission(MISSION)?.accountId).toBe('pessoal');
    expect(audit(h, 'mission.account_switched')).toEqual([
      expect.objectContaining({
        cause: 'opening',
        fromName: 'Trabalho',
        toName: 'Pessoal',
        resetsAt: RESET,
      }),
    ]);
    expect(h.notices).toEqual([
      { missionId: MISSION, cause: 'opening', fromName: 'Trabalho', toName: 'Pessoal', resetsAt: RESET },
    ]);
    data(await h.orchestrator.cancelMission(MISSION));
  });

  it('planejar com a conta esgotada troca antes do planejador', async () => {
    const calls: Parameters<Planner['plan']>[0][] = [];
    const planner: Planner = {
      plan: (input) => {
        calls.push(input);
        return Promise.resolve({
          ok: true,
          data: [{ title: 'Ler', description: '', role: 'docs', dependsOn: [] }],
        });
      },
    };
    const h = harness({ enabled: true, scripts: [], planner });
    h.marks.set('trabalho', RESET);
    h.repo.insertMission(mission({ status: 'draft' }));

    data(await h.orchestrator.planMission(MISSION));

    expect(calls[0]?.accountId).toBe('pessoal');
    expect(audit(h, 'mission.account_switched')).toEqual([
      expect.objectContaining({ cause: 'opening', toName: 'Pessoal' }),
    ]);
  });

  it('sem nenhuma elegível, iniciar falha com a frase da cota e nada muda', async () => {
    const h = harness({
      enabled: true,
      scripts: [[]],
      limitMessage: (accountId) => (accountId === 'trabalho' ? QUOTA : undefined),
    });
    h.marks.set('trabalho', RESET);
    h.marks.set('pessoal', RESET);
    h.repo.insertMission(mission());

    const result = await h.orchestrator.startMission(MISSION);

    expect(result).toEqual(failure('AGENT_UNAVAILABLE', QUOTA));
    expect(h.repo.getMission(MISSION)?.status).toBe('queued');
    expect(h.repo.getMission(MISSION)?.accountId).toBe('trabalho');
    expect(h.agent.starts).toEqual([]);
    expect(audit(h, 'mission.account_switched')).toEqual([]);
  });

  it('sem a frase da cota, a falha usa a frase geral', async () => {
    const h = harness({ enabled: true, scripts: [[]], pick: () => Promise.resolve({ kind: 'none' }) });
    h.marks.set('trabalho', RESET);
    h.repo.insertMission(mission());

    expect(await h.orchestrator.startMission(MISSION)).toEqual(
      failure('AGENT_UNAVAILABLE', 'O limite da conta acabou. Tente de novo quando renovar.'),
    );
  });

  it('com a opção desligada, abre na conta da missão mesmo esgotada', async () => {
    const h = harness({ enabled: false, scripts: [[{ kind: 'hold' }]] });
    h.marks.set('trabalho', RESET);
    h.repo.insertMission(mission());

    void h.orchestrator.startMission(MISSION);
    await vi.waitFor(() => expect(h.agent.starts).toHaveLength(1));

    expect(h.agent.starts[0]?.accountId).toBe('trabalho');
    expect(audit(h, 'mission.account_switched')).toEqual([]);
    data(await h.orchestrator.cancelMission(MISSION));
  });

  it('a próxima tarefa da cadeia evita a conta esgotada', async () => {
    const h = harness({ enabled: true, scripts: [[{ kind: 'hold' }], [{ kind: 'hold' }]] });
    h.repo.insertMission(mission());
    h.repo.insertSteps([task('a', 1), task('b', 2, ['a'])]);

    void h.orchestrator.startMission(MISSION);
    await vi.waitFor(() => expect(h.agent.starts).toHaveLength(1));
    h.marks.set('trabalho', RESET);
    h.agent.sessions[0]?.releaseHold();
    await vi.waitFor(() => expect(h.agent.starts).toHaveLength(2));

    expect(h.agent.starts.map((start) => start.accountId)).toEqual(['trabalho', 'pessoal']);
    expect(audit(h, 'mission.account_switched')).toEqual([
      expect.objectContaining({ cause: 'opening', fromName: 'Trabalho', toName: 'Pessoal' }),
    ]);
    data(await h.orchestrator.cancelMission(MISSION));
  });

  it('a próxima tarefa sem conta livre segue na conta atual', async () => {
    const h = harness({
      enabled: true,
      scripts: [[{ kind: 'hold' }], [{ kind: 'hold' }]],
      pick: () => Promise.resolve({ kind: 'none' }),
    });
    h.repo.insertMission(mission());
    h.repo.insertSteps([task('a', 1), task('b', 2, ['a'])]);

    void h.orchestrator.startMission(MISSION);
    await vi.waitFor(() => expect(h.agent.starts).toHaveLength(1));
    h.marks.set('trabalho', RESET);
    h.agent.sessions[0]?.releaseHold();
    await vi.waitFor(() => expect(h.agent.starts).toHaveLength(2));

    expect(h.agent.starts[1]?.accountId).toBe('trabalho');
    expect(h.repo.getMission(MISSION)?.status).toBe('running');
    data(await h.orchestrator.cancelMission(MISSION));
  });

  it('nova tentativa evita a conta esgotada', async () => {
    const h = harness({ enabled: true, scripts: [[{ kind: 'hold' }]] });
    h.marks.set('trabalho', RESET);
    h.repo.insertMission(mission({ status: 'failed' }));

    void h.orchestrator.retryMission(MISSION);
    await vi.waitFor(() => expect(h.agent.starts).toHaveLength(1));

    expect(h.agent.starts[0]?.accountId).toBe('pessoal');
    data(await h.orchestrator.cancelMission(MISSION));
  });
});
