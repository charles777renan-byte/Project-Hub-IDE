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
import type { HookRecord } from '@project-hub/agent-adapters';
import type { TerminalEvent } from '@project-hub/contracts';
import type { TerminalSessionRecord, TerminalSessionRepository } from '@project-hub/database';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
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
let dataDir = '';
beforeEach(() => {
  claudeDir = mkdtempSync(join(tmpdir(), 'ph-terminals-claude-'));
  dataDir = mkdtempSync(join(tmpdir(), 'ph-terminals-data-'));
});
afterEach(() => {
  rmSync(claudeDir, { recursive: true, force: true });
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
    countChanges: options.countChanges ?? (() => Promise.resolve(undefined)),
    env: { PATH: 'C:/Windows', ANTHROPIC_API_KEY: 'segredo', CLAUDE_CONFIG_DIR: claudeDir },
    newId: () => ids.shift() ?? 'shell-x',
    now: () => new Date(clock).toISOString(),
    hooks: hooks.hooks,
    settingsDir: options.settingsDir ?? settingsDir(),
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
    // Só o início e o fim da sessão: os outros hooks encheriam o log a cada ferramenta.
    const written = JSON.parse(readFileSync(settingsFile, 'utf8')) as {
      hooks: Record<string, unknown>;
    };
    expect(Object.keys(written.hooks).sort()).toEqual(['SessionEnd', 'SessionStart']);
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

  it('painel do Claude sem resposta ainda não tem o campo (não é zero)', async () => {
    const h = setup();
    await h.service.openSession('p1', 'claude');

    const result = await h.service.list();

    if (!result.ok) throw new Error('esperava sucesso');
    expect(result.data[0]).not.toHaveProperty('usage');
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

  it('terminal de outro provedor nunca é lido, mesmo recuperado', async () => {
    const h = setup({ sessions: [storedSession] });

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

  it('fechar um painel recuperado do Claude também solta o registro; o de outro provedor, não', async () => {
    const h = setup({ sessions: [claudeSession, storedSession] });

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
