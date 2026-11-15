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

function exitSpy() {
  const spy = subscriberSpy();
  const exits: number[] = [];
  return {
    ...spy,
    exits,
    subscriber: {
      ...spy.subscriber,
      onExit: (exit: { exitCode: number }) => void exits.push(exit.exitCode),
    },
  };
}

const sentOf = (client: FakeClient | undefined, type: string) =>
  (client?.sent ?? []).filter((body) => body.type === type).length;

describe('porta do app: escutas ao lado da assinatura', () => {
  it('uma escuta sozinha assina o terminal, recebe onRestart e depois os dados', async () => {
    const { port, connected } = portWith([fakeClient()]);
    const tap = subscriberSpy();
    await port.listen('t1', tap.subscriber);
    connected[0]?.emit({ event: 'terminal.data', terminalId: 't1', data: 'ola' });

    expect(tap.restarts()).toBe(1);
    expect(tap.received).toEqual(['ola']);
    expect(sentOf(connected[0], 'terminal.subscribe')).toBe(1);
  });

  it('o painel e a escuta recebem os mesmos dados, cada um uma vez', async () => {
    const { port, connected } = portWith([fakeClient()]);
    const pane = subscriberSpy();
    const tap = subscriberSpy();
    const other = subscriberSpy();
    await port.subscribe('t1', pane.subscriber);
    await port.listen('t1', tap.subscriber);
    await port.listen('t1', other.subscriber);
    connected[0]?.emit({ event: 'terminal.data', terminalId: 't1', data: 'a' });
    connected[0]?.emit({ event: 'terminal.data', terminalId: 't2', data: 'de outro terminal' });

    expect(pane.received).toEqual(['a']);
    expect(tap.received).toEqual(['a']);
    expect(other.received).toEqual(['a']);
  });

  it('quem entra num terminal já assinado refaz a assinatura e avisa onRestart a todos', async () => {
    const { port, connected } = portWith([fakeClient()]);
    const pane = subscriberSpy();
    const tap = subscriberSpy();
    await port.subscribe('t1', pane.subscriber);
    await port.listen('t1', tap.subscriber);

    // A saída guardada volta para a conexão inteira: o painel também precisa descartar o que já mostrou.
    expect(pane.restarts()).toBe(2);
    expect(tap.restarts()).toBe(1);
    expect(sentOf(connected[0], 'terminal.subscribe')).toBe(2);
  });

  it('trocar o painel não tira a escuta, e o painel antigo para de receber', async () => {
    const { port, connected } = portWith([fakeClient()]);
    const tap = subscriberSpy();
    const first = subscriberSpy();
    const second = subscriberSpy();
    await port.listen('t1', tap.subscriber);
    await port.subscribe('t1', first.subscriber);
    await port.subscribe('t1', second.subscriber);
    connected[0]?.emit({ event: 'terminal.data', terminalId: 't1', data: 'x' });

    expect(tap.received).toEqual(['x']);
    expect(tap.restarts()).toBe(3);
    expect(first.received).toEqual([]);
    expect(second.received).toEqual(['x']);
  });

  it('só o último a sair cancela a assinatura no processo de terminais', async () => {
    const { port, connected } = portWith([fakeClient()]);
    const pane = subscriberSpy();
    const tap = subscriberSpy();
    const stopPane = await port.subscribe('t1', pane.subscriber);
    const stopTap = await port.listen('t1', tap.subscriber);

    stopTap();
    stopTap();
    expect(sentOf(connected[0], 'terminal.unsubscribe')).toBe(0);
    connected[0]?.emit({ event: 'terminal.data', terminalId: 't1', data: 'só o painel' });
    expect(pane.received).toEqual(['só o painel']);
    expect(tap.received).toEqual([]);

    stopPane();
    expect(sentOf(connected[0], 'terminal.unsubscribe')).toBe(1);
  });

  it('o painel sai e a escuta continua recebendo', async () => {
    const { port, connected } = portWith([fakeClient()]);
    const pane = subscriberSpy();
    const tap = subscriberSpy();
    const stopPane = await port.subscribe('t1', pane.subscriber);
    await port.listen('t1', tap.subscriber);
    stopPane();
    connected[0]?.emit({ event: 'terminal.data', terminalId: 't1', data: 'log' });

    expect(sentOf(connected[0], 'terminal.unsubscribe')).toBe(0);
    expect(tap.received).toEqual(['log']);
    expect(pane.received).toEqual([]);
  });

  it('o fim do terminal chega a todos e limpa todos', async () => {
    const { port, connected } = portWith([fakeClient()]);
    const pane = exitSpy();
    const tap = exitSpy();
    await port.subscribe('t1', pane.subscriber);
    const stopTap = await port.listen('t1', tap.subscriber);
    connected[0]?.emit({ event: 'terminal.exit', terminalId: 't1', exitCode: 3 });
    connected[0]?.emit({ event: 'terminal.data', terminalId: 't1', data: 'depois do fim' });

    expect(pane.exits).toEqual([3]);
    expect(tap.exits).toEqual([3]);
    expect(tap.received).toEqual([]);
    // Cancelar depois do fim não manda nada: a assinatura já não existe.
    stopTap();
    expect(sentOf(connected[0], 'terminal.unsubscribe')).toBe(0);

    const late = subscriberSpy();
    await port.listen('t1', late.subscriber);
    expect(sentOf(connected[0], 'terminal.subscribe')).toBe(3);
  });

  it('depois de uma queda, a assinatura volta uma vez por terminal e todos recebem onRestart', async () => {
    const { port, connected } = portWith([fakeClient(), fakeClient()]);
    const pane = subscriberSpy();
    const tap = subscriberSpy();
    await port.subscribe('t1', pane.subscriber);
    await port.listen('t1', tap.subscriber);
    connected[0]?.close();

    await port.write('t1', 'a');
    connected[1]?.emit({ event: 'terminal.data', terminalId: 't1', data: 'vivo' });

    expect(sentOf(connected[1], 'terminal.subscribe')).toBe(1);
    expect(pane.restarts()).toBe(3);
    expect(tap.restarts()).toBe(2);
    expect(pane.received).toEqual(['vivo']);
    expect(tap.received).toEqual(['vivo']);
  });

  it('uma escuta cujo terminal não existe falha e não fica guardada', async () => {
    const { port, connected } = portWith([fakeClient('TERMINAL_NOT_FOUND')]);
    const tap = subscriberSpy();
    await expect(port.listen('t1', tap.subscriber)).rejects.toMatchObject({
      code: 'TERMINAL_NOT_FOUND',
    });
    connected[0]?.emit({ event: 'terminal.data', terminalId: 't1', data: 'fantasma' });
    expect(tap.received).toEqual([]);
  });
});
