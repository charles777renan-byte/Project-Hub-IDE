import {
  TerminalPortError,
  type TerminalErrorCode,
  type TerminalExit,
  type TerminalOpenInput,
  type TerminalPort,
  type TerminalSnapshot,
  type TerminalSubscriber,
} from '@project-hub/application';
import { TerminalHostError, type TerminalHostClient } from '../terminal-host/client';
import type { HostEvent, HostRequestBody } from '../terminal-host/protocol';

export type TerminalHostPortOptions = {
  /** Abre a conexão com o processo de terminais, subindo o processo se preciso. */
  connect: () => Promise<TerminalHostClient>;
};

/**
 * Porta de terminais da aplicação, falada com o processo de terminais por pipe. Reconecta sozinha: se a
 * conexão cai, a próxima operação abre outra, e as assinaturas vivas são refeitas. Cada assinatura
 * recebe `onRestart` antes da saída guardada voltar, para ela descartar o que já mostrou.
 *
 * Cada terminal tem um assinante principal (o painel na tela) e, ao lado dele, escutas (`listen`). O processo de
 * terminais só conhece uma assinatura por terminal nesta conexão: ela existe enquanto houver alguém, e a saída é
 * repartida aqui.
 */
export function createTerminalHostPort(options: TerminalHostPortOptions): TerminalPort {
  let client: TerminalHostClient | undefined;
  let connecting: Promise<TerminalHostClient> | undefined;
  /** Quem recebe a saída de um terminal: o painel (no máximo um) e as escutas. */
  type Audience = { primary: TerminalSubscriber | undefined; listeners: Set<TerminalSubscriber> };
  const audiences = new Map<string, Audience>();

  const membersOf = (audience: Audience): TerminalSubscriber[] =>
    audience.primary === undefined
      ? [...audience.listeners]
      : [audience.primary, ...audience.listeners];

  function dispatch(event: HostEvent): void {
    const audience = audiences.get(event.terminalId);
    if (audience === undefined) return;
    if (event.event === 'terminal.data') {
      for (const member of membersOf(audience)) member.onData(event.data);
      return;
    }
    audiences.delete(event.terminalId);
    const exit =
      event.signal === undefined
        ? { exitCode: event.exitCode }
        : { exitCode: event.exitCode, signal: event.signal };
    for (const member of membersOf(audience)) member.onExit(exit);
  }

  async function connectAndRestore(): Promise<TerminalHostClient> {
    const next = await options.connect().catch((error: unknown) => {
      throw toPortError(error);
    });
    next.onEvent(dispatch);
    client = next;
    for (const [terminalId, audience] of [...audiences]) {
      for (const member of membersOf(audience)) member.onRestart();
      await next.request({ type: 'terminal.subscribe', terminalId }).catch((error: unknown) => {
        // Só some quando o terminal não existe mais. Uma queda no meio da volta mantém a assinatura:
        // a próxima operação reconecta e refaz a volta.
        if (error instanceof TerminalHostError && error.code === 'TERMINAL_NOT_FOUND') {
          audiences.delete(terminalId);
        }
      });
    }
    return next;
  }

  async function current(): Promise<TerminalHostClient> {
    if (client !== undefined && !client.isClosed) return client;
    connecting ??= connectAndRestore().finally(() => {
      connecting = undefined;
    });
    return connecting;
  }

  async function call(body: HostRequestBody): Promise<Record<string, unknown>> {
    const active = await current();
    return active.request(body).catch((error: unknown) => {
      throw toPortError(error);
    });
  }

  /** Tira `subscriber` do terminal, se ainda é ele quem está lá. Devolve se tirou. */
  function leave(id: string, subscriber: TerminalSubscriber, primary: boolean): boolean {
    const audience = audiences.get(id);
    if (audience === undefined) return false;
    if (primary) {
      if (audience.primary !== subscriber) return false;
      audience.primary = undefined;
    } else if (!audience.listeners.delete(subscriber)) {
      return false;
    }
    if (membersOf(audience).length === 0) audiences.delete(id);
    return true;
  }

  /**
   * Põe `subscriber` no terminal e refaz a assinatura no processo de terminais, que manda a saída guardada outra
   * vez para a conexão inteira. Por isso todos recebem `onRestart` antes: o que cada um já mostrou vai chegar de novo.
   */
  async function join(
    id: string,
    subscriber: TerminalSubscriber,
    primary: boolean,
  ): Promise<() => void> {
    await current();
    const audience = audiences.get(id) ?? { primary: undefined, listeners: new Set() };
    audiences.set(id, audience);
    if (primary) audience.primary = subscriber;
    else audience.listeners.add(subscriber);
    for (const member of membersOf(audience)) member.onRestart();
    try {
      await call({ type: 'terminal.subscribe', terminalId: id });
    } catch (error) {
      leave(id, subscriber, primary);
      throw error;
    }
    return () => {
      if (!leave(id, subscriber, primary)) return;
      // Ainda há alguém ouvindo: a assinatura do processo de terminais fica.
      if (audiences.has(id)) return;
      if (client !== undefined && !client.isClosed) {
        void client
          .request({ type: 'terminal.unsubscribe', terminalId: id })
          .catch(() => undefined);
      }
    };
  }

  return {
    async open(input: TerminalOpenInput): Promise<void> {
      await call({
        type: 'terminal.open',
        terminalId: input.id,
        cwd: input.cwd,
        command: input.command,
        args: [...input.args],
        env: { ...input.env },
        ...(input.cols === undefined ? {} : { cols: input.cols }),
        ...(input.rows === undefined ? {} : { rows: input.rows }),
      });
    },

    async write(id: string, data: string): Promise<void> {
      await call({ type: 'terminal.write', terminalId: id, data });
    },

    async resize(id: string, cols: number, rows: number): Promise<void> {
      await call({ type: 'terminal.resize', terminalId: id, cols, rows });
    },

    async kill(id: string): Promise<void> {
      await call({ type: 'terminal.kill', terminalId: id });
    },

    async remove(id: string): Promise<void> {
      await call({ type: 'terminal.remove', terminalId: id });
    },

    async snapshot(id: string): Promise<TerminalSnapshot | undefined> {
      try {
        const data = await call({ type: 'terminal.snapshot', terminalId: id });
        const bytes = data['outputBytes'];
        const outputBytes = typeof bytes === 'number' && bytes >= 0 ? { outputBytes: bytes } : {};
        if (data['alive'] === true) return { alive: true, ...outputBytes };
        const exit = data['exit'];
        return isExit(exit)
          ? { alive: false, exit, ...outputBytes }
          : { alive: false, ...outputBytes };
      } catch (error) {
        if (error instanceof TerminalPortError && error.code === 'TERMINAL_NOT_FOUND')
          return undefined;
        throw error;
      }
    },

    subscribe: (id: string, subscriber: TerminalSubscriber) => join(id, subscriber, true),

    listen: (id: string, listener: TerminalSubscriber) => join(id, listener, false),
  };
}

/** Traduz o erro da conexão ou do processo para o erro da porta, com um código do contrato. */
export function toPortError(error: unknown): TerminalPortError {
  if (error instanceof TerminalPortError) return error;
  if (!(error instanceof TerminalHostError)) {
    return new TerminalPortError(
      'UNKNOWN',
      error instanceof Error ? error.message : 'erro desconhecido no terminal',
    );
  }
  return new TerminalPortError(portCodeOf(error), error.message);
}

function portCodeOf(error: TerminalHostError): TerminalErrorCode {
  switch (error.code) {
    case 'TERMINAL_NOT_FOUND':
    case 'TERMINAL_ALREADY_EXISTS':
    case 'TERMINAL_EXITED':
    case 'PROCESS_START_FAILED':
      return error.code;
    case 'UNREACHABLE':
    case 'CONNECTION_LOST':
    case 'TIMEOUT':
    case 'AUTH_FAILED':
    case 'VERSION_MISMATCH':
      return 'TERMINAL_HOST_UNAVAILABLE';
    default:
      return 'UNKNOWN';
  }
}

function isExit(value: unknown): value is TerminalExit {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as Record<string, unknown>)['exitCode'] === 'number'
  );
}
