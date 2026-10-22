import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createClaudeCodeAdapter } from '@project-hub/agent-adapters';

// Tipos do adaptador, tirados do que ele devolve: o app não depende de @project-hub/agent-sdk.
type AgentSession = Awaited<ReturnType<ReturnType<typeof createClaudeCodeAdapter>['start']>>;
type AgentEvent = AgentSession['events'] extends () => AsyncIterable<infer E> ? E : never;
import { createTerminalHostPort } from '../../src/main/terminal-host-port';
import { connectTerminalHost, type TerminalHostClient } from '../../src/terminal-host/client';
import { buildTerminalEnv } from '../../src/terminal-host/env';
import { startHookReceiver, type HookReceiver } from '../../src/terminal-host/hook-receiver';
import { startTerminalHost, type TerminalHost } from '../../src/terminal-host/host';
import { terminalHostPipePath } from '../../src/terminal-host/protocol';
import { PtyManager } from '../../src/terminal-host/pty-manager';
import { TerminalCommands } from '../../src/terminal-host/terminal-commands';
import { createHostToken } from '../../src/terminal-host/token';

// O adaptador do Claude Code de ponta a ponta: terminal real, pipe, receptor de hooks e a configuração
// `--settings` gerada. Só o CLI é falso (fixtures/fake-claude.mjs), e ele dispara os hooks pelo mesmo
// comando que o Claude Code usaria.
const onWindows = process.platform === 'win32';
const TOKEN = createHostToken();
const FAKE_CLI = resolve(import.meta.dirname, 'fixtures/fake-claude.mjs');

let dir = '';
let recordFile = '';
let manager: PtyManager;
let host: TerminalHost | undefined;
let receiver: HookReceiver | undefined;
let clients: TerminalHostClient[] = [];
let adapter: ReturnType<typeof createClaudeCodeAdapter>;

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), 'ph-claude-'));
  recordFile = join(dir, 'argv.json');
  const pipePath = terminalHostPipePath(`teste-${randomUUID().slice(0, 8)}`, process.platform, tmpdir());
  manager = new PtyManager();
  const commands = new TerminalCommands(manager);
  receiver = await startHookReceiver({ logDir: join(dir, 'hooks') });
  host = await startTerminalHost({
    pipePath,
    token: TOKEN,
    idleTimeoutMs: 60_000,
    getSessionCount: () => manager.aliveCount(),
    handleTerminal: (request, sink) => commands.handle(request, sink),
    onConnectionClosed: (sink) => commands.releaseConnection(sink),
  });
  const port = createTerminalHostPort({
    connect: async () => {
      const client = await connectTerminalHost({ pipePath, token: TOKEN });
      clients.push(client);
      return client;
    },
  });
  adapter = createClaudeCodeAdapter({
    terminal: port,
    hooks: receiver,
    settingsDir: join(dir, 'settings'),
    command: process.execPath,
    commandPrefix: [FAKE_CLI],
    env: { ...buildTerminalEnv(process.env), FAKE_CLAUDE_RECORD: recordFile },
    pollMs: 50,
  });
});

afterEach(async () => {
  for (const client of clients) client.close();
  clients = [];
  await manager.killAll();
  await host?.close();
  await receiver?.close();
  host = undefined;
  receiver = undefined;
  rmSync(dir, { recursive: true, force: true });
});

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitFor(condition: () => boolean, timeoutMs = 20_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!condition()) {
    if (Date.now() > deadline) throw new Error('a condição não aconteceu a tempo');
    await sleep(50);
  }
}

/** Lê os eventos da sessão em segundo plano, para o teste poder esperar um deles. */
function reading(session: AgentSession): { events: AgentEvent[]; done: Promise<void> } {
  const events: AgentEvent[] = [];
  const done = (async () => {
    for await (const event of session.events()) events.push(event);
  })();
  return { events, done };
}

describe.skipIf(!onWindows)('adaptador do Claude Code com terminal real', () => {
  it('roda o CLI num terminal, recebe os eventos pelos hooks e termina com o fim da sessão', async () => {
    const session = await adapter.start({ cwd: tmpdir(), prompt: 'corrija o teste' }, new AbortController().signal);
    const { events, done } = reading(session);

    await waitFor(() => events.some((event) => event.type === 'input.requested'));
    await session.send({ text: '/exit' });
    await done;

    expect(events.map((event) => event.type)).toEqual([
      'session.started',
      'input.requested',
      'input.received',
      'tool.requested',
      'tool.completed',
      'session.completed',
    ]);
    const argv = JSON.parse(readFileSync(recordFile, 'utf8')) as string[];
    expect(argv).toContain('--settings');
    expect(argv.at(-1)).toBe('corrija o teste');
    // O token vai pelo ambiente. Nenhum argumento da linha de comando o carrega.
    expect(argv.join(' ')).not.toContain('Bearer');
  });

  it('parar a sessão encerra o terminal, e a leitura termina com falha', async () => {
    const session = await adapter.start({ cwd: tmpdir(), prompt: 'x' }, new AbortController().signal);
    const { events, done } = reading(session);
    await waitFor(() => events.some((event) => event.type === 'session.started'));

    await session.stop('pedido do usuário');
    await done;

    expect(events.at(-1)?.type).toBe('session.failed');
  });
});
