import {
  TerminalPortError,
  type MissionRepository,
  type ProjectRepository,
  type TerminalPort,
} from '@project-hub/application';
import {
  appendFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { codexHookArgs, type HookRecord } from '@project-hub/agent-adapters';
import type { TerminalEvent } from '@project-hub/contracts';
import type { TerminalSessionRecord, TerminalSessionRepository } from '@project-hub/database';
import type { AgentBrowserAccess } from '../src/main/browser/agent/agent-launch';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ProviderRegistry } from '../src/main/providers';
import { CODEX_API_PROVIDER_ARGS } from '../src/main/accounts/account-paths';
import { createTerminalService, type TerminalServiceDeps } from '../src/main/terminals';

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
    { id: 'antigravity', label: 'Antigravity CLI', available: true },
    { id: 'shell', label: 'PowerShell', available: true },
  ],
  resolve: (id) =>
    id === 'codex'
      ? { ok: false, reason: UNAVAILABLE_REASON }
      : { ok: true, launch: { command: `${id}.exe`, args: id === 'shell' ? ['-NoLogo'] : [] } },
};

const TRANSCRIPT_SESSION = '11111111-2222-3333-4444-555555555555';
const HOOK_TOKEN = 'token-secreto-do-hook';

/** Pasta de dados do Claude Code (transcripts) e pasta de configuração dos hooks, novas a cada teste. */
let claudeDir = '';
let codexDir = '';
let dataDir = '';
beforeEach(() => {
  claudeDir = mkdtempSync(join(tmpdir(), 'ph-terminals-claude-'));
  codexDir = mkdtempSync(join(tmpdir(), 'ph-terminals-codex-'));
  dataDir = mkdtempSync(join(tmpdir(), 'ph-terminals-data-'));
});
afterEach(() => {
  rmSync(claudeDir, { recursive: true, force: true });
  rmSync(codexDir, { recursive: true, force: true });
  rmSync(dataDir, { recursive: true, force: true });
});

function settingsDir(): string {
  return join(dataDir, 'terminal-host', 'settings');
}

/** Grava uma resposta no transcript da sessão e devolve o caminho dele. */
function writeAnswer(output: number, session = TRANSCRIPT_SESSION): string {
  const folder = join(claudeDir, 'projects', 'C--dev-app');
  mkdirSync(folder, { recursive: true });
  const file = join(folder, `${session}.jsonl`);
  appendFileSync(
    file,
    `${JSON.stringify({
      type: 'assistant',
      message: {
        model: 'claude-sonnet-5-5',
        id: `msg_${output}`,
        usage: { input_tokens: 2, output_tokens: output },
      },
    })}\n`,
  );
  return file;
}

/** Receptor de hooks falso: registra, solta e devolve o log de cada terminal. */
function fakeHooks(options: { failRegister?: boolean } = {}) {
  const registered: string[] = [];
  const unregistered: string[] = [];
  const logs = new Map<string, HookRecord[]>();
  const reads: { id: string; afterSeq: number }[] = [];
  return {
    registered,
    unregistered,
    reads,
    push(terminalId: string, payload: Record<string, unknown>) {
      const log = logs.get(terminalId) ?? [];
      log.push({ seq: log.length + 1, receivedAt: '2026-10-22T12:00:00.000Z', payload });
      logs.set(terminalId, log);
    },
    sessionStart(terminalId: string, transcriptPath: string, session = TRANSCRIPT_SESSION) {
      const log = logs.get(terminalId) ?? [];
      log.push({
        seq: log.length + 1,
        receivedAt: '2026-10-22T12:00:00.000Z',
        payload: {
          hook_event_name: 'SessionStart',
          session_id: session,
          transcript_path: transcriptPath,
        },
      });
      logs.set(terminalId, log);
    },
    hooks: {
      registerExecution: (id: string) => {
        if (options.failRegister === true) {
          return Promise.reject(new Error('processo de terminais fora do ar'));
        }
        registered.push(id);
        return Promise.resolve({ token: HOOK_TOKEN, url: `http://127.0.0.1:4000/hooks/${id}` });
      },
      unregisterExecution: (id: string) => {
        unregistered.push(id);
        return Promise.resolve();
      },
      readAfter: (id: string, afterSeq: number) => {
        reads.push({ id, afterSeq });
        return Promise.resolve((logs.get(id) ?? []).filter((r) => r.seq > afterSeq));
      },
    },
  };
}

function memorySessions(initial: TerminalSessionRecord[] = []) {
  const rows = new Map(initial.map((row) => [row.id, row]));
  const repo: TerminalSessionRepository = {
    insert: (record) => {
      rows.set(record.id, { ...record });
    },
    get: (id) => rows.get(id),
    listOpen: () => [...rows.values()].filter((row) => row.closedAt === undefined),
    listAll: () => [...rows.values()],
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
    countChanges?: (folder: string) => Promise<number | undefined>;
    hooks?: ReturnType<typeof fakeHooks>;
    /** Pasta de configuração dos hooks. Padrão: uma pasta temporária nova. */
    settingsDir?: string;
    providers?: ProviderRegistry;
    browserAccess?: AgentBrowserAccess;
    accounts?: NonNullable<TerminalServiceDeps['accounts']>;
    unlockVault?: TerminalServiceDeps['unlockVault'];
  } = {},
) {
  const hooks = options.hooks ?? fakeHooks();
  let clock = Date.parse('2026-10-22T12:00:00.000Z');
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
    listen: () => Promise.resolve(() => undefined),
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
    providers: options.providers ?? providers,
    publish: (event) => events.push(event),
    countChanges: options.countChanges ?? (() => Promise.resolve(undefined)),
    env: {
      PATH: 'C:/Windows',
      ANTHROPIC_API_KEY: 'segredo',
      CLAUDE_CONFIG_DIR: claudeDir,
      CODEX_HOME: codexDir,
    },
    newId: () => ids.shift() ?? 'shell-x',
    now: () => new Date(clock).toISOString(),
    hooks: hooks.hooks,
    settingsDir: options.settingsDir ?? settingsDir(),
    platform: 'win32',
    ...(options.browserAccess === undefined ? {} : { browserAccess: options.browserAccess }),
    ...(options.accounts === undefined ? {} : { accounts: options.accounts }),
    ...(options.unlockVault === undefined ? {} : { unlockVault: options.unlockVault }),
  });
  return {
    service,
    hooks,
    /** Avança o relógio do serviço, em ms. */
    advance: (ms: number) => {
      clock += ms;
    },
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
  it('abre o terminal com COLORTERM=truecolor, sem deixar passar segredos do ambiente', async () => {
    const h = setup();

    await h.service.openSession('p1', 'shell');

    expect(h.opened[0]?.env).toMatchObject({ COLORTERM: 'truecolor', PATH: 'C:/Windows' });
    expect(h.opened[0]?.env).not.toHaveProperty('ANTHROPIC_API_KEY');
  });

  it('com pasta e argumentos dados, abre nessa pasta e põe os argumentos depois do comando (a retomada)', async () => {
    const h = setup();

    const result = await h.service.openSession('p1', 'shell', {
      cwd: 'C:/dev/outro',
      args: ['--resume', 'sessao'],
    });

    expect(result.ok).toBe(true);
    expect(h.opened[0]).toMatchObject({
      cwd: 'C:/dev/outro',
      command: 'shell.exe',
      args: ['-NoLogo', '--resume', 'sessao'],
    });
  });

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
    if (!result.ok) throw new Error('esperava sucesso');
    // A sessão avulsa diz quando começou; a de missão não traz hora de início.
    expect(result.data.find((entry) => entry.kind === 'shell')?.startedAt).toEqual(
      '2026-10-22T12:00:00.000Z',
    );
    expect(result.data.find((entry) => entry.kind === 'agent')).not.toHaveProperty('startedAt');
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
          startedAt: '2026-10-21T09:00:00.000Z',
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

  it('conta os arquivos alterados da pasta de cada sessão e reaproveita a contagem por alguns segundos', async () => {
    const folders: string[] = [];
    const withWorktree = {
      ...mission,
      worktreePath: 'C:\\hub\\worktrees\\app\\missao-1',
    } as Mission;
    const h = setup({
      executions: [agentExecution],
      missions: [withWorktree],
      countChanges: (folder) => {
        folders.push(folder);
        return Promise.resolve(3);
      },
    });
    await h.service.openSession('p1', 'shell');

    const first = await h.service.list();
    await h.service.list();

    expect(first).toMatchObject({
      ok: true,
      data: [
        { kind: 'agent', changedFiles: 3 },
        { kind: 'shell', changedFiles: 3 },
      ],
    });
    // Cada pasta é lida uma vez; a segunda leitura da lista cai dentro do prazo e não roda o Git de novo.
    expect(folders).toEqual(['C:\\hub\\worktrees\\app\\missao-1', 'C:/dev/app']);
  });

  it('pasta que não é repositório Git não traz a contagem', async () => {
    const h = setup({ countChanges: () => Promise.resolve(undefined) });
    await h.service.openSession('p1', 'shell');

    const result = await h.service.list();

    if (!result.ok) throw new Error('esperava sucesso');
    expect(result.data[0]).not.toHaveProperty('changedFiles');
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

  it('isMissionSession é verdadeiro só para o terminal de um agente em andamento', async () => {
    const h = setup({ executions: [agentExecution], missions: [mission] });
    await h.service.openSession('p1', 'shell');

    expect(h.service.isMissionSession('sessao-agente')).toBe(true);
    expect(h.service.isMissionSession('shell-1')).toBe(false);
    expect(h.service.isMissionSession('nao-existe')).toBe(false);
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

describe('gasto de tokens dos painéis do Claude Code', () => {
  const claudeSession: TerminalSessionRecord = {
    id: 'claude-antigo',
    projectId: 'p1',
    provider: 'claude',
    title: 'Claude Code · app',
    createdAt: '2026-10-21T09:00:00.000Z',
  };

  it('abre o Claude com --settings antes dos argumentos do provedor e o hook pelo ambiente', async () => {
    const h = setup();

    await h.service.openSession('p1', 'claude');

    const settingsFile = join(settingsDir(), 'shell-1.settings.json');
    expect(h.hooks.registered).toEqual(['shell-1']);
    expect(h.opened[0]).toMatchObject({
      command: 'claude.exe',
      args: ['--settings', settingsFile],
    });
    expect(h.opened[0]?.env).toMatchObject({
      COLORTERM: 'truecolor',
      PROJECT_HUB_HOOK_URL: 'http://127.0.0.1:4000/hooks/shell-1',
      PROJECT_HUB_HOOK_TOKEN: HOOK_TOKEN,
    });
    // O token vai só pelo ambiente: a linha de comando é visível para outros processos.
    expect(JSON.stringify(h.opened[0]?.args)).not.toContain(HOOK_TOKEN);
    expect(h.opened[0]?.env).not.toHaveProperty('ANTHROPIC_API_KEY');
    // O `PreToolUse` fica de fora: dispara antes do pedido de permissão e só encheria o log.
    const written = JSON.parse(readFileSync(settingsFile, 'utf8')) as {
      hooks: Record<string, unknown>;
    };
    expect(Object.keys(written.hooks)).toContain('SessionStart');
    expect(Object.keys(written.hooks)).not.toContain('PreToolUse');
  });

  it('o prefixo do programa (o script do CLI falso dos testes) vem antes do --settings', async () => {
    const h = setup({
      providers: {
        ...providers,
        resolve: () => ({
          ok: true,
          launch: { command: 'node.exe', prefix: ['C:/e2e/fake.mjs'], args: [] },
        }),
      },
    });

    await h.service.openSession('p1', 'claude');

    expect(h.opened[0]).toMatchObject({
      command: 'node.exe',
      args: ['C:/e2e/fake.mjs', '--settings', join(settingsDir(), 'shell-1.settings.json')],
    });
  });

  it('outros provedores abrem como antes, sem registro nem variáveis do hook', async () => {
    const h = setup();

    await h.service.openSession('p1', 'shell');
    await h.service.openSession('p1', 'antigravity');

    expect(h.hooks.registered).toEqual([]);
    expect(h.opened.map((o) => o.args)).toEqual([['-NoLogo'], []]);
    for (const opened of h.opened) {
      expect(opened.env).not.toHaveProperty('PROJECT_HUB_HOOK_URL');
      expect(opened.env).not.toHaveProperty('PROJECT_HUB_HOOK_TOKEN');
    }
  });

  it('falha ao registrar o hook não impede de abrir: o Claude abre puro e sem número', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    try {
      const h = setup({ hooks: fakeHooks({ failRegister: true }) });

      expect(await h.service.openSession('p1', 'claude')).toEqual({
        ok: true,
        data: { terminalId: 'shell-1' },
      });

      expect(h.opened[0]).toMatchObject({ command: 'claude.exe', args: [] });
      expect(h.opened[0]?.env).not.toHaveProperty('PROJECT_HUB_HOOK_TOKEN');
      expect(warn).toHaveBeenCalled();
      const result = await h.service.list();
      if (!result.ok) throw new Error('esperava sucesso');
      expect(result.data[0]).not.toHaveProperty('usage');
      expect(h.hooks.reads).toEqual([]);
    } finally {
      warn.mockRestore();
    }
  });

  it('falha ao gravar a configuração abre o Claude puro e solta o registro', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    try {
      // Um arquivo no lugar da pasta: a gravação falha.
      const blocked = join(dataDir, 'arquivo');
      writeFileSync(blocked, '');
      const h = setup({ settingsDir: join(blocked, 'settings') });

      expect((await h.service.openSession('p1', 'claude')).ok).toBe(true);

      expect(h.opened[0]?.args).toEqual([]);
      expect(h.opened[0]?.env).not.toHaveProperty('PROJECT_HUB_HOOK_TOKEN');
      expect(h.hooks.unregistered).toEqual(['shell-1']);
      expect(warn).toHaveBeenCalled();
    } finally {
      warn.mockRestore();
    }
  });

  it('falha ao abrir o terminal solta o registro do hook', async () => {
    const h = setup({ failOpen: true });

    expect((await h.service.openSession('p1', 'claude')).ok).toBe(false);

    expect(h.hooks.unregistered).toEqual(['shell-1']);
  });

  it('a lista traz o gasto só onde há número: painel do Claude e agente da missão com gasto gravado', async () => {
    const usage = { inputTokens: 40, outputTokens: 900, estimatedCostUsd: 0.02 };
    const otherMission = { ...mission, id: 'm2', title: 'Sem gasto' } as Mission;
    const h = setup({
      executions: [
        { ...agentExecution, usage },
        { ...agentExecution, id: 'e2', missionId: 'm2', agentSessionId: 'sessao-sem-gasto' },
      ],
      missions: [mission, otherMission],
    });
    await h.service.openSession('p1', 'claude');
    await h.service.openSession('p1', 'shell');
    h.hooks.sessionStart('shell-1', writeAnswer(120));

    const result = await h.service.list();

    if (!result.ok) throw new Error('esperava sucesso');
    const byId = new Map(result.data.map((entry) => [entry.id, entry]));
    expect(byId.get('sessao-agente')?.usage).toEqual(usage);
    expect(byId.get('sessao-sem-gasto')).not.toHaveProperty('usage');
    expect(byId.get('shell-1')?.usage).toMatchObject({ inputTokens: 2, outputTokens: 120 });
    expect(byId.get('shell-2')).not.toHaveProperty('usage');
  });

  it('a lista traz modelo e contexto no agente da missão com contexto gravado, com a janela do modelo', async () => {
    const usage = { inputTokens: 40, outputTokens: 900, estimatedCostUsd: 0.02 };
    const otherMission = { ...mission, id: 'm2', title: 'Modelo fora da tabela' } as Mission;
    const h = setup({
      executions: [
        { ...agentExecution, usage, context: { model: 'claude-opus-5-5', usedTokens: 76_000 } },
        {
          ...agentExecution,
          id: 'e2',
          missionId: 'm2',
          agentSessionId: 'sessao-outro-modelo',
          usage,
          context: { model: 'modelo-desconhecido', usedTokens: 50_000 },
        },
      ],
      missions: [mission, otherMission],
    });

    const result = await h.service.list();

    if (!result.ok) throw new Error('esperava sucesso');
    const byId = new Map(result.data.map((entry) => [entry.id, entry]));
    expect(byId.get('sessao-agente')).toMatchObject({
      model: 'claude-opus-5-5',
      context: { usedTokens: 76_000, windowTokens: 1_000_000 },
    });
    // Modelo que a tabela não conhece usa a janela padrão, como no painel avulso.
    expect(byId.get('sessao-outro-modelo')).toMatchObject({
      model: 'modelo-desconhecido',
      context: { usedTokens: 50_000, windowTokens: 200_000 },
    });
  });

  it('contexto gravado com nome de modelo longo demais não sai na lista, e a lista continua valendo', async () => {
    const usage = { inputTokens: 40, outputTokens: 900, estimatedCostUsd: 0.02 };
    const h = setup({
      executions: [
        { ...agentExecution, usage, context: { model: 'm'.repeat(101), usedTokens: 76_000 } },
      ],
      missions: [mission],
    });

    const result = await h.service.list();

    if (!result.ok) throw new Error('esperava sucesso');
    expect(result.data[0]).toMatchObject({ id: 'sessao-agente', usage });
    expect(result.data[0]).not.toHaveProperty('model');
    expect(result.data[0]).not.toHaveProperty('context');
  });

  it('a lista traz modelo e contexto no painel avulso do Claude com resposta, nunca na missão sem contexto nem em outro programa', async () => {
    const usage = { inputTokens: 40, outputTokens: 900, estimatedCostUsd: 0.02 };
    const h = setup({ executions: [{ ...agentExecution, usage }], missions: [mission] });
    await h.service.openSession('p1', 'claude');
    await h.service.openSession('p1', 'shell');
    h.hooks.sessionStart('shell-1', writeAnswer(120));

    const result = await h.service.list();

    if (!result.ok) throw new Error('esperava sucesso');
    const byId = new Map(result.data.map((entry) => [entry.id, entry]));
    expect(byId.get('shell-1')).toMatchObject({
      model: 'claude-sonnet-5-5',
      context: { usedTokens: 2, windowTokens: 1_000_000 },
    });
    expect(byId.get('shell-2')).not.toHaveProperty('model');
    expect(byId.get('shell-2')).not.toHaveProperty('context');
    expect(byId.get('sessao-agente')).not.toHaveProperty('model');
    expect(byId.get('sessao-agente')).not.toHaveProperty('context');
  });

  it('painel do Claude sem resposta, mas com o modelo dito pelo SessionStart, traz o modelo e não o contexto', async () => {
    const h = setup();
    await h.service.openSession('p1', 'claude');
    h.hooks.push('shell-1', { hook_event_name: 'SessionStart', model: 'claude-haiku-5-5' });

    const result = await h.service.list();

    if (!result.ok) throw new Error('esperava sucesso');
    expect(result.data[0]).toMatchObject({ id: 'shell-1', model: 'claude-haiku-5-5' });
    expect(result.data[0]).not.toHaveProperty('context');
  });

  it('com resposta, o modelo da resposta vence o do SessionStart', async () => {
    const h = setup();
    await h.service.openSession('p1', 'claude');
    h.hooks.push('shell-1', { hook_event_name: 'SessionStart', model: 'claude-haiku-5-5' });
    h.hooks.sessionStart('shell-1', writeAnswer(120));

    const result = await h.service.list();

    if (!result.ok) throw new Error('esperava sucesso');
    expect(result.data[0]).toMatchObject({ id: 'shell-1', model: 'claude-sonnet-5-5' });
    expect(result.data[0]).toHaveProperty('context');
  });

  it('painel do Claude sem resposta ainda não tem modelo nem contexto', async () => {
    const h = setup();
    await h.service.openSession('p1', 'claude');

    const result = await h.service.list();

    if (!result.ok) throw new Error('esperava sucesso');
    expect(result.data[0]).not.toHaveProperty('model');
    expect(result.data[0]).not.toHaveProperty('context');
  });

  it('painel do Claude sem resposta ainda não tem o campo (não é zero)', async () => {
    const h = setup();
    await h.service.openSession('p1', 'claude');

    const result = await h.service.list();

    if (!result.ok) throw new Error('esperava sucesso');
    expect(result.data[0]).not.toHaveProperty('usage');
  });

  it('o painel pede os hooks que dizem quando o Claude pede algo e quando volta a trabalhar', async () => {
    const h = setup();
    await h.service.openSession('p1', 'claude');

    const file = join(settingsDir(), 'shell-1.settings.json');
    const written = JSON.parse(readFileSync(file, 'utf8')) as { hooks: Record<string, unknown> };
    expect(Object.keys(written.hooks).sort()).toEqual([
      'Notification',
      'PermissionRequest',
      'PostToolUse',
      'PostToolUseFailure',
      'SessionEnd',
      'SessionStart',
      'Stop',
      'UserPromptSubmit',
    ]);
    // Com mais eventos no log, o hook manda só os campos que o app lê (sem comando, resposta nem mensagem).
    expect(h.opened[0]?.env).toMatchObject({ PROJECT_HUB_HOOK_SLIM: '1' });
  });

  it('o Claude avulso que pede permissão aparece aguardando, e volta a rodando quando a ferramenta termina', async () => {
    const h = setup();
    await h.service.openSession('p1', 'claude');
    expect(await h.service.list()).toMatchObject({ data: [{ id: 'shell-1', state: 'running' }] });

    h.hooks.push('shell-1', { hook_event_name: 'PermissionRequest' });
    h.advance(1500);
    expect(await h.service.list()).toMatchObject({ data: [{ id: 'shell-1', state: 'waiting' }] });

    h.hooks.push('shell-1', { hook_event_name: 'PostToolUse' });
    h.advance(1500);
    expect(await h.service.list()).toMatchObject({ data: [{ id: 'shell-1', state: 'running' }] });
  });

  it('a lista relê os transcripts no máximo a cada 1,5 s', async () => {
    const h = setup();
    await h.service.openSession('p1', 'claude');
    h.hooks.sessionStart('shell-1', writeAnswer(120));
    expect(await h.service.list()).toMatchObject({ data: [{ usage: { outputTokens: 120 } }] });
    writeAnswer(30);

    h.advance(1000);
    expect(await h.service.list()).toMatchObject({ data: [{ usage: { outputTokens: 120 } }] });
    h.advance(500);
    expect(await h.service.list()).toMatchObject({ data: [{ usage: { outputTokens: 150 } }] });
  });

  it('painel recuperado depois de reiniciar o app reaprende pelo log de hooks desde o começo', async () => {
    const hooks = fakeHooks();
    hooks.sessionStart('claude-antigo', writeAnswer(77));
    const h = setup({ sessions: [claudeSession], hooks });

    const result = await h.service.list();

    expect(result).toMatchObject({
      ok: true,
      data: [{ id: 'claude-antigo', origin: 'recovered', usage: { outputTokens: 77 } }],
    });
    expect(hooks.reads[0]).toEqual({ id: 'claude-antigo', afterSeq: 0 });
  });

  it('painel recuperado aberto antes deste recurso (sem hooks) não tem número', async () => {
    const h = setup({ sessions: [claudeSession] });

    const result = await h.service.list();

    if (!result.ok) throw new Error('esperava sucesso');
    expect(result.data[0]).toMatchObject({ id: 'claude-antigo', origin: 'recovered' });
    expect(result.data[0]).not.toHaveProperty('usage');
  });

  it('terminal de programa sem leitor nunca é lido, mesmo recuperado', async () => {
    const h = setup({ sessions: [{ ...storedSession, provider: 'antigravity' }] });

    await h.service.list();

    expect(h.hooks.reads).toEqual([]);
  });

  it('fechar o painel do Claude solta o registro e o leitor', async () => {
    const h = setup();
    await h.service.openSession('p1', 'claude');
    h.hooks.sessionStart('shell-1', writeAnswer(10));
    await h.service.list();

    expect((await h.service.closeSession('shell-1')).ok).toBe(true);
    h.hooks.reads.length = 0;
    h.advance(1500);
    await h.service.list();

    expect(h.hooks.unregistered).toEqual(['shell-1']);
    expect(h.hooks.reads).toEqual([]);
  });

  it('fechar um painel recuperado do Claude também solta o registro; o de programa sem leitor, não', async () => {
    const h = setup({ sessions: [claudeSession, { ...storedSession, provider: 'antigravity' }] });

    await h.service.closeSession('claude-antigo');
    await h.service.closeSession('antiga');

    expect(h.hooks.unregistered).toEqual(['claude-antigo']);
  });

  it('painel do Claude que o processo de terminais não conhece mais é fechado e solta o registro', async () => {
    const h = setup({ sessions: [claudeSession], snapshot: undefined });

    expect(await h.service.list()).toEqual({ ok: true, data: [] });

    expect(h.hooks.unregistered).toEqual(['claude-antigo']);
  });
});

describe('gasto de tokens dos painéis do Codex', () => {
  const CODEX_SESSION = '01a1e218-c798-71f0-bf48-72a4f485076c';
  /** O Codex instalado como executável, que é chamado direto. */
  const withCodex: ProviderRegistry = {
    ...providers,
    resolve: (id) =>
      id === 'codex'
        ? { ok: true, launch: { command: 'C:/bin/codex.exe', args: [] } }
        : providers.resolve(id),
  };
  const codexSession: TerminalSessionRecord = {
    id: 'codex-antigo',
    projectId: 'p1',
    provider: 'codex',
    title: 'Codex · app',
    createdAt: '2026-10-21T09:00:00.000Z',
  };

  /** Grava o total acumulado no rollout da sessão e devolve o caminho dele. */
  function writeTotal(output: number, session = CODEX_SESSION): string {
    const folder = join(codexDir, 'sessions', '2026', '11', '15');
    mkdirSync(folder, { recursive: true });
    const file = join(folder, `rollout-2026-11-15T23-03-57-${session}.jsonl`);
    appendFileSync(
      file,
      `${JSON.stringify({
        type: 'event_msg',
        payload: {
          type: 'token_count',
          info: {
            total_token_usage: {
              input_tokens: 500,
              cached_input_tokens: 300,
              output_tokens: output,
            },
          },
        },
      })}\n`,
    );
    return file;
  }

  it('abre o Codex com os dois hooks por -c, e o endereço e o token do receptor só no ambiente', async () => {
    const h = setup({ providers: withCodex });

    await h.service.openSession('p1', 'codex', { args: ['resume', 'abc'] });

    const hookArgs = codexHookArgs(join(settingsDir(), 'project-hub-hook.cjs'), 'win32');
    expect(h.hooks.registered).toEqual(['shell-1']);
    // As opções vêm antes do subcomando da retomada.
    expect(h.opened[0]).toMatchObject({
      command: 'C:/bin/codex.exe',
      args: [...hookArgs, 'resume', 'abc'],
    });
    expect(
      hookArgs.filter((arg) => arg.startsWith('hooks.')).map((arg) => arg.split('=')[0]),
    ).toEqual(['hooks.SessionStart', 'hooks.SessionEnd', 'hooks.state']);
    expect(h.opened[0]?.env).toMatchObject({
      PROJECT_HUB_HOOK_URL: 'http://127.0.0.1:4000/hooks/shell-1',
      PROJECT_HUB_HOOK_TOKEN: HOOK_TOKEN,
      PROJECT_HUB_HOOK_SLIM: '1',
    });
    const line = JSON.stringify(h.opened[0]?.args);
    expect(line).not.toContain(HOOK_TOKEN);
    expect(line).not.toContain('127.0.0.1:4000');
  });

  it('Codex instalado como .cmd abre sem os hooks e sem número', async () => {
    const h = setup({
      providers: {
        ...providers,
        resolve: () => ({
          ok: true,
          launch: { command: 'cmd.exe', args: ['/d', '/c', 'C:/npm/codex.cmd'] },
        }),
      },
    });

    await h.service.openSession('p1', 'codex');

    expect(h.opened[0]?.args).toEqual(['/d', '/c', 'C:/npm/codex.cmd']);
    expect(h.opened[0]?.env).not.toHaveProperty('PROJECT_HUB_HOOK_TOKEN');
    expect(h.hooks.registered).toEqual([]);
    const result = await h.service.list();
    if (!result.ok) throw new Error('esperava sucesso');
    expect(result.data[0]).not.toHaveProperty('usage');
    expect(h.hooks.reads).toEqual([]);
  });

  it('falha ao registrar o hook não impede de abrir: o Codex abre puro e sem número', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    try {
      const h = setup({ providers: withCodex, hooks: fakeHooks({ failRegister: true }) });

      expect((await h.service.openSession('p1', 'codex')).ok).toBe(true);

      expect(h.opened[0]).toMatchObject({ command: 'C:/bin/codex.exe', args: [] });
      expect(h.opened[0]?.env).not.toHaveProperty('PROJECT_HUB_HOOK_TOKEN');
      const result = await h.service.list();
      if (!result.ok) throw new Error('esperava sucesso');
      expect(result.data[0]).not.toHaveProperty('usage');
    } finally {
      warn.mockRestore();
    }
  });

  it('falha ao montar os hooks abre o Codex puro e solta o registro', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    try {
      const blocked = join(dataDir, 'arquivo');
      writeFileSync(blocked, '');
      const h = setup({ providers: withCodex, settingsDir: join(blocked, 'settings') });

      expect((await h.service.openSession('p1', 'codex')).ok).toBe(true);

      expect(h.opened[0]?.args).toEqual([]);
      expect(h.hooks.unregistered).toEqual(['shell-1']);
    } finally {
      warn.mockRestore();
    }
  });

  it('a lista traz o gasto do painel do Codex depois do SessionStart, sem custo e sem contexto', async () => {
    const h = setup({ providers: withCodex });
    await h.service.openSession('p1', 'codex');
    expect((await h.service.list()).ok).toBe(true);

    h.hooks.sessionStart('shell-1', writeTotal(42), CODEX_SESSION);
    h.advance(1500);
    const result = await h.service.list();

    if (!result.ok) throw new Error('esperava sucesso');
    expect(result.data[0]).toMatchObject({
      provider: 'codex',
      usage: { inputTokens: 200, outputTokens: 42, cacheReadInputTokens: 300 },
    });
    expect(result.data[0]?.usage).not.toHaveProperty('estimatedCostUsd');
    expect(result.data[0]).not.toHaveProperty('context');
  });

  it('rollout que o hook aponta fora da pasta do Codex é ignorado', async () => {
    const h = setup({ providers: withCodex });
    await h.service.openSession('p1', 'codex');
    const real = writeTotal(42);
    const outside = join(dataDir, 'sessions', '2026', '11', '15');
    mkdirSync(outside, { recursive: true });
    const forged = join(outside, `rollout-2026-11-15T23-03-57-${CODEX_SESSION}.jsonl`);
    writeFileSync(forged, readFileSync(real));

    h.hooks.sessionStart('shell-1', forged, CODEX_SESSION);
    const result = await h.service.list();

    if (!result.ok) throw new Error('esperava sucesso');
    expect(result.data[0]).not.toHaveProperty('usage');
  });

  it('painel do Codex recuperado depois de reiniciar o app refaz o total pelo log de hooks', async () => {
    const hooks = fakeHooks();
    hooks.sessionStart('codex-antigo', writeTotal(77), CODEX_SESSION);
    const h = setup({ sessions: [codexSession], hooks, providers: withCodex });

    expect(await h.service.list()).toMatchObject({
      ok: true,
      data: [{ id: 'codex-antigo', origin: 'recovered', usage: { outputTokens: 77 } }],
    });
    expect(hooks.reads[0]).toEqual({ id: 'codex-antigo', afterSeq: 0 });
  });

  it('fechar o painel do Codex solta o registro e o leitor', async () => {
    const h = setup({ providers: withCodex });
    await h.service.openSession('p1', 'codex');
    h.hooks.sessionStart('shell-1', writeTotal(10), CODEX_SESSION);
    await h.service.list();

    expect((await h.service.closeSession('shell-1')).ok).toBe(true);
    h.hooks.reads.length = 0;
    h.advance(1500);
    await h.service.list();

    expect(h.hooks.unregistered).toEqual(['shell-1']);
    expect(h.hooks.reads).toEqual([]);
  });

  it('Antigravity e shell continuam sem número', async () => {
    const h = setup({ providers: withCodex });
    await h.service.openSession('p1', 'antigravity');
    await h.service.openSession('p1', 'shell');

    const result = await h.service.list();

    if (!result.ok) throw new Error('esperava sucesso');
    expect(result.data).toHaveLength(2);
    for (const terminal of result.data) expect(terminal).not.toHaveProperty('usage');
    expect(h.hooks.registered).toEqual([]);
  });
});

describe('sessão shell com comando de partida (o painel do preview)', () => {
  it('abre o shell com o comando depois dos argumentos do programa e grava o título dado', async () => {
    const h = setup();

    const result = await h.service.openSession('p1', 'shell', {
      startCommand: 'pnpm run dev',
      title: 'Preview · app',
    });

    expect(result).toEqual({ ok: true, data: { terminalId: 'shell-1' } });
    expect(h.opened[0]).toMatchObject({
      cwd: 'C:/dev/app',
      command: 'shell.exe',
      args: ['-NoLogo', '-NoExit', '-Command', 'pnpm run dev'],
    });
    expect(h.sessions.rows.get('shell-1')).toMatchObject({
      provider: 'shell',
      title: 'Preview · app',
    });
    // O app não digita nada no terminal: o comando vai só na partida.
    expect(h.written).toEqual([]);
  });

  it('sem título, a sessão com comando de partida fica com o título de sempre', async () => {
    const h = setup();
    await h.service.openSession('p1', 'shell', { startCommand: 'npm run dev' });
    expect(h.sessions.rows.get('shell-1')?.title).toBe('PowerShell · app');
  });

  it.each(['claude', 'codex'] as const)(
    'recusa comando de partida no provedor %s, sem abrir nem gravar',
    async (provider) => {
      const h = setup();

      const result = await h.service.openSession('p1', provider, { startCommand: 'pnpm run dev' });

      expect(result).toMatchObject({ ok: false, error: { code: 'VALIDATION_FAILED' } });
      expect(h.opened).toEqual([]);
      expect(h.sessions.rows.size).toBe(0);
    },
  );

  it.each(['', '   ', 'pnpm run dev\ncalc', 'pnpm run dev\r', 'a\x00b', 'x'.repeat(501)])(
    'recusa o comando de partida %j',
    async (startCommand) => {
      const h = setup();

      const result = await h.service.openSession('p1', 'shell', { startCommand });

      expect(result).toMatchObject({ ok: false, error: { code: 'VALIDATION_FAILED' } });
      expect(h.opened).toEqual([]);
    },
  );
});

describe('navegador ao alcance do agente do terminal', () => {
  const BROWSER_TOKEN = 'token-do-navegador';
  const old = (id: string, provider: string): TerminalSessionRecord => ({
    id,
    projectId: 'p1',
    provider,
    title: id,
    createdAt: '2026-10-21T09:00:00.000Z',
  });

  function fakeAccess(options: { fail?: boolean } = {}) {
    const calls: string[] = [];
    const active = new Set<string>();
    const access: AgentBrowserAccess = {
      prepare(terminalId, projectId, provider) {
        calls.push(`prepare:${terminalId}:${projectId}:${provider}`);
        if (options.fail === true) throw new Error('servidor fora do ar');
        if (provider !== 'claude' && provider !== 'codex') return undefined;
        active.add(terminalId);
        return {
          args: ['--mcp-config', 'C:/dados/x.mcp.json'],
          env: {
            PROJECT_HUB_BROWSER_URL: 'http://127.0.0.1:5/mcp',
            PROJECT_HUB_BROWSER_TOKEN: BROWSER_TOKEN,
          },
          files: [],
        };
      },
      opened: (terminalId) => void calls.push(`opened:${terminalId}`),
      release(terminalId) {
        calls.push(`release:${terminalId}`);
        active.delete(terminalId);
      },
      isActive: (terminalId) => active.has(terminalId),
      supports: (provider) => provider === 'claude' || provider === 'codex',
    };
    return { access, calls };
  }

  it('abre o Claude com o servidor do navegador, o token só no ambiente e a permissão no arquivo de settings', async () => {
    const browser = fakeAccess();
    const h = setup({ browserAccess: browser.access });

    await h.service.openSession('p1', 'claude');

    const settingsFile = join(settingsDir(), 'shell-1.settings.json');
    expect(h.opened[0]?.args).toEqual([
      '--settings',
      settingsFile,
      '--mcp-config',
      'C:/dados/x.mcp.json',
    ]);
    expect(h.opened[0]?.env).toMatchObject({
      PROJECT_HUB_BROWSER_URL: 'http://127.0.0.1:5/mcp',
      PROJECT_HUB_BROWSER_TOKEN: BROWSER_TOKEN,
      PROJECT_HUB_HOOK_TOKEN: HOOK_TOKEN,
    });
    expect(JSON.stringify(h.opened[0]?.args)).not.toContain(BROWSER_TOKEN);
    expect(JSON.parse(readFileSync(settingsFile, 'utf8'))).toMatchObject({
      permissions: { allow: ['mcp__navegador'] },
    });
    expect(browser.calls).toEqual(['prepare:shell-1:p1:claude', 'opened:shell-1']);
  });

  it('os argumentos do navegador vêm antes dos do programa (a retomada do Codex)', async () => {
    const browser = fakeAccess();
    const h = setup({
      browserAccess: browser.access,
      providers: {
        list: providers.list,
        resolve: (id) => ({ ok: true, launch: { command: `${id}.exe`, args: [] } }),
      },
    });

    await h.service.openSession('p1', 'codex', { args: ['resume', 'abc'] });

    // Os hooks do gasto de tokens vêm na frente, como o `--settings` do Claude.
    expect(h.opened[0]?.args).toEqual([
      ...codexHookArgs(join(settingsDir(), 'project-hub-hook.cjs'), 'win32'),
      '--mcp-config',
      'C:/dados/x.mcp.json',
      'resume',
      'abc',
    ]);
    expect(h.opened[0]?.env).toHaveProperty('PROJECT_HUB_BROWSER_TOKEN', BROWSER_TOKEN);
  });

  it('falha ao registrar o hook não tira o navegador: o Claude abre com o servidor e o token vivo', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    try {
      const browser = fakeAccess();
      const h = setup({ browserAccess: browser.access, hooks: fakeHooks({ failRegister: true }) });

      expect((await h.service.openSession('p1', 'claude')).ok).toBe(true);

      // Sem o arquivo de settings, mas com o navegador inteiro: o arquivo e o token que os argumentos citam seguem valendo.
      expect(h.opened[0]?.args).toEqual(['--mcp-config', 'C:/dados/x.mcp.json']);
      expect(h.opened[0]?.env).toHaveProperty('PROJECT_HUB_BROWSER_TOKEN', BROWSER_TOKEN);
      expect(browser.calls).toEqual(['prepare:shell-1:p1:claude', 'opened:shell-1']);
      const result = await h.service.list();
      if (!result.ok) throw new Error('esperava sucesso');
      expect(result.data[0]).toHaveProperty('browserAccess', 'active');
    } finally {
      warn.mockRestore();
    }
  });

  it('programa instalado como .cmd recebe as opções depois do caminho dele, e não o cmd.exe', async () => {
    const browser = fakeAccess();
    const h = setup({
      browserAccess: browser.access,
      providers: {
        list: providers.list,
        resolve: (id) => ({
          ok: true,
          launch: { command: 'cmd.exe', args: ['/d', '/c', `C:/npm/${id}.cmd`] },
        }),
      },
    });

    await h.service.openSession('p1', 'claude', { args: ['--resume', 'abc'] });
    await h.service.openSession('p1', 'codex', { args: ['resume', 'abc'] });

    expect(h.opened[0]).toMatchObject({
      command: 'cmd.exe',
      args: [
        '/d',
        '/c',
        'C:/npm/claude.cmd',
        '--settings',
        join(settingsDir(), 'shell-1.settings.json'),
        '--mcp-config',
        'C:/dados/x.mcp.json',
        '--resume',
        'abc',
      ],
    });
    expect(h.opened[1]?.args).toEqual([
      '/d',
      '/c',
      'C:/npm/codex.cmd',
      '--mcp-config',
      'C:/dados/x.mcp.json',
      'resume',
      'abc',
    ]);
  });

  it('o shell nunca pede o navegador, e programa sem o recurso abre como antes', async () => {
    const browser = fakeAccess();
    const h = setup({ browserAccess: browser.access });

    await h.service.openSession('p1', 'shell');
    await h.service.openSession('p1', 'antigravity');

    expect(browser.calls).toEqual(['prepare:shell-2:p1:antigravity']);
    for (const opened of h.opened) {
      expect(opened.env).not.toHaveProperty('PROJECT_HUB_BROWSER_TOKEN');
      expect(opened.args).not.toContain('--mcp-config');
    }
  });

  it('falha ao preparar o navegador não impede de abrir: o terminal abre sem o recurso', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    try {
      const browser = fakeAccess({ fail: true });
      const h = setup({ browserAccess: browser.access });

      const result = await h.service.openSession('p1', 'claude');

      const settingsFile = join(settingsDir(), 'shell-1.settings.json');
      expect(result.ok).toBe(true);
      expect(h.opened[0]?.args).toEqual(['--settings', settingsFile]);
      expect(h.opened[0]?.env).not.toHaveProperty('PROJECT_HUB_BROWSER_TOKEN');
      expect(JSON.parse(readFileSync(settingsFile, 'utf8'))).not.toHaveProperty('permissions');
      expect(browser.calls).toEqual(['prepare:shell-1:p1:claude', 'release:shell-1']);
    } finally {
      warn.mockRestore();
    }
  });

  it('falha ao abrir o terminal e fechar a sessão soltam o navegador', async () => {
    const failing = fakeAccess();
    const broken = setup({ browserAccess: failing.access, failOpen: true });
    await broken.service.openSession('p1', 'claude').catch(() => undefined);
    expect(failing.calls).toEqual(['prepare:shell-1:p1:claude', 'release:shell-1']);

    const browser = fakeAccess();
    const h = setup({ browserAccess: browser.access });
    await h.service.openSession('p1', 'claude');
    await h.service.closeSession('shell-1');
    expect(browser.calls.at(-1)).toBe('release:shell-1');
  });

  it('a lista diz quem alcança o navegador, quem perdeu no reinício e quem nunca teve', async () => {
    const browser = fakeAccess();
    const h = setup({
      browserAccess: browser.access,
      sessions: [old('claude-antigo', 'claude'), old('agy-antigo', 'antigravity')],
    });
    await h.service.openSession('p1', 'claude');
    await h.service.openSession('p1', 'shell');

    const list = await h.service.list();
    if (!list.ok) throw new Error('lista falhou');
    const access = Object.fromEntries(list.data.map((item) => [item.id, item.browserAccess]));
    expect(access).toEqual({
      'claude-antigo': 'lost',
      'agy-antigo': undefined,
      'shell-1': 'active',
      'shell-2': undefined,
    });
  });

  it('sem o serviço do navegador (outro sistema), ninguém tem o campo', async () => {
    const h = setup({ sessions: [old('claude-antigo', 'claude')] });
    const list = await h.service.list();
    if (!list.ok) throw new Error('lista falhou');
    expect(list.data[0]).not.toHaveProperty('browserAccess');
  });
});

describe('painel aberto numa conta do programa', () => {
  const WORK = '11111111-1111-4111-8111-111111111111';
  const GONE = '22222222-2222-4222-8222-222222222222';
  const KEYED = '33333333-3333-4333-8333-333333333333';
  const FAKE_KEY = 'sk-ant-api03-chave-falsa-0123456789-abcdefghijKLMNOPWXYZ';
  const FAKE_OPENAI_KEY = 'sk-proj-chave-falsa-0123456789-abcdefghijKLMNOPCDEX';
  const LOCKED_TEXT = 'Destranque o cofre para continuar.';
  const MISSING_TEXT = 'A conta não tem uma chave de API guardada.';
  let workDir = '';
  beforeEach(() => {
    workDir = mkdtempSync(join(tmpdir(), 'ph-terminals-conta-'));
  });
  afterEach(() => {
    rmSync(workDir, { recursive: true, force: true });
  });

  /**
   * Uma conta extra do Claude ("Trabalho"), uma removida ("Antiga") e uma por chave de API ("Chave"). `vault.locked`
   * tranca o cofre; `keyMissing` tira a chave da conta API.
   */
  function accounts(
    vault: { locked: boolean; keyMissing?: boolean } = { locked: false },
  ): NonNullable<TerminalServiceDeps['accounts']> {
    return {
      isAccountProvider: (provider): provider is 'claude' | 'codex' =>
        provider === 'claude' || provider === 'codex',
      hasExtras: (provider) => provider === 'claude',
      launchEnv: async (
        provider,
        accountId,
      ): ReturnType<NonNullable<TerminalServiceDeps['accounts']>['launchEnv']> => {
        await Promise.resolve();
        if (accountId === null) return { ok: true, data: {} };
        if (provider === 'claude' && accountId === WORK) {
          return { ok: true, data: { CLAUDE_CONFIG_DIR: workDir } };
        }
        if (provider === 'codex' && accountId === WORK) {
          return { ok: true, data: { CODEX_HOME: workDir } };
        }
        if (provider === 'claude' && accountId === KEYED) {
          if (vault.locked) {
            return {
              ok: false,
              error: { code: 'VAULT_LOCKED', message: LOCKED_TEXT, retryable: false },
            };
          }
          if (vault.keyMissing === true) {
            return {
              ok: false,
              error: { code: 'VALIDATION_FAILED', message: MISSING_TEXT, retryable: false },
            };
          }
          return { ok: true, data: { CLAUDE_CONFIG_DIR: workDir, ANTHROPIC_API_KEY: FAKE_KEY } };
        }
        if (provider === 'codex' && accountId === KEYED) {
          return { ok: true, data: { CODEX_HOME: workDir, OPENAI_API_KEY: FAKE_OPENAI_KEY } };
        }
        return {
          ok: false,
          error: { code: 'VALIDATION_FAILED', message: 'A conta foi removida.', retryable: false },
        };
      },
      dataRootOf: (provider, accountId) =>
        provider === 'claude' && accountId === WORK ? workDir : undefined,
      labelOf: (_provider, accountId) => {
        if (accountId === null) return { name: 'Principal', removed: false };
        if (accountId === WORK) return { name: 'Trabalho', removed: false };
        if (accountId === KEYED) return { name: 'Chave', removed: false };
        return { name: 'Antiga', removed: true };
      },
      kindOf: (_provider, accountId) => (accountId === KEYED ? 'api' : 'subscription'),
    };
  }

  it('a conta por chave de API vem marcada na lista; a de assinatura, não', async () => {
    const h = setup({ accounts: accounts() });
    await h.service.openSession('p1', 'claude', { accountId: KEYED });
    await h.service.openSession('p1', 'claude', { accountId: WORK });

    const listed = await h.service.list();
    const byAccount = new Map((listed.ok ? listed.data : []).map((item) => [item.accountId, item]));
    expect(byAccount.get(KEYED)).toMatchObject({ accountName: 'Chave', accountKind: 'api' });
    expect(byAccount.get(WORK)).not.toHaveProperty('accountKind');
  });

  it('abre o Claude com a pasta da conta, grava a conta na sessão e a mostra na lista', async () => {
    const h = setup({ accounts: accounts() });

    const opened = await h.service.openSession('p1', 'claude', { accountId: WORK });

    expect(opened.ok).toBe(true);
    // A variável da conta vence a que o app herdou do ambiente.
    expect(h.opened[0]?.env['CLAUDE_CONFIG_DIR']).toBe(workDir);
    expect(h.sessions.repo.get('shell-1')?.accountId).toBe(WORK);
    const listed = await h.service.list();
    expect(listed.ok && listed.data[0]).toMatchObject({ accountId: WORK, accountName: 'Trabalho' });
    expect(listed.ok && listed.data[0]).not.toHaveProperty('accountRemoved');
  });

  it('accountOfSession diz a conta gravada na sessão: a extra, a Principal, ou nada se não conhece', async () => {
    const h = setup({ accounts: accounts() });
    await h.service.openSession('p1', 'claude', { accountId: WORK });
    await h.service.openSession('p1', 'claude');

    expect(h.service.accountOfSession('shell-1')).toBe(WORK);
    expect(h.service.accountOfSession('shell-2')).toBeNull();
    expect(h.service.accountOfSession('nao-existe')).toBeUndefined();
  });

  it('sem conta, abre na Principal com o ambiente de sempre e sem gravar conta', async () => {
    const plain = setup();
    await plain.service.openSession('p1', 'claude');
    const h = setup({ accounts: accounts() });

    await h.service.openSession('p1', 'claude');
    await h.service.openSession('p1', 'claude', { accountId: null });

    expect(h.opened[0]?.env).toEqual(plain.opened[0]?.env);
    expect(h.opened[1]?.env['CLAUDE_CONFIG_DIR']).toBe(claudeDir);
    expect(h.sessions.repo.get('shell-1')).not.toHaveProperty('accountId');
    const listed = await h.service.list();
    expect(listed.ok && listed.data[0]).toMatchObject({
      accountId: null,
      accountName: 'Principal',
    });
  });

  it('conta removida não abre nada: sem processo, sem linha e sem registro de hooks', async () => {
    const h = setup({ accounts: accounts() });

    const opened = await h.service.openSession('p1', 'claude', { accountId: GONE });

    expect(opened).toEqual({
      ok: false,
      error: { code: 'VALIDATION_FAILED', message: 'A conta foi removida.', retryable: false },
    });
    expect(h.opened).toEqual([]);
    expect(h.sessions.repo.listOpen()).toEqual([]);
    expect(h.hooks.registered).toEqual([]);
  });

  it('o Codex de uma conta extra abre sem o servidor de fundo, antes da retomada; a Principal e o Claude, como sempre', async () => {
    // O Codex abre um socket dentro da pasta da conta, e o caminho do socket tem limite (108 caracteres no
    // Windows). A pasta de uma conta extra, dentro da pasta de dados do app, passa dele.
    const codexInstalled: ProviderRegistry = {
      ...providers,
      resolve: (id) =>
        id === 'codex'
          ? { ok: true, launch: { command: 'C:/bin/codex.exe', args: [] } }
          : providers.resolve(id),
    };
    const h = setup({ accounts: accounts(), providers: codexInstalled });

    await h.service.openSession('p1', 'codex', { accountId: WORK, args: ['resume', 'abc'] });
    await h.service.openSession('p1', 'codex', { args: ['resume', 'abc'] });
    await h.service.openSession('p1', 'claude', { accountId: WORK });

    const [extra, principal, claude] = h.opened;
    expect(extra?.env['CODEX_HOME']).toBe(workDir);
    expect(extra?.args.slice(-3)).toEqual(['--no-daemon', 'resume', 'abc']);
    expect(principal?.args).not.toContain('--no-daemon');
    expect(principal?.args.slice(-2)).toEqual(['resume', 'abc']);
    expect(claude?.args).not.toContain('--no-daemon');
  });

  it('o Codex de uma conta API abre com o provedor da chave antes da retomada; a de assinatura e a Principal, sem ele', async () => {
    const codexInstalled: ProviderRegistry = {
      ...providers,
      resolve: (id) =>
        id === 'codex'
          ? { ok: true, launch: { command: 'C:/bin/codex.exe', args: [] } }
          : providers.resolve(id),
    };
    const h = setup({ accounts: accounts(), providers: codexInstalled });

    await h.service.openSession('p1', 'codex', { accountId: KEYED, args: ['resume', 'abc'] });
    await h.service.openSession('p1', 'codex', { accountId: WORK });
    await h.service.openSession('p1', 'codex');

    const [keyed, subscription, principal] = h.opened;
    const tail = ['--no-daemon', ...CODEX_API_PROVIDER_ARGS, 'resume', 'abc'];
    expect(keyed?.args.slice(-tail.length)).toEqual(tail);
    expect(keyed?.env['OPENAI_API_KEY']).toBe(FAKE_OPENAI_KEY);
    expect(keyed?.env['CODEX_HOME']).toBe(workDir);
    expect(keyed?.args.join(' ')).not.toContain(FAKE_OPENAI_KEY.slice(-20));
    for (const other of [subscription, principal]) {
      expect(other?.args).not.toContain('model_provider=openai-chave-api');
      expect(other?.env).not.toHaveProperty('OPENAI_API_KEY');
    }
  });

  it('programa sem contas não aceita conta', async () => {
    const h = setup({ accounts: accounts() });

    const shell = await h.service.openSession('p1', 'shell', { accountId: WORK });
    const other = await h.service.openSession('p1', 'antigravity', { accountId: WORK });

    expect(shell.ok).toBe(false);
    expect(other.ok).toBe(false);
    expect(h.opened).toEqual([]);
  });

  it('sem o serviço de contas ligado, pedir uma conta extra falha em vez de abrir na Principal', async () => {
    const h = setup();

    const opened = await h.service.openSession('p1', 'claude', { accountId: WORK });

    expect(opened.ok).toBe(false);
    expect(h.opened).toEqual([]);
  });

  it('painel de conta que foi removida aparece marcado', async () => {
    const h = setup({
      accounts: accounts(),
      sessions: [
        {
          id: 'orfa',
          projectId: 'p1',
          provider: 'claude',
          title: 'Claude Code · app',
          createdAt: '2026-10-21T09:00:00.000Z',
          accountId: GONE,
        },
      ],
    });

    const listed = await h.service.list();

    expect(listed.ok && listed.data[0]).toMatchObject({
      accountId: GONE,
      accountName: 'Antiga',
      accountRemoved: true,
    });
  });

  it('o agente de uma missão mostra a conta da missão', async () => {
    const h = setup({
      accounts: accounts(),
      executions: [agentExecution],
      missions: [{ ...mission, accountId: WORK } as Mission],
    });

    const listed = await h.service.list();

    expect(listed.ok && listed.data[0]).toMatchObject({
      kind: 'agent',
      accountId: WORK,
      accountName: 'Trabalho',
    });
  });

  it('painel em conta API: o programa recebe a variável da chave, e a chave da máquina não é herdada', async () => {
    const h = setup({ accounts: accounts() });
    const principal = setup({ accounts: accounts() });

    expect((await h.service.openSession('p1', 'claude', { accountId: KEYED })).ok).toBe(true);
    await principal.service.openSession('p1', 'claude');

    expect(h.opened[0]?.env['ANTHROPIC_API_KEY']).toBe(FAKE_KEY);
    expect(h.opened[0]?.env['CLAUDE_CONFIG_DIR']).toBe(workDir);
    // O ambiente do app tem ANTHROPIC_API_KEY=segredo: nenhum painel o herda.
    expect(principal.opened[0]?.env).not.toHaveProperty('ANTHROPIC_API_KEY');
    expect(JSON.stringify(h.opened)).not.toContain('segredo');
  });

  it('cofre trancado: pede a senha uma vez e abre depois de destrancar', async () => {
    const vault = { locked: true };
    const unlockVault = vi.fn(() => {
      vault.locked = false;
      return Promise.resolve('unlocked' as const);
    });
    const h = setup({ accounts: accounts(vault), unlockVault });

    const opened = await h.service.openSession('p1', 'claude', { accountId: KEYED });

    expect(opened.ok).toBe(true);
    expect(unlockVault).toHaveBeenCalledTimes(1);
    expect(h.opened[0]?.env['ANTHROPIC_API_KEY']).toBe(FAKE_KEY);
  });

  it('senha cancelada: nenhum processo, nenhuma linha de sessão, e a frase do cofre', async () => {
    const unlockVault = vi.fn(() => Promise.resolve('cancelled' as const));
    const h = setup({ accounts: accounts({ locked: true }), unlockVault });

    const opened = await h.service.openSession('p1', 'claude', { accountId: KEYED });

    expect(opened).toEqual({
      ok: false,
      error: { code: 'VAULT_LOCKED', message: LOCKED_TEXT, retryable: false },
    });
    expect(unlockVault).toHaveBeenCalledTimes(1);
    expect(h.opened).toEqual([]);
    expect(h.sessions.repo.listOpen()).toEqual([]);
    expect(h.hooks.registered).toEqual([]);
  });

  it('cofre trancado sem a janela da senha ligada: nada abre, com a frase do cofre', async () => {
    const h = setup({ accounts: accounts({ locked: true }) });

    const opened = await h.service.openSession('p1', 'claude', { accountId: KEYED });

    expect(opened.ok).toBe(false);
    if (!opened.ok) expect(opened.error.message).toBe(LOCKED_TEXT);
    expect(h.opened).toEqual([]);
  });

  it('conta API sem chave: nada abre, com KEY_MISSING', async () => {
    const unlockVault = vi.fn(() => Promise.resolve('unlocked' as const));
    const h = setup({ accounts: accounts({ locked: false, keyMissing: true }), unlockVault });

    const opened = await h.service.openSession('p1', 'claude', { accountId: KEYED });

    expect(opened.ok).toBe(false);
    if (!opened.ok) expect(opened.error.message).toBe(MISSING_TEXT);
    expect(unlockVault).not.toHaveBeenCalled();
    expect(h.opened).toEqual([]);
    expect(h.sessions.repo.listOpen()).toEqual([]);
  });

  it('a chave não aparece no resumo do terminal nem na lista', async () => {
    const h = setup({ accounts: accounts() });

    const opened = await h.service.openSession('p1', 'claude', { accountId: KEYED });
    const listed = await h.service.list();

    expect(JSON.stringify(opened)).not.toContain(FAKE_KEY);
    expect(JSON.stringify(listed)).not.toContain(FAKE_KEY);
    expect(JSON.stringify(h.sessions.repo.listOpen())).not.toContain(FAKE_KEY);
    expect(JSON.stringify(h.events)).not.toContain(FAKE_KEY);
  });

  it('shell não tem conta na lista', async () => {
    const h = setup({ accounts: accounts() });
    await h.service.openSession('p1', 'shell');

    const listed = await h.service.list();

    expect(listed.ok && listed.data[0]).not.toHaveProperty('accountId');
    expect(listed.ok && listed.data[0]).not.toHaveProperty('accountName');
  });
});
