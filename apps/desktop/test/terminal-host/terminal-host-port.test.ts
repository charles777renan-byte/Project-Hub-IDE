import { describe, expect, it } from 'vitest';
import { createTerminalHostPort } from '../../src/main/terminal-host-port';
import { TerminalHostError, type TerminalHostClient } from '../../src/terminal-host/client';
import type { HostEvent, HostRequestBody } from '../../src/terminal-host/protocol';

// Cliente falso: anota os pedidos e deixa o teste emitir eventos. Para um pedido de assinatura, pode
// falhar com o código dado, como faria uma queda ou um terminal que sumiu.
type FakeClient = {
  isClosed: boolean;
  sent: HostRequestBody[];
  emit(event: HostEvent): void;
  close(): void;
  request(body: HostRequestBody): Promise<Record<string, unknown>>;
  onEvent(listener: (event: HostEvent) => void): () => void;
};

function fakeClient(failSubscribeWith?: 'CONNECTION_LOST' | 'TERMINAL_NOT_FOUND'): FakeClient {
  const listeners: Array<(event: HostEvent) => void> = [];
  const fake: FakeClient = {
    isClosed: false,
    sent: [],
    emit(event) {
      for (const listener of listeners) listener(event);
    },
    close() {
      fake.isClosed = true;
    },
    request(body) {
      fake.sent.push(body);
      if (body.type === 'terminal.subscribe' && failSubscribeWith !== undefined) {
        return Promise.reject(new TerminalHostError(failSubscribeWith, 'falha simulada'));
      }
      return Promise.resolve({});
    },
    onEvent(listener) {
      listeners.push(listener);
      return () => undefined;
    },
  };
  return fake;
}

/** Porta ligada a uma sequência de clientes falsos: cada conexão nova pega o próximo da lista. */
function portWith(clients: FakeClient[]) {
  const connected: FakeClient[] = [];
  const port = createTerminalHostPort({
    connect: async () => {
      const next = clients[connected.length];
      if (next === undefined) throw new TerminalHostError('UNREACHABLE', 'sem mais clientes');
      connected.push(next);
      return next as unknown as TerminalHostClient;
    },
  });
  return { port, connected };
}

function subscriberSpy() {
  const received: string[] = [];
  let restarts = 0;
  return {
    received,
    restarts: () => restarts,
    subscriber: {
      onData: (data: string) => {
        received.push(data);
      },
      onExit: () => undefined,
      onRestart: () => {
        restarts += 1;
      },
    },
  };
}

const OPEN = { id: 't1', cwd: 'C:\\', command: 'powershell.exe', args: [], env: {} };

describe('porta do app: volta depois de uma queda', () => {
  it('uma queda no meio da volta mantém a assinatura, que volta a receber na conexão seguinte', async () => {
    const { port, connected } = portWith([fakeClient(), fakeClient('CONNECTION_LOST')]);
    const spy = subscriberSpy();
    await port.open(OPEN);
    await port.subscribe('t1', spy.subscriber);
    connected[0]?.close();

    // Reconecta; a volta da assinatura falha por queda; a operação segue na conexão nova.
    await port.write('t1', 'a');
    connected[1]?.emit({ event: 'terminal.data', terminalId: 't1', data: 'vivo' });

    expect(spy.received).toEqual(['vivo']);
    expect(spy.restarts()).toBe(2);
  });

  it('se o terminal sumiu do processo, a volta tira a assinatura e nada mais chega a ela', async () => {
    const { port, connected } = portWith([fakeClient(), fakeClient('TERMINAL_NOT_FOUND')]);
    const spy = subscriberSpy();
    await port.open(OPEN);
    await port.subscribe('t1', spy.subscriber);
    connected[0]?.close();

    await port.write('t1', 'a');
    connected[1]?.emit({ event: 'terminal.data', terminalId: 't1', data: 'fantasma' });

    expect(spy.received).toEqual([]);
  });
});
