import { randomUUID } from 'node:crypto';
import { connect as connectSocket } from 'node:net';
import { tmpdir } from 'node:os';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  connectTerminalHost,
  type TerminalHostClient,
} from '../../src/terminal-host/client';
import { startTerminalHost, type TerminalHost } from '../../src/terminal-host/host';
import {
  TERMINAL_HOST_PROTOCOL_VERSION,
  encodeMessage,
  terminalHostPipePath,
} from '../../src/terminal-host/protocol';
import { createHostToken } from '../../src/terminal-host/token';

const TOKEN = createHostToken();
let pipePath = '';
let host: TerminalHost | undefined;
let clients: TerminalHostClient[] = [];

beforeEach(() => {
  pipePath = terminalHostPipePath(`teste-${randomUUID().slice(0, 8)}`, process.platform, tmpdir());
});

afterEach(async () => {
  for (const client of clients) client.close();
  clients = [];
  await host?.close();
  host = undefined;
});

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitFor(condition: () => boolean, timeoutMs = 3_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!condition()) {
    if (Date.now() > deadline) throw new Error('a condição não aconteceu a tempo');
    await sleep(20);
  }
}

type StartOptions = {
  getSessionCount?: () => number;
  idleTimeoutMs?: number;
  onStop?: (reason: 'shutdown' | 'idle') => void;
};

function start(options: StartOptions = {}) {
  return startTerminalHost({
    pipePath,
    token: TOKEN,
    idleTimeoutMs: options.idleTimeoutMs ?? 60_000,
    getSessionCount: options.getSessionCount ?? (() => 0),
    onStop: options.onStop ?? (() => undefined),
  });
}

async function connect(token = TOKEN, protocolVersion = TERMINAL_HOST_PROTOCOL_VERSION): Promise<TerminalHostClient> {
  const client = await connectTerminalHost({ pipePath, token, protocolVersion });
  clients.push(client);
  return client;
}

/** Manda uma linha crua ao pipe e devolve a primeira resposta, sem passar pelo cliente. */
function sendRaw(line: string): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const socket = connectSocket(pipePath);
    const timer = setTimeout(() => reject(new Error('sem resposta')), 2_000);
    socket.once('connect', () => socket.write(line));
    socket.once('data', (chunk) => {
      clearTimeout(timer);
      socket.destroy();
      resolve(JSON.parse(chunk.toString('utf8').split('\n')[0] ?? ''));
    });
    socket.on('error', reject);
  });
}

describe('processo de terminais: conexão', () => {
  it('aceita o token certo e responde ao ping', async () => {
    host = await start();
    const client = await connect();
    await expect(client.request({ type: 'ping' })).resolves.toEqual({});
  });

  it('recusa token errado com AUTH_FAILED', async () => {
    host = await start();
    await expect(connect('token-errado')).rejects.toMatchObject({ code: 'AUTH_FAILED' });
  });

  it('recusa versão de protocolo diferente com VERSION_MISMATCH', async () => {
    host = await start();
    await expect(connect(TOKEN, TERMINAL_HOST_PROTOCOL_VERSION + 1)).rejects.toMatchObject({
      code: 'VERSION_MISMATCH',
    });
  });

  it('recusa um pedido antes do hello com NOT_AUTHENTICATED', async () => {
    host = await start();
    const response = await sendRaw(encodeMessage({ id: '1', type: 'ping' }));
    expect(response).toMatchObject({ id: '1', ok: false, error: { code: 'NOT_AUTHENTICATED' } });
  });
});

describe('processo de terminais: encerramento', () => {
  it('encerra com shutdown quando não há sessões, e para de aceitar conexões', async () => {
    const onStop = vi.fn();
    host = await start({ onStop });
    const client = await connect();
    await client.request({ type: 'shutdown' });
    await waitFor(() => onStop.mock.calls.length === 1);
    expect(onStop).toHaveBeenCalledWith('shutdown');
    await expect(connectTerminalHost({ pipePath, token: TOKEN })).rejects.toMatchObject({
      code: 'UNREACHABLE',
    });
  });

  it('recusa shutdown enquanto há sessões, e continua vivo', async () => {
    host = await start({ getSessionCount: () => 1 });
    const client = await connect();
    await expect(client.request({ type: 'shutdown' })).rejects.toMatchObject({
      code: 'SESSIONS_ACTIVE',
    });
    await expect(client.request({ type: 'ping' })).resolves.toEqual({});
  });

  it('encerra sozinho depois do tempo ocioso, sem sessões e sem app conectado', async () => {
    const onStop = vi.fn();
    host = await start({ idleTimeoutMs: 100, onStop });
    await waitFor(() => onStop.mock.calls.length === 1);
    expect(onStop).toHaveBeenCalledWith('idle');
  });

  it('não encerra por ociosidade enquanto um app está conectado', async () => {
    const onStop = vi.fn();
    host = await start({ idleTimeoutMs: 100, onStop });
    const client = await connect();
    await sleep(400);
    expect(onStop).not.toHaveBeenCalled();
    await expect(client.request({ type: 'ping' })).resolves.toEqual({});
  });

  it('continua aceitando conexões depois que um cliente sai', async () => {
    host = await start();
    const first = await connect();
    first.close();
    const second = await connect();
    await expect(second.request({ type: 'ping' })).resolves.toEqual({});
  });
});
