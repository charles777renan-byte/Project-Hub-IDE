import { describe, expect, it } from 'vitest';
import type {
  AgentAdapter,
  AgentEvent,
  AgentSession,
  AgentStartInput,
} from '@project-hub/agent-sdk';
import type { AppResult } from '@project-hub/contracts';
import type { WorktreePort } from '../src/ports';
import type { Mission } from '@project-hub/domain';
import { createOrchestrator, type Orchestrator } from '../src/missions/orchestrator';
import { fakeRepository } from './fakes';
import { fakeMissionRepository, fakeWorktrees, type FakeMissionRepository } from './fakes-missions';

// Fila de execuções, limite de missões com agente vivo e reanexação depois de reabrir o app.
// O agente aqui é controlado pelo teste: ele empurra os eventos e decide quando a sessão termina.

const T0 = '2026-10-20T09:00:00.000Z';
const AT = '2026-10-20T10:00:00.000Z';

/** Evento sem carimbo: a sessão põe o `at`. Distribuído sobre a união para cada variante manter os próprios campos. */
type Unstamped<T> = T extends unknown ? Omit<T, 'at'> : never;

type Live = {
  push(event: Unstamped<AgentEvent>): void;
  finish(): void;
};

/** Sessão controlada: `push` acrescenta um evento com o próximo número, e a posição segue o último entregue. */
function makeSession(
  id: string,
  fromSeq: number,
  stops: string[],
): { session: AgentSession; live: Live } {
  const queue: ({ seq: number; event: Unstamped<AgentEvent> } | 'end')[] = [];
  let wake: (() => void) | undefined;
  let produced = fromSeq;
  let position = fromSeq;
  const signal = () => {
    wake?.();
    wake = undefined;
  };
  const live: Live = {
    push(event) {
      produced += 1;
      queue.push({ seq: produced, event });
      signal();
    },
    finish() {
      queue.push('end');
      signal();
    },
  };
  async function* events(): AsyncGenerator<AgentEvent> {
    for (;;) {
      while (queue.length === 0) await new Promise<void>((resolve) => (wake = resolve));
      const item = queue.shift();
      if (item === undefined) continue;
      if (item === 'end') return;
      position = item.seq;
      yield { ...item.event, at: AT } as AgentEvent;
    }
  }
  const session: AgentSession = {
    id,
    events: () => events(),
    cursor: () => (position > 0 ? String(position) : undefined),
    externalInput: true,
    send: () => Promise.resolve(),
    approve: () => Promise.resolve(),
    pause: () => Promise.resolve(),
    resume: () => Promise.resolve(),
    stop: (reason) => {
      stops.push(reason);
      live.finish();
      return Promise.resolve();
    },
  };
  return { session, live };
}

type ControlledAgent = AgentAdapter & {
  starts: AgentStartInput[];
  attaches: [string, string][];
  lives: Map<string, Live>;
};

/** Agente controlado: `alive` diz quais sessões ainda existem para a reanexação. */
function controlledAgent(alive: Set<string>): ControlledAgent {
  const starts: AgentStartInput[] = [];
  const attaches: [string, string][] = [];
  const lives = new Map<string, Live>();
  const stops: string[] = [];
  let count = 0;
  return {
    type: 'controlado',
    starts,
    attaches,
    lives,
    probe: () => Promise.resolve({ available: true }),
    getCapabilities: () =>
      Promise.resolve({
        streaming: false,
        tools: false,
        interactiveInput: true,
        approvals: true,
        pauseResume: true,
        attachments: false,
        usageReporting: false,
        persistentContext: false,
        localExecution: true,
        models: [],
      }),
    start: (input) => {
      starts.push(input);
      count += 1;
      const id = `sessao-${count}`;
      const { session, live } = makeSession(id, 0, stops);
      lives.set(id, live);
      alive.add(id);
      return Promise.resolve(session);
    },
    attach: (sessionId, cursor) => {
      attaches.push([sessionId, cursor]);
      if (!alive.has(sessionId)) return Promise.resolve(undefined);
      const { session, live } = makeSession(sessionId, Number(cursor), stops);
      lives.set(sessionId, live);
      return Promise.resolve(session);
    },
  };
}

function missionFixture(overrides: Partial<Mission> = {}): Mission {
  return {
    id: 'm1',
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
    ...overrides,
  };
}

function setup(maxRunning?: number, worktrees: WorktreePort = fakeWorktrees()) {
  const repo: FakeMissionRepository = fakeMissionRepository();
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
  const alive = new Set<string>();
  const agent = controlledAgent(alive);
  let tick = 0;
  let ids = 0;
  const build = (): Orchestrator =>
    createOrchestrator({
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
      ...(maxRunning === undefined ? {} : { maxRunning }),
      now: () => new Date(Date.UTC(2026, 9, 20, 10, 0, tick++)).toISOString(),
      newId: () => `id-${++ids}`,
    });
  return { repo, agent, alive, build, orchestrator: build() };
}

function data<T>(result: AppResult<T>): T {
  if (!result.ok) throw new Error(`esperava sucesso: ${result.error.code} ${result.error.message}`);
  return result.data;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Inicia uma missão que roda: a chamada só termina quando a sessão para, então espera o status. */
function startRunning(h: ReturnType<typeof setup>, id: string): Promise<void> {
  void h.orchestrator.startMission(id);
  return waitFor(() => h.repo.getMission(id)?.status === 'running');
}

async function waitFor(condition: () => boolean, timeoutMs = 2_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!condition()) {
    if (Date.now() > deadline) throw new Error('a condição não aconteceu a tempo');
    await sleep(5);
  }
}

describe('fila de execuções', () => {
  it('o terceiro início entra na fila, e começa quando uma vaga abre', async () => {
    const h = setup(2);
    h.repo.insertMission(missionFixture({ id: 'm1' }));
    h.repo.insertMission(missionFixture({ id: 'm2' }));
    h.repo.insertMission(missionFixture({ id: 'm3' }));
    await startRunning(h, 'm1');
    await startRunning(h, 'm2');

    const queued = data(await h.orchestrator.startMission('m3'));

    expect(queued.status).toBe('queued');
    expect(h.repo.getMission('m3')?.status).toBe('queued');
    expect(h.agent.starts).toHaveLength(2);

    h.agent.lives.get('sessao-1')?.push({ type: 'session.completed', result: { summary: 'ok' } });

    await waitFor(() => h.repo.getMission('m3')?.status === 'running');
    expect(h.agent.starts).toHaveLength(3);
    expect(h.repo.getExecution(queued.id)?.status).toBe('running');
  });

  it('cancelar a tentativa da fila a fecha, sem acordar o agente', async () => {
    const h = setup(1);
    h.repo.insertMission(missionFixture({ id: 'm1' }));
    h.repo.insertMission(missionFixture({ id: 'm2' }));
    await startRunning(h, 'm1');
    const queued = data(await h.orchestrator.startMission('m2'));

    expect((await h.orchestrator.cancelMission('m2')).ok).toBe(true);

    expect(h.repo.getExecution(queued.id)?.status).toBe('cancelled');
    expect(h.repo.getMission('m2')?.status).toBe('cancelled');
    expect(h.agent.starts).toHaveLength(1);
  });

  it('um início repetido na fila devolve a mesma tentativa, sem criar outra', async () => {
    const h = setup(1);
    h.repo.insertMission(missionFixture({ id: 'm1' }));
    h.repo.insertMission(missionFixture({ id: 'm2' }));
    await startRunning(h, 'm1');
    const first = data(await h.orchestrator.startMission('m2'));

    const again = data(await h.orchestrator.startMission('m2'));

    expect(again.id).toBe(first.id);
    expect(h.repo.listExecutions('m2')).toHaveLength(1);
  });
});

describe('reanexação ao abrir o app', () => {
  it('reanexa uma execução viva a partir da posição gravada, e segue até o fim', async () => {
    const h = setup();
    h.alive.add('sessao-viva');
    h.repo.insertMission(missionFixture({ id: 'm1', status: 'running' }));
    h.repo.insertExecution({
      id: 'exec-1',
      missionId: 'm1',
      attempt: 1,
      status: 'running',
      agentSessionId: 'sessao-viva',
      agentCursor: '2',
      startedAt: T0,
    });

    const orchestrator = h.build();
    await orchestrator.cancelMission('nao-existe');
    await waitFor(() => h.agent.attaches.length === 1);

    expect(h.agent.attaches).toEqual([['sessao-viva', '2']]);
    h.agent.lives
      .get('sessao-viva')
      ?.push({ type: 'session.completed', result: { summary: 'ok' } });
    await waitFor(() => h.repo.getMission('m1')?.status === 'review');
    expect(h.repo.getExecution('exec-1')?.status).toBe('succeeded');
    expect(h.agent.starts).toHaveLength(0);
  });

  it('sessão que não existe mais fecha a execução como interrompida pelo reinício', async () => {
    const h = setup();
    h.repo.insertMission(missionFixture({ id: 'm1', status: 'running' }));
    h.repo.insertExecution({
      id: 'exec-1',
      missionId: 'm1',
      attempt: 1,
      status: 'running',
      agentSessionId: 'sessao-morta',
      agentCursor: '2',
      startedAt: T0,
    });

    const orchestrator = h.build();
    await orchestrator.cancelMission('nao-existe');

    expect(h.repo.getExecution('exec-1')).toMatchObject({
      status: 'failed',
      exitReason: 'interrupted_by_restart',
    });
    expect(h.repo.getMission('m1')?.status).toBe('failed');
  });

  it('execução sem posição gravada não é reanexada, e fecha como interrompida', async () => {
    const h = setup();
    h.alive.add('sessao-viva');
    h.repo.insertMission(missionFixture({ id: 'm1', status: 'running' }));
    h.repo.insertExecution({
      id: 'exec-1',
      missionId: 'm1',
      attempt: 1,
      status: 'running',
      agentSessionId: 'sessao-viva',
      startedAt: T0,
    });

    const orchestrator = h.build();
    await orchestrator.cancelMission('nao-existe');

    expect(h.agent.attaches).toHaveLength(0);
    expect(h.repo.getExecution('exec-1')?.status).toBe('failed');
  });

  it('a posição do agente é gravada com cada evento aplicado, e o id da sessão vem do adaptador', async () => {
    const h = setup();
    h.repo.insertMission(missionFixture({ id: 'm1' }));
    await startRunning(h, 'm1');
    const live = h.agent.lives.get('sessao-1');

    live?.push({ type: 'session.started', sessionId: 'id-do-claude' });
    live?.push({ type: 'usage.updated', usage: { inputTokens: 1, outputTokens: 2 } });

    await waitFor(() => h.repo.listExecutions('m1')[0]?.agentCursor === '2');
    expect(h.repo.listExecutions('m1')[0]?.agentSessionId).toBe('sessao-1');
  });

  it('o gasto de tokens fica na tentativa, o último total vence, e não entra na auditoria', async () => {
    const h = setup();
    h.repo.insertMission(missionFixture({ id: 'm1' }));
    await startRunning(h, 'm1');
    const live = h.agent.lives.get('sessao-1');

    live?.push({ type: 'usage.updated', usage: { inputTokens: 1, outputTokens: 2 } });
    live?.push({
      type: 'usage.updated',
      usage: { inputTokens: 3, outputTokens: 9, cacheReadInputTokens: 40, estimatedCostUsd: 0.5 },
    });

    await waitFor(() => h.repo.listExecutions('m1')[0]?.agentCursor === '2');
    const execution = h.repo.listExecutions('m1')[0];
    expect(execution?.usage).toEqual({
      inputTokens: 3,
      outputTokens: 9,
      cacheReadInputTokens: 40,
      estimatedCostUsd: 0.5,
    });
    expect(
      h.repo.listAudit(execution?.id ?? '').filter((event) => event.eventType === 'usage.updated'),
    ).toEqual([]);
  });
});

describe('fila: falha antes de rodar', () => {
  it('tentativa da fila cujo worktree falha vira failed uma vez só, sem repetir sem parar', async () => {
    let attempts = 0;
    const failing: WorktreePort = {
      create: () => {
        attempts += 1;
        return Promise.reject(
          Object.assign(new Error('sem espaço'), { code: 'WORKTREE_CREATE_FAILED' }),
        );
      },
      remove: () => Promise.resolve(),
    };
    const h = setup(1, failing);
    // m1 já tem worktree, então não passa pela criação que falha.
    h.repo.insertMission(
      missionFixture({ id: 'm1', worktreeId: 'w1', worktreePath: 'C:/hub/worktrees/m1' }),
    );
    h.repo.insertMission(missionFixture({ id: 'm2' }));
    await startRunning(h, 'm1');
    const queued = data(await h.orchestrator.startMission('m2'));

    h.agent.lives.get('sessao-1')?.push({ type: 'session.completed', result: { summary: 'ok' } });

    await waitFor(() => h.repo.getExecution(queued.id)?.status === 'failed');
    await sleep(100);
    expect(attempts).toBe(1);
    expect(h.repo.getMission('m2')?.status).toBe('queued');
  });
});

describe('resposta dada no terminal', () => {
  it('a missão volta de aguardando para rodando quando o adaptador avisa que a resposta chegou', async () => {
    const h = setup();
    h.repo.insertMission(missionFixture({ id: 'm1' }));
    await startRunning(h, 'm1');
    const live = h.agent.lives.get('sessao-1');

    live?.push({ type: 'input.requested', request: { id: 'n1', prompt: 'Permissão?' } });
    await waitFor(() => h.repo.getMission('m1')?.status === 'waiting_input');
    live?.push({ type: 'input.received' });

    await waitFor(() => h.repo.getMission('m1')?.status === 'running');
  });
});
