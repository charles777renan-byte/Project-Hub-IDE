import {
  TerminalPortError,
  type MissionRepository,
  type ProjectRepository,
  type TerminalPort,
} from '@project-hub/application';
import type { TerminalEvent } from '@project-hub/contracts';
import type { TerminalSessionRecord, TerminalSessionRepository } from '@project-hub/database';
import { describe, expect, it } from 'vitest';
import type { ProviderRegistry } from '../src/main/providers';
import { createTerminalService } from '../src/main/terminals';

type Execution = NonNullable<ReturnType<MissionRepository['getExecution']>>;
type Mission = NonNullable<ReturnType<MissionRepository['getMission']>>;
type ProjectRecord = NonNullable<ReturnType<ProjectRepository['get']>>;

const project = { id: 'p1', name: 'app', path: 'C:/dev/app' } as ProjectRecord;
const otherProject = { id: 'p2', name: 'outro', path: 'C:/dev/outro' } as ProjectRecord;

const UNAVAILABLE_REASON =
  'Codex não foi encontrado no PATH. Instale o programa e reabra o Project Hub.';

/** Registro falso: o shell abre, o Codex está ausente. */
const providers: ProviderRegistry = {
  list: () => [
    { id: 'claude', label: 'Claude Code', available: true },
    { id: 'codex', label: 'Codex', available: false, reason: UNAVAILABLE_REASON },
    { id: 'gemini', label: 'Gemini CLI', available: true },
    { id: 'shell', label: 'PowerShell', available: true },
  ],
  resolve: (id) =>
    id === 'codex'
      ? { ok: false, reason: UNAVAILABLE_REASON }
      : { ok: true, launch: { command: `${id}.exe`, args: id === 'shell' ? ['-NoLogo'] : [] } },
};

function memorySessions(initial: TerminalSessionRecord[] = []) {
  const rows = new Map(initial.map((row) => [row.id, row]));
  const repo: TerminalSessionRepository = {
    insert: (record) => {
      rows.set(record.id, { ...record });
    },
    get: (id) => rows.get(id),
    listOpen: () => [...rows.values()].filter((row) => row.closedAt === undefined),
    close: (id, closedAt) => {
      const row = rows.get(id);
      if (row !== undefined) rows.set(id, { ...row, closedAt });
    },
  };
  return { repo, rows };
}

function setup(
  options: {
    executions?: Execution[];
    missions?: Mission[];
    failOpen?: boolean;
    sessions?: TerminalSessionRecord[];
    snapshot?: Awaited<ReturnType<TerminalPort['snapshot']>> | 'fail';
    killError?: Error;
    slowSubscribe?: boolean;
  } = {},
) {
  const opened: {
    id: string;
    cwd: string;
    command: string;
    args: readonly string[];
    env: Record<string, string>;
  }[] = [];
  const written: string[] = [];
  const events: TerminalEvent[] = [];
  const killedIds: string[] = [];
  let subscriber: Parameters<TerminalPort['subscribe']>[1] | undefined;
  let unsubscribed = 0;
  let finishSubscribe: () => void = () => undefined;
  const sessions = memorySessions(options.sessions);
  const ids = ['shell-1', 'shell-2', 'shell-3'];
  const port: TerminalPort = {
    open: (input) => {
      if (options.failOpen === true) {
        return Promise.reject(new TerminalPortError('PROCESS_START_FAILED', 'não abriu'));
      }
      opened.push({
        id: input.id,
        cwd: input.cwd,
        command: input.command,
        args: input.args,
        env: { ...input.env },
      });
      return Promise.resolve();
    },
    write: (_id, data) => {
      written.push(data);
      return Promise.resolve();
    },
    resize: () => Promise.resolve(),
    kill: (id) => {
      killedIds.push(id);
      return options.killError === undefined
        ? Promise.resolve()
        : Promise.reject(options.killError);
    },
    snapshot: () =>
      options.snapshot === 'fail'
        ? Promise.reject(new TerminalPortError('TERMINAL_HOST_UNAVAILABLE', 'sem host'))
        : Promise.resolve('snapshot' in options ? options.snapshot : { alive: true }),
    subscribe: (_id, next) => {
      subscriber = next;
      const stop = () => {
        unsubscribed += 1;
      };
      if (options.slowSubscribe !== true) return Promise.resolve(stop);
      return new Promise((resolve) => {
        finishSubscribe = () => resolve(stop);
      });
    },
  };
  const service = createTerminalService({
    port,
    repo: {
      findExecutionsByStatus: (status) =>
        (options.executions ?? []).filter((e) => e.status === status),
      getMission: (id) => (options.missions ?? []).find((m) => m.id === id),
    },
    projects: {
      get: (id) => [project, otherProject].find((p) => p.id === id),
    },
    sessions: sessions.repo,
    providers,
    publish: (event) => events.push(event),
    env: { PATH: 'C:/Windows', ANTHROPIC_API_KEY: 'segredo' },
    newId: () => ids.shift() ?? 'shell-x',
    now: () => '2026-10-22T12:00:00.000Z',
  });
  return {
    service,
    sessions,
    opened,
    written,
    events,
    killed: () => killedIds.length,
    killedIds,
    unsubscribed: () => unsubscribed,
    subscriber: () => subscriber,
    finishSubscribe: () => finishSubscribe(),
  };
}

const agentExecution: Execution = {
  id: 'e1',
  missionId: 'm1',
  attempt: 1,
  status: 'running',
  agentSessionId: 'sessao-agente',
};
const mission = {
  id: 'm1',
  projectId: 'p1',
  title: 'Corrigir login',
  status: 'waiting_input',
} as Mission;

const storedSession: TerminalSessionRecord = {
  id: 'antiga',
  projectId: 'p1',
  provider: 'codex',
  title: 'Codex · app',
  createdAt: '2026-10-21T09:00:00.000Z',
};

describe('serviço de terminais do app', () => {
  it('abre a sessão do provedor na pasta do projeto, grava no banco e usa o ambiente filtrado', async () => {
    const h = setup();

    const result = await h.service.openSession('p1', 'shell');

    expect(result).toEqual({ ok: true, data: { terminalId: 'shell-1' } });
    expect(h.opened[0]).toMatchObject({
      id: 'shell-1',
      cwd: 'C:/dev/app',
      command: 'shell.exe',
      args: ['-NoLogo'],
    });
    expect(h.opened[0]?.env).not.toHaveProperty('ANTHROPIC_API_KEY');
    expect(h.sessions.rows.get('shell-1')).toEqual({
      id: 'shell-1',
      projectId: 'p1',
      provider: 'shell',
      title: 'PowerShell · app',
      createdAt: '2026-10-22T12:00:00.000Z',
    });
  });

  it('provedor indisponível devolve PROCESS_START_FAILED com o motivo, sem abrir nem gravar', async () => {
    const h = setup();

    const result = await h.service.openSession('p1', 'codex');

    expect(result).toMatchObject({
      ok: false,
      error: { code: 'PROCESS_START_FAILED', message: UNAVAILABLE_REASON },
    });
    expect(h.opened).toEqual([]);
    expect(h.sessions.rows.size).toBe(0);
  });

  it('projeto desconhecido e falha ao abrir viram falhas com código do contrato, sem linha no banco', async () => {
    expect(await setup().service.openSession('nao-existe', 'shell')).toMatchObject({
      ok: false,
      error: { code: 'PROJECT_NOT_FOUND' },
    });
    const failing = setup({ failOpen: true });
    expect(await failing.service.openSession('p1', 'shell')).toMatchObject({
      ok: false,
      error: { code: 'PROCESS_START_FAILED' },
    });
    expect(failing.sessions.rows.size).toBe(0);
  });

  it('lista os agentes em andamento e as sessões abertas, com provedor, origem e estado', async () => {
    const h = setup({ executions: [agentExecution], missions: [mission] });
    await h.service.openSession('p1', 'shell');

    const result = await h.service.list();

    expect(result).toMatchObject({
      ok: true,
      data: [
        {
          id: 'sessao-agente',
          kind: 'agent',
          title: 'Corrigir login',
          state: 'waiting',
          missionId: 'm1',
          provider: 'claude',
          origin: 'new',
        },
        {
          id: 'shell-1',
          kind: 'shell',
          title: 'PowerShell · app',
          projectName: 'app',
          state: 'running',
          provider: 'shell',
          origin: 'new',
        },
      ],
    });
  });

  it('sessão do banco que este serviço não abriu sai como recuperada e rodando, se o processo responde', async () => {
    const h = setup({ sessions: [storedSession] });

    const result = await h.service.list();

    expect(result).toMatchObject({
      ok: true,
      data: [
        {
          id: 'antiga',
          title: 'Codex · app',
          projectId: 'p1',
          projectName: 'app',
          provider: 'codex',
          origin: 'recovered',
          state: 'running',
        },
      ],
    });
  });

  it('sessão do banco cujo processo não responde ou acabou sai como encerrada e continua aberta', async () => {
    const failing = setup({ sessions: [storedSession], snapshot: 'fail' });
    const dead = setup({ sessions: [storedSession], snapshot: { alive: false } });

    for (const h of [failing, dead]) {
      expect(await h.service.list()).toMatchObject({
        ok: true,
        data: [{ id: 'antiga', origin: 'recovered', state: 'exited' }],
      });
      expect(h.sessions.rows.get('antiga')?.closedAt).toBeUndefined();
    }
  });

  it('sessão do banco que o processo de terminais não conhece é fechada e some da lista', async () => {
    const h = setup({ sessions: [storedSession], snapshot: undefined });

    expect(await h.service.list()).toEqual({ ok: true, data: [] });
    expect(h.sessions.rows.get('antiga')?.closedAt).toBe('2026-10-22T12:00:00.000Z');
  });

  it('o terminal do agente leva só o nome do worktree, não o caminho', async () => {
    const withWorktree = {
      ...mission,
      worktreePath: 'C:\\hub\\worktrees\\app\\missao-1',
    } as Mission;
    const h = setup({ executions: [agentExecution], missions: [withWorktree] });

    const result = await h.service.list();

    expect(result).toMatchObject({ ok: true, data: [{ worktreeName: 'missao-1' }] });
    expect(JSON.stringify(result)).not.toContain('hub');
  });

  it('recusa escrever num terminal que o app não conhece', async () => {
    const h = setup();

    expect(await h.service.write('qualquer-id', 'rm -rf')).toMatchObject({
      ok: false,
      error: { code: 'TERMINAL_NOT_FOUND' },
    });
    expect(h.written).toEqual([]);
  });

  it('escreve numa sessão do banco e num agente conhecidos, e redimensiona', async () => {
    const h = setup({
      executions: [agentExecution],
      missions: [mission],
      sessions: [storedSession],
    });

    await h.service.write('antiga', 'ls\r');
    await h.service.write('sessao-agente', 'oi\r');

    expect(h.written).toEqual(['ls\r', 'oi\r']);
    expect((await h.service.resize('antiga', 80, 24)).ok).toBe(true);
  });

  it('sessão já fechada deixa de ser conhecida', async () => {
    const h = setup({ sessions: [{ ...storedSession, closedAt: '2026-10-21T10:00:00.000Z' }] });

    expect(await h.service.write('antiga', 'x')).toMatchObject({
      ok: false,
      error: { code: 'TERMINAL_NOT_FOUND' },
    });
  });

  it('assinar entrega saída, reinício e fim como eventos, e cancelar solta a assinatura', async () => {
    const h = setup({ sessions: [storedSession] });
    await h.service.subscribe('antiga');

    h.subscriber()?.onRestart();
    h.subscriber()?.onData('oi');
    h.subscriber()?.onExit({ exitCode: 3 });
    await h.service.unsubscribe('antiga');

    expect(h.events).toEqual([
      { type: 'restart', terminalId: 'antiga' },
      { type: 'data', terminalId: 'antiga', data: 'oi' },
      { type: 'exit', terminalId: 'antiga', exitCode: 3 },
    ]);
    expect(h.unsubscribed()).toBe(1);
  });

  it('closeSession mata o processo e marca a sessão como fechada', async () => {
    const h = setup();
    await h.service.openSession('p1', 'shell');

    expect((await h.service.closeSession('shell-1')).ok).toBe(true);

    expect(h.killedIds).toEqual(['shell-1']);
    expect(h.sessions.rows.get('shell-1')?.closedAt).toBe('2026-10-22T12:00:00.000Z');
    expect(await h.service.list()).toEqual({ ok: true, data: [] });
  });

  it('closeSession de terminal de missão devolve VALIDATION_FAILED e não mata nada', async () => {
    const h = setup({ executions: [agentExecution], missions: [mission] });

    expect(await h.service.closeSession('sessao-agente')).toMatchObject({
      ok: false,
      error: { code: 'VALIDATION_FAILED' },
    });
    expect(h.killed()).toBe(0);
  });

  it('closeSession de id desconhecido devolve TERMINAL_NOT_FOUND', async () => {
    const h = setup();

    expect(await h.service.closeSession('nao-existe')).toMatchObject({
      ok: false,
      error: { code: 'TERMINAL_NOT_FOUND' },
    });
  });

  it('closeSession fecha a sessão mesmo quando o processo já não existe', async () => {
    const h = setup({
      sessions: [storedSession],
      killError: new TerminalPortError('TERMINAL_NOT_FOUND', 'sumiu'),
    });

    expect((await h.service.closeSession('antiga')).ok).toBe(true);
    expect(h.sessions.rows.get('antiga')?.closedAt).toBe('2026-10-22T12:00:00.000Z');
  });

  it('closeSession com outra falha ao matar mantém a sessão aberta', async () => {
    const h = setup({
      sessions: [storedSession],
      killError: new TerminalPortError('TERMINAL_HOST_UNAVAILABLE', 'sem host'),
    });

    expect(await h.service.closeSession('antiga')).toMatchObject({
      ok: false,
      error: { code: 'TERMINAL_HOST_UNAVAILABLE' },
    });
    expect(h.sessions.rows.get('antiga')?.closedAt).toBeUndefined();
  });

  it('knownIds traz as sessões abertas e as missões do projeto, e não as de outro', async () => {
    const otherMission = { ...mission, id: 'm2', projectId: 'p2' } as Mission;
    const otherExecution: Execution = {
      ...agentExecution,
      id: 'e2',
      missionId: 'm2',
      agentSessionId: 'sessao-outro',
    };
    const h = setup({
      executions: [agentExecution, otherExecution],
      missions: [mission, otherMission],
      sessions: [
        storedSession,
        { ...storedSession, id: 'de-outro', projectId: 'p2' },
        { ...storedSession, id: 'fechada', closedAt: '2026-10-21T10:00:00.000Z' },
      ],
    });

    expect(await h.service.knownIds('p1')).toEqual(new Set(['antiga', 'sessao-agente']));
  });

  it('stateOf distingue rodando, encerrado e desconhecido', async () => {
    const alive = setup({ sessions: [storedSession] });
    const exitedInHost = setup({ snapshot: { alive: false } });
    const goneButOpen = setup({ sessions: [storedSession], snapshot: undefined });
    const failing = setup({ sessions: [storedSession], snapshot: 'fail' });
    const unknown = setup({ snapshot: undefined });

    expect(await alive.service.stateOf('antiga')).toBe('running');
    expect(await exitedInHost.service.stateOf('qualquer')).toBe('exited');
    expect(await goneButOpen.service.stateOf('antiga')).toBe('unknown');
    expect(goneButOpen.sessions.rows.get('antiga')?.closedAt).toBe('2026-10-22T12:00:00.000Z');
    expect(await failing.service.stateOf('antiga')).toBe('exited');
    expect(failing.sessions.rows.get('antiga')?.closedAt).toBeUndefined();
    expect(await unknown.service.stateOf('qualquer')).toBe('unknown');
  });

  it('cancelar a assinatura antes de o processo responder solta a assinatura que chega depois', async () => {
    const h = setup({ sessions: [storedSession], slowSubscribe: true });

    const pending = h.service.subscribe('antiga');
    await h.service.unsubscribe('antiga');
    h.finishSubscribe();
    await pending;

    expect(h.unsubscribed()).toBe(1);
  });
});
