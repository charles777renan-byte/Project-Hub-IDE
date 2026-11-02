import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { zstdCompressSync } from 'node:zlib';
import { claudeConfigDirOf } from '@project-hub/agent-adapters';
import type { AgentActivityAgent } from '@project-hub/contracts';
import type { AppTerminal, SessionForLink } from '@project-hub/domain';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  agentActivityAgents,
  createAgentActivityService,
  createSessionReader,
  sessionSourcesOf,
  type AgentActivityDeps,
} from '../src/main/agent-activity';

const AGENTS: AgentActivityAgent[] = [
  { id: 'claude', label: 'Claude Code', messagesAvailable: true, tokensAvailable: true },
  { id: 'codex', label: 'Codex', messagesAvailable: true, tokensAvailable: true },
  { id: 'antigravity', label: 'Antigravity CLI', messagesAvailable: true, tokensAvailable: false },
];

const T0 = '2026-11-01T12:00:00.000Z';

function terminal(overrides: Partial<AppTerminal> = {}): AppTerminal {
  return {
    provider: 'claude',
    folder: 'C:\\dev\\app',
    createdAt: '2026-10-30T10:00:00.000Z',
    ...overrides,
  };
}

function session(overrides: Partial<SessionForLink> = {}): SessionForLink {
  return {
    agent: 'claude',
    cwd: 'C:\\dev\\app',
    startedAt: '2026-10-30T10:05:00.000Z',
    days: [{ date: '2026-10-30', messages: 3, tokens: 1200 }],
    ...overrides,
  };
}

type Clock = { value: number };

function build(
  overrides: Partial<AgentActivityDeps> = {},
  clock: Clock = { value: Date.parse(T0) },
) {
  const readSessions = vi.fn<AgentActivityDeps['readSessions']>(() => Promise.resolve([session()]));
  const deps: AgentActivityDeps = {
    terminals: () => [terminal()],
    missions: () => [],
    readSessions,
    agents: AGENTS,
    now: () => new Date(clock.value).toISOString(),
    caseInsensitive: true,
    ...overrides,
  };
  return { service: createAgentActivityService(deps), readSessions, clock };
}

describe('createAgentActivityService', () => {
  it('monta os agentes, os dias e o dia mais antigo que o app conhece', async () => {
    const { service } = build({
      missions: () => [{ finishedAt: '2026-10-29T08:00:00.000Z', tokens: 500 }],
    });

    const activity = await service.read();

    expect(activity.agents).toEqual(AGENTS);
    expect(activity.days).toEqual([
      { date: '2026-10-29', agent: 'claude', messages: 0, tokens: 500 },
      { date: '2026-10-30', agent: 'claude', messages: 3, tokens: 1200 },
    ]);
    // Execução de missão de 29/10 é mais antiga que o terminal de 30/10.
    expect(activity.since).toBe('2026-10-29');
  });

  it('sem terminal nem missão devolve since nulo e nenhum dia, sem ler arquivo', async () => {
    const { service, readSessions } = build({ terminals: () => [] });

    expect(await service.read()).toEqual({ agents: AGENTS, days: [], since: null });
    expect(readSessions).not.toHaveBeenCalled();
  });

  it('lê cada agente a partir do terminal mais antigo dele, e só quem tem terminal', async () => {
    const readSessions = vi.fn<AgentActivityDeps['readSessions']>(() => Promise.resolve([]));
    const { service } = build({
      terminals: () => [
        terminal({ provider: 'claude', createdAt: '2026-10-28T10:00:00.000Z' }),
        terminal({ provider: 'claude', createdAt: '2026-10-30T10:00:00.000Z' }),
        terminal({ provider: 'codex', createdAt: '2026-10-29T10:00:00.000Z' }),
        terminal({ provider: 'shell', createdAt: '2026-10-20T10:00:00.000Z' }),
      ],
      readSessions,
    });

    const activity = await service.read();

    // O shell não é agente da lista e o Antigravity não tem terminal.
    expect(readSessions.mock.calls).toEqual([
      ['claude', '2026-10-28T10:00:00.000Z'],
      ['codex', '2026-10-29T10:00:00.000Z'],
    ]);
    // O terminal de shell, mais antigo, não puxa o início: o shell não entra no bloco.
    expect(activity.since).toBe('2026-10-28');
  });

  it('só conta a sessão ligada a um terminal do app', async () => {
    const { service } = build({
      readSessions: (agent) =>
        Promise.resolve(
          agent === 'claude'
            ? [
                session(),
                session({
                  cwd: 'C:\\outra',
                  days: [{ date: '2026-10-30', messages: 9, tokens: 9 }],
                }),
              ]
            : [],
        ),
    });

    const { days } = await service.read();

    expect(days).toEqual([{ date: '2026-10-30', agent: 'claude', messages: 3, tokens: 1200 }]);
  });

  it('dentro do prazo do cache devolve o mesmo objeto sem ler de novo', async () => {
    const { service, readSessions, clock } = build({ cacheMs: 60_000 });

    const first = await service.read();
    clock.value += 59_000;
    const second = await service.read();

    expect(second).toBe(first);
    expect(readSessions).toHaveBeenCalledTimes(1);
  });

  it('passado o prazo do cache, lê de novo', async () => {
    const { service, readSessions, clock } = build({ cacheMs: 60_000 });

    await service.read();
    clock.value += 60_000;
    await service.read();

    expect(readSessions).toHaveBeenCalledTimes(2);
  });

  it('o prazo do cache padrão é de 60 s', async () => {
    const { service, readSessions, clock } = build();

    await service.read();
    clock.value += 59_999;
    await service.read();
    expect(readSessions).toHaveBeenCalledTimes(1);

    clock.value += 1;
    await service.read();
    expect(readSessions).toHaveBeenCalledTimes(2);
  });

  it('duas chamadas simultâneas dividem a mesma leitura', async () => {
    let release: (sessions: SessionForLink[]) => void = () => undefined;
    const readSessions = vi.fn(
      () =>
        new Promise<SessionForLink[]>((resolve) => {
          release = resolve;
        }),
    );
    const { service } = build({ readSessions });

    const a = service.read();
    const b = service.read();
    release([session()]);
    const [first, second] = await Promise.all([a, b]);

    expect(readSessions).toHaveBeenCalledTimes(1);
    expect(second).toBe(first);
  });

  it('um agente que lança fica sem dias e os outros seguem', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      const { service } = build({
        terminals: () => [
          terminal({ provider: 'claude' }),
          terminal({ provider: 'codex', folder: 'C:\\dev\\app' }),
        ],
        readSessions: (agent) =>
          agent === 'claude'
            ? Promise.reject(new Error('disco quebrou'))
            : Promise.resolve([
                session({
                  agent: 'codex',
                  days: [{ date: '2026-10-30', messages: 2, tokens: 70 }],
                }),
              ]),
      });

      const { days } = await service.read();

      expect(days).toEqual([{ date: '2026-10-30', agent: 'codex', messages: 2, tokens: 70 }]);
    } finally {
      error.mockRestore();
    }
  });

  it('o Antigravity mantém tokens nulos, nunca zero', async () => {
    const { service } = build({
      terminals: () => [terminal({ provider: 'antigravity' })],
      readSessions: () =>
        Promise.resolve([
          session({
            agent: 'antigravity',
            days: [{ date: '2026-10-30', messages: 4, tokens: null }],
          }),
        ]),
    });

    expect((await service.read()).days).toEqual([
      { date: '2026-10-30', agent: 'antigravity', messages: 4, tokens: null },
    ]);
  });

  it('agente sem leitor (flags falsas) não é lido', async () => {
    const readSessions = vi.fn(() => Promise.resolve([]));
    const { service } = build({
      agents: [{ id: 'novo', label: 'Novo', messagesAvailable: false, tokensAvailable: false }],
      terminals: () => [terminal({ provider: 'novo' })],
      readSessions,
    });

    const activity = await service.read();

    expect(readSessions).not.toHaveBeenCalled();
    expect(activity.days).toEqual([]);
    expect(activity.agents).toHaveLength(1);
  });
});

describe('agentActivityAgents', () => {
  it('tira o shell, liga Claude e Codex por inteiro e deixa o Antigravity sem tokens', () => {
    const agents = agentActivityAgents([
      { id: 'claude', label: 'Claude Code', available: true },
      { id: 'codex', label: 'Codex', available: false, reason: 'não achei' },
      { id: 'antigravity', label: 'Antigravity CLI', available: true },
      { id: 'shell', label: 'PowerShell', available: true },
    ]);

    expect(agents).toEqual([
      { id: 'claude', label: 'Claude Code', messagesAvailable: true, tokensAvailable: true },
      { id: 'codex', label: 'Codex', messagesAvailable: true, tokensAvailable: true },
      {
        id: 'antigravity',
        label: 'Antigravity CLI',
        messagesAvailable: true,
        tokensAvailable: false,
      },
    ]);
  });

  it('agente novo do registro entra com mensagens e tokens indisponíveis', () => {
    const agents = agentActivityAgents([
      { id: 'futuro' as never, label: 'Futuro', available: true },
    ]);

    expect(agents).toEqual([
      { id: 'futuro', label: 'Futuro', messagesAvailable: false, tokensAvailable: false },
    ]);
  });
});

describe('createSessionReader', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'project-hub-agent-activity-'));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  const userLine = (iso: string) =>
    JSON.stringify({ type: 'user', timestamp: iso, message: { content: 'texto' } });

  function codexSession(startedAt: string): string {
    return [
      JSON.stringify({
        type: 'session_meta',
        timestamp: startedAt,
        payload: { cwd: 'C:\\dev\\app', timestamp: startedAt },
      }),
      JSON.stringify({
        type: 'event_msg',
        timestamp: startedAt,
        payload: { type: 'item_completed', item: { type: 'UserMessage' } },
      }),
    ].join('\n');
  }

  function writeCodex(
    codexHome: string,
    year: string,
    month: string,
    day: string,
    name: string,
    content: Buffer | string,
  ) {
    const folder = join(codexHome, 'sessions', year, month, day);
    mkdirSync(folder, { recursive: true });
    writeFileSync(join(folder, name), content);
  }

  describe('Codex', () => {
    it('lê a sessão comprimida em zstd como qualquer outra', async () => {
      const codexHome = join(dir, 'codex');
      const at = new Date(2026, 9, 30, 10, 0).toISOString();
      writeCodex(
        codexHome,
        '2026',
        '10',
        '30',
        'rollout-a.jsonl.zst',
        zstdCompressSync(Buffer.from(codexSession(at))),
      );
      writeCodex(codexHome, '2026', '10', '30', 'rollout-b.jsonl', codexSession(at));
      const read = createSessionReader({
        terminals: () => [terminal({ provider: 'codex', createdAt: at })],
        env: { CODEX_HOME: codexHome },
        antigravityHistory: join(dir, 'nada.jsonl'),
      });

      const sessions = await read('codex', at);

      expect(sessions).toHaveLength(2);
      expect(sessions[0]).toMatchObject({
        agent: 'codex',
        cwd: 'C:\\dev\\app',
        days: [{ date: '2026-10-30', messages: 1, tokens: 0 }],
      });
    });

    it('um .zst corrompido deixa só aquela sessão de fora', async () => {
      const codexHome = join(dir, 'codex');
      const at = new Date(2026, 9, 30, 10, 0).toISOString();
      writeCodex(
        codexHome,
        '2026',
        '10',
        '30',
        'rollout-a.jsonl.zst',
        Buffer.from('isto não é zstd'),
      );
      writeCodex(codexHome, '2026', '10', '30', 'rollout-b.jsonl', codexSession(at));
      const read = createSessionReader({
        terminals: () => [terminal({ provider: 'codex', createdAt: at })],
        env: { CODEX_HOME: codexHome },
        antigravityHistory: join(dir, 'nada.jsonl'),
      });

      const sessions = await read('codex', at);

      expect(sessions).toHaveLength(1);
    });

    it('começa um dia antes do terminal mais antigo, porque a pasta do dia é a do início da sessão', async () => {
      const codexHome = join(dir, 'codex');
      const created = new Date(2026, 10, 1, 0, 5).toISOString();
      const started = new Date(2026, 9, 31, 23, 58).toISOString();
      writeCodex(codexHome, '2026', '10', '31', 'rollout-a.jsonl', codexSession(started));
      writeCodex(codexHome, '2026', '10', '30', 'rollout-velha.jsonl', codexSession(started));
      const read = createSessionReader({
        terminals: () => [terminal({ provider: 'codex', createdAt: created })],
        env: { CODEX_HOME: codexHome },
        antigravityHistory: join(dir, 'nada.jsonl'),
      });

      const sessions = await read('codex', created);

      expect(sessions).toHaveLength(1);
      expect(sessions[0]?.startedAt).toBe(started);
    });

    it('pasta do Codex inexistente devolve lista vazia', async () => {
      const read = createSessionReader({
        terminals: () => [terminal({ provider: 'codex' })],
        env: { CODEX_HOME: join(dir, 'nao-existe') },
        antigravityHistory: join(dir, 'nada.jsonl'),
      });

      expect(await read('codex', '2026-10-30T10:00:00.000Z')).toEqual([]);
    });
  });

  describe('Claude', () => {
    it('lê os transcripts da pasta de cada projeto com terminal Claude', async () => {
      const configDir = join(dir, 'claude');
      const folder = join(dir, 'proj', 'x');
      const encoded = folder.replace(/[^A-Za-z0-9]/g, '-');
      mkdirSync(join(configDir, 'projects', encoded), { recursive: true });
      const at = new Date(2026, 9, 30, 10, 0).toISOString();
      writeFileSync(
        join(configDir, 'projects', encoded, 'a.jsonl'),
        `${userLine(at)}\n${userLine(at)}\n`,
      );
      const read = createSessionReader({
        terminals: () => [
          terminal({
            provider: 'claude',
            folder,
            createdAt: new Date(2026, 9, 30, 9, 0).toISOString(),
          }),
          terminal({
            provider: 'claude',
            folder,
            createdAt: new Date(2026, 9, 30, 9, 30).toISOString(),
          }),
        ],
        env: { CLAUDE_CONFIG_DIR: configDir },
        antigravityHistory: join(dir, 'nada.jsonl'),
      });

      const sessions = await read('claude', new Date(2026, 9, 30, 9, 0).toISOString());

      // Dois terminais na mesma pasta não leem o mesmo arquivo duas vezes.
      expect(sessions).toHaveLength(1);
      expect(sessions[0]).toMatchObject({
        agent: 'claude',
        cwd: folder,
        days: [{ date: '2026-10-30', messages: 2 }],
      });
    });

    it('pula o transcript que ninguém mexe desde antes do terminal mais antigo', async () => {
      const configDir = join(dir, 'claude');
      const folder = join(dir, 'proj', 'y');
      const encoded = folder.replace(/[^A-Za-z0-9]/g, '-');
      mkdirSync(join(configDir, 'projects', encoded), { recursive: true });
      const file = join(configDir, 'projects', encoded, 'velho.jsonl');
      writeFileSync(file, `${userLine(new Date(2026, 0, 5, 10, 0).toISOString())}\n`);
      utimesSync(file, new Date(2026, 0, 5), new Date(2026, 0, 5));
      const read = createSessionReader({
        terminals: () => [terminal({ provider: 'claude', folder })],
        env: { CLAUDE_CONFIG_DIR: configDir },
        antigravityHistory: join(dir, 'nada.jsonl'),
      });

      expect(await read('claude', '2026-10-30T10:00:00.000Z')).toEqual([]);
    });

    it('pasta de transcripts inexistente devolve lista vazia', async () => {
      const read = createSessionReader({
        terminals: () => [terminal({ provider: 'claude', folder: join(dir, 'sem-transcript') })],
        env: { CLAUDE_CONFIG_DIR: join(dir, 'claude') },
        antigravityHistory: join(dir, 'nada.jsonl'),
      });

      expect(await read('claude', '2026-10-30T10:00:00.000Z')).toEqual([]);
    });
  });

  describe('Antigravity', () => {
    it('lê o histórico e deixa os tokens nulos', async () => {
      const history = join(dir, 'history.jsonl');
      writeFileSync(
        history,
        `${JSON.stringify({ conversationId: 'c1', workspace: 'C:\\dev\\app', timestamp: Date.parse('2026-10-30T10:00:00.000Z'), text: 'oi' })}\n`,
      );
      const read = createSessionReader({
        terminals: () => [terminal({ provider: 'antigravity' })],
        env: {},
        antigravityHistory: history,
      });

      const sessions = await read('antigravity', '2026-10-30T10:00:00.000Z');

      expect(sessions).toHaveLength(1);
      expect(sessions[0]?.days.every((day) => day.tokens === null)).toBe(true);
    });

    it('histórico inexistente (CLI nunca usado) devolve lista vazia, sem erro', async () => {
      const read = createSessionReader({
        terminals: () => [terminal({ provider: 'antigravity' })],
        env: {},
        antigravityHistory: join(dir, 'nao-existe.jsonl'),
      });

      expect(await read('antigravity', '2026-10-30T10:00:00.000Z')).toEqual([]);
    });

    it('histórico ilegível por outro motivo lança, para o agente ficar sem dias', async () => {
      // Uma pasta no lugar do arquivo: a leitura falha com EISDIR, não com ENOENT.
      const read = createSessionReader({
        terminals: () => [terminal({ provider: 'antigravity' })],
        env: {},
        antigravityHistory: dir,
      });

      await expect(read('antigravity', '2026-10-30T10:00:00.000Z')).rejects.toThrow();
    });
  });

  it('agente sem leitor devolve lista vazia', async () => {
    const read = createSessionReader({
      terminals: () => [],
      env: {},
      antigravityHistory: join(dir, 'x'),
    });

    expect(await read('futuro', '2026-10-30T10:00:00.000Z')).toEqual([]);
  });
});

describe('sessionSourcesOf', () => {
  const OVERRIDES = {
    PROJECT_HUB_CLAUDE_DIR: 'C:/teste/claude',
    PROJECT_HUB_CODEX_HOME: 'C:/teste/codex',
    PROJECT_HUB_AGY_HISTORY: 'C:/teste/agy/history.jsonl',
  };

  it('com PROJECT_HUB_ENV=test, as três variáveis trocam as pastas dos CLIs', () => {
    const sources = sessionSourcesOf({
      PROJECT_HUB_ENV: 'test',
      CLAUDE_CONFIG_DIR: 'C:/pessoa/claude',
      PATH: 'C:/bin',
      ...OVERRIDES,
    });

    expect(sources.env['CLAUDE_CONFIG_DIR']).toBe('C:/teste/claude');
    expect(sources.env['CODEX_HOME']).toBe('C:/teste/codex');
    expect(sources.antigravityHistory).toBe('C:/teste/agy/history.jsonl');
    // O resto do ambiente do terminal segue como está.
    expect(sources.env['PATH']).toBe('C:/bin');
  });

  it('o nome da variável do Claude é trocado sem diferenciar maiúsculas', () => {
    const sources = sessionSourcesOf({
      PROJECT_HUB_ENV: 'test',
      Claude_Config_Dir: 'C:/pessoa/claude',
      PROJECT_HUB_CLAUDE_DIR: 'C:/teste/claude',
    });

    expect(claudeConfigDirOf(sources.env)).toBe('C:/teste/claude');
  });

  it('fora do teste, as variáveis PROJECT_HUB_* não valem', () => {
    const sources = sessionSourcesOf({
      CLAUDE_CONFIG_DIR: 'C:/pessoa/claude',
      ...OVERRIDES,
    });

    expect(sources.env['CLAUDE_CONFIG_DIR']).toBe('C:/pessoa/claude');
    expect(sources.env['CODEX_HOME']).toBeUndefined();
    expect(sources.antigravityHistory).toBeUndefined();
    // E o ambiente do terminal não leva as variáveis de controle do app.
    expect(Object.keys(sources.env).some((name) => name.startsWith('PROJECT_HUB_'))).toBe(false);
  });

  it('em teste, sem as variáveis, nada muda', () => {
    const sources = sessionSourcesOf({
      PROJECT_HUB_ENV: 'test',
      CLAUDE_CONFIG_DIR: 'C:/pessoa/claude',
    });

    expect(sources.env['CLAUDE_CONFIG_DIR']).toBe('C:/pessoa/claude');
    expect(sources.env['CODEX_HOME']).toBeUndefined();
    expect(sources.antigravityHistory).toBeUndefined();
  });

  it('variável vazia não vale', () => {
    const sources = sessionSourcesOf({
      PROJECT_HUB_ENV: 'test',
      PROJECT_HUB_CODEX_HOME: '',
      PROJECT_HUB_AGY_HISTORY: '',
    });

    expect(sources.env['CODEX_HOME']).toBeUndefined();
    expect(sources.antigravityHistory).toBeUndefined();
  });
});
