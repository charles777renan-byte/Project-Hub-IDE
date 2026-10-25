import { randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  TerminalPortError,
  type TerminalExit,
  type TerminalOpenInput,
  type TerminalPort,
  type TerminalSubscriber,
} from '@project-hub/application';
import { createTerminalHostPort } from '../../src/main/terminal-host-port';
import { buildTerminalEnv } from '../../src/terminal-host/env';
import { connectTerminalHost, type TerminalHostClient } from '../../src/terminal-host/client';
import { startTerminalHost, type TerminalHost } from '../../src/terminal-host/host';
import { terminalHostPipePath } from '../../src/terminal-host/protocol';
import { PtyManager } from '../../src/terminal-host/pty-manager';
import { TerminalCommands } from '../../src/terminal-host/terminal-commands';
import { createHostToken } from '../../src/terminal-host/token';

// A porta do app falando com um processo de terminais real (pipe e PowerShell de verdade).
const onWindows = process.platform === 'win32';
const TOKEN = createHostToken();
// No CI, uma execução levou mais de 20 s para o PowerShell ler a primeira tecla. Cada teste de shell espera duas
// vezes (o prompt e a entrada), por isso os prazos de espera e do teste são maiores que o padrão.
const SHELL_TIMEOUT_MS = 60_000;
const SHELL_TEST_TIMEOUT_MS = 120_000;

let pipePath = '';
let manager: PtyManager;
let host: TerminalHost | undefined;
let clients: TerminalHostClient[] = [];
let port: TerminalPort;

beforeEach(async () => {
  pipePath = terminalHostPipePath(`teste-${randomUUID().slice(0, 8)}`, process.platform, tmpdir());
  manager = new PtyManager();
  const commands = new TerminalCommands(manager);
  host = await startTerminalHost({
    pipePath,
    token: TOKEN,
    idleTimeoutMs: 60_000,
    getSessionCount: () => manager.aliveCount(),
    handleTerminal: (request, sink) => commands.handle(request, sink),
    onConnectionClosed: (sink) => commands.releaseConnection(sink),
  });
  port = createTerminalHostPort({
    connect: async () => {
      const client = await connectTerminalHost({ pipePath, token: TOKEN });
      clients.push(client);
      return client;
    },
  });
});

afterEach(async () => {
  for (const client of clients) client.close();
  clients = [];
  await manager.killAll();
  await host?.close();
  host = undefined;
});

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitFor(condition: () => boolean, timeoutMs = SHELL_TIMEOUT_MS): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!condition()) {
    if (Date.now() > deadline) throw new Error('a condição não aconteceu a tempo');
    await sleep(50);
  }
}

/**
 * O PowerShell mostra o prompt antes de o PSReadLine começar a ler o teclado, e o que se digita nesse intervalo
 * se perde (no CI isso acontece quase sempre). Reenvia um comando de prova até a resposta chegar: depois
 * disso, a entrada do teste vale.
 */
async function waitForInput(
  id: string,
  seen: { output: string },
  timeoutMs = SHELL_TIMEOUT_MS,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!seen.output.includes('pronto-2')) {
    if (Date.now() > deadline) {
      const tail = seen.output.slice(-300);
      throw new Error(
        `o shell não passou a ler a entrada a tempo; última saída: ${JSON.stringify(tail)}`,
      );
    }
    await port.write(id, 'Write-Output "pronto-$(1+1)"\r');
    const until = Date.now() + 1_000;
    while (Date.now() < until && !seen.output.includes('pronto-2')) await sleep(50);
  }
}

function shellInput(id: string): TerminalOpenInput {
  return {
    id,
    cwd: tmpdir(),
    command: 'powershell.exe',
    args: ['-NoLogo', '-NoProfile'],
    env: buildTerminalEnv(process.env),
  };
}

/** Um assinante de teste: guarda o que foi mostrado, e `onRestart` zera o que já estava na tela. */
function collector() {
  const seen = { output: '', exits: [] as TerminalExit[], restarts: 0 };
  const subscriber: TerminalSubscriber = {
    onData: (data) => {
      seen.output += data;
    },
    onExit: (exit) => {
      seen.exits.push(exit);
    },
    onRestart: () => {
      seen.restarts += 1;
      seen.output = '';
    },
  };
  return { seen, subscriber };
}

describe.skipIf(!onWindows)('porta de terminais com o processo real', () => {
  it(
    'abre um shell, recebe a saída ao vivo e informa que o terminal está vivo',
    async () => {
      const id = randomUUID();
      await port.open(shellInput(id));
      const { seen, subscriber } = collector();
      await port.subscribe(id, subscriber);
      await waitFor(() => seen.output.includes('PS '));
      await waitForInput(id, seen);

      await port.write(id, 'Write-Output "porta-$(3+3)"\r');

      await waitFor(() => seen.output.includes('porta-6'));
      await expect(port.snapshot(id)).resolves.toMatchObject({
        alive: true,
        outputBytes: expect.any(Number),
      });
    },
    SHELL_TEST_TIMEOUT_MS,
  );

  it(
    'uma assinatura nova recebe a saída guardada, e a anterior deixa de receber',
    async () => {
      const id = randomUUID();
      await port.open(shellInput(id));
      const first = collector();
      await port.subscribe(id, first.subscriber);
      await waitFor(() => first.seen.output.includes('PS '));
      await waitForInput(id, first.seen);
      await port.write(id, 'Write-Output "porta-$(3+3)"\r');
      await waitFor(() => first.seen.output.includes('porta-6'));

      const second = collector();
      await port.subscribe(id, second.subscriber);
      await waitFor(() => second.seen.output.includes('porta-6'));
      expect(second.seen.restarts).toBe(1);

      const frozen = first.seen.output.length;
      await port.write(id, 'Write-Output "porta-$(4+5)"\r');
      await waitFor(() => second.seen.output.includes('porta-9'));
      expect(first.seen.output.length).toBe(frozen);
    },
    SHELL_TEST_TIMEOUT_MS,
  );

  it(
    'encerrar o terminal avisa a assinatura com o código de saída',
    async () => {
      const id = randomUUID();
      await port.open(shellInput(id));
      const { seen, subscriber } = collector();
      await port.subscribe(id, subscriber);
      await waitFor(() => seen.output.includes('PS '));
      await waitForInput(id, seen);

      await port.kill(id);

      await waitFor(() => seen.exits.length === 1);
      expect(seen.exits[0]?.exitCode).toEqual(expect.any(Number));
      await expect(port.snapshot(id)).resolves.toMatchObject({
        alive: false,
        exit: seen.exits[0],
        outputBytes: expect.any(Number),
      });
    },
    SHELL_TEST_TIMEOUT_MS,
  );

  it('um terminal que não existe: snapshot devolve undefined e escrever lança TERMINAL_NOT_FOUND', async () => {
    await expect(port.snapshot('nao-existe')).resolves.toBeUndefined();
    const error = await port.write('nao-existe', 'x').catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(TerminalPortError);
    expect(error).toMatchObject({ code: 'TERMINAL_NOT_FOUND' });
  });

  it('abrir um id que já existe lança TERMINAL_ALREADY_EXISTS', async () => {
    const id = randomUUID();
    await port.open(shellInput(id));

    await expect(port.open(shellInput(id))).rejects.toMatchObject({
      code: 'TERMINAL_ALREADY_EXISTS',
    });
  });

  it('um programa que não existe lança PROCESS_START_FAILED', async () => {
    const input = {
      ...shellInput(randomUUID()),
      command: 'programa-que-nao-existe-xyz.exe',
      args: [],
    };

    await expect(port.open(input)).rejects.toMatchObject({ code: 'PROCESS_START_FAILED' });
  });

  it(
    'reconecta depois de uma queda e refaz a assinatura, com a saída guardada',
    async () => {
      const id = randomUUID();
      await port.open(shellInput(id));
      const { seen, subscriber } = collector();
      await port.subscribe(id, subscriber);
      await waitFor(() => seen.output.includes('PS '));
      await waitForInput(id, seen);
      await port.write(id, 'Write-Output "porta-$(3+3)"\r');
      await waitFor(() => seen.output.includes('porta-6'));

      // A queda: a conexão do app some. A próxima operação abre outra sozinha.
      clients[0]?.close();
      await port.write(id, 'Write-Output "depois-$(7+7)"\r');

      await waitFor(() => seen.output.includes('depois-14'));
      expect(seen.restarts).toBeGreaterThanOrEqual(2);
      expect(seen.output).toContain('porta-6');
    },
    SHELL_TEST_TIMEOUT_MS,
  );

  it('sem processo de terminais, a porta devolve TERMINAL_HOST_UNAVAILABLE', async () => {
    const offline = createTerminalHostPort({
      connect: () =>
        connectTerminalHost({
          pipePath: terminalHostPipePath(
            `ninguem-${randomUUID().slice(0, 8)}`,
            process.platform,
            tmpdir(),
          ),
          token: TOKEN,
        }),
    });

    await expect(offline.open(shellInput(randomUUID()))).rejects.toMatchObject({
      code: 'TERMINAL_HOST_UNAVAILABLE',
    });
  });
});
