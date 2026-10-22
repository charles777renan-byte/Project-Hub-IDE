import { connect, type Socket } from 'node:net';
import {
  LineDecoder,
  TERMINAL_HOST_PROTOCOL_VERSION,
  encodeMessage,
  type HostErrorCode,
  type HostEvent,
  type HostRequestBody,
  type HostResponse,
} from './protocol';

export type ClientErrorCode = HostErrorCode | 'UNREACHABLE' | 'CONNECTION_LOST' | 'TIMEOUT';

/** Erro de quem fala com o processo de terminais. `code` diz o que aconteceu. */
export class TerminalHostError extends Error {
  readonly code: ClientErrorCode;

  constructor(code: ClientErrorCode, message: string) {
    super(message);
    this.name = 'TerminalHostError';
    this.code = code;
  }
}

export type ConnectOptions = {
  pipePath: string;
  token: string;
  /** Só para testes de versão. Padrão: a versão deste código. */
  protocolVersion?: number;
  requestTimeoutMs?: number;
};

type Pending = {
  resolve: (data: Record<string, unknown>) => void;
  reject: (error: TerminalHostError) => void;
  timer: ReturnType<typeof setTimeout>;
};

/** Conexão do app com o processo de terminais. Um pedido por vez pode estar pendente por id. */
export class TerminalHostClient {
  private readonly socket: Socket;
  private readonly requestTimeoutMs: number;
  private readonly decoder = new LineDecoder();
  private readonly pending = new Map<string, Pending>();
  private readonly eventListeners = new Set<(event: HostEvent) => void>();
  private nextId = 1;
  private closed = false;

  get isClosed(): boolean {
    return this.closed;
  }

  /** Eventos que o processo manda sem pedido: saída e fim dos terminais assinados. */
  onEvent(listener: (event: HostEvent) => void): () => void {
    this.eventListeners.add(listener);
    return () => {
      this.eventListeners.delete(listener);
    };
  }

  constructor(socket: Socket, requestTimeoutMs: number) {
    this.socket = socket;
    this.requestTimeoutMs = requestTimeoutMs;
    socket.on('data', (chunk: Buffer) => this.onData(chunk));
    socket.on('error', () => undefined);
    socket.on('close', () => {
      this.failAll(
        new TerminalHostError('CONNECTION_LOST', 'a conexão com o processo de terminais caiu'),
      );
    });
  }

  request(body: HostRequestBody): Promise<Record<string, unknown>> {
    if (this.closed) {
      return Promise.reject(new TerminalHostError('CONNECTION_LOST', 'a conexão já está fechada'));
    }
    const id = String(this.nextId);
    this.nextId += 1;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new TerminalHostError('TIMEOUT', 'o processo de terminais não respondeu a tempo'));
      }, this.requestTimeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      this.socket.write(encodeMessage({ id, ...body }));
    });
  }

  close(): void {
    this.closed = true;
    this.socket.destroy();
  }

  private onData(chunk: Buffer): void {
    let lines: string[];
    try {
      lines = this.decoder.push(chunk);
    } catch {
      this.close();
      return;
    }
    for (const line of lines) this.settle(line);
  }

  private settle(line: string): void {
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      return;
    }
    if (typeof parsed !== 'object' || parsed === null) return;
    if (typeof (parsed as Record<string, unknown>)['event'] === 'string') {
      for (const listener of this.eventListeners) listener(parsed as HostEvent);
      return;
    }
    const response = parsed as Partial<HostResponse>;
    if (typeof response.id !== 'string') return;
    const pending = this.pending.get(response.id);
    if (pending === undefined) return;
    this.pending.delete(response.id);
    clearTimeout(pending.timer);
    if (response.ok === true) {
      pending.resolve(response.data ?? {});
    } else if (response.ok === false && response.error !== undefined) {
      pending.reject(new TerminalHostError(response.error.code, response.error.message));
    } else {
      pending.reject(new TerminalHostError('BAD_REQUEST', 'resposta fora do formato'));
    }
  }

  private failAll(error: TerminalHostError): void {
    this.closed = true;
    for (const [id, pending] of this.pending) {
      clearTimeout(pending.timer);
      this.pending.delete(id);
      pending.reject(error);
    }
  }
}

/** Abre a conexão e se identifica com o token. Erro de autenticação ou de versão é lançado aqui. */
export async function connectTerminalHost(options: ConnectOptions): Promise<TerminalHostClient> {
  const socket = await openSocket(options.pipePath);
  const client = new TerminalHostClient(socket, options.requestTimeoutMs ?? 5_000);
  try {
    await client.request({
      type: 'hello',
      protocolVersion: options.protocolVersion ?? TERMINAL_HOST_PROTOCOL_VERSION,
      token: options.token,
    });
  } catch (error) {
    client.close();
    throw error;
  }
  return client;
}

function openSocket(pipePath: string): Promise<Socket> {
  return new Promise((resolve, reject) => {
    const socket = connect(pipePath);
    const onError = (error: Error) => {
      socket.destroy();
      reject(new TerminalHostError('UNREACHABLE', error.message));
    };
    socket.once('error', onError);
    socket.once('connect', () => {
      socket.off('error', onError);
      resolve(socket);
    });
  });
}
