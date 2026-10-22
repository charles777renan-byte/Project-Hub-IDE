import { timingSafeEqual } from 'node:crypto';
import { createServer, type Server, type Socket } from 'node:net';
import {
  LineDecoder,
  TERMINAL_HOST_PROTOCOL_VERSION,
  encodeMessage,
  parseRequest,
  type HostErrorCode,
  type HostRequest,
  type HostResponse,
  type TerminalRequest,
} from './protocol';
import type { EventSink } from './terminal-commands';
import { TerminalError } from './pty-manager';

export type StopReason = 'shutdown' | 'idle';

export type TerminalHostOptions = {
  pipePath: string;
  token: string;
  /** Tempo sem sessões e sem app conectado até o processo encerrar sozinho. */
  idleTimeoutMs: number;
  /** Quantas sessões de terminal estão abertas. Com sessões, o processo não encerra. */
  getSessionCount?: () => number;
  /** Tempo que um cliente tem para se identificar com o hello. */
  helloTimeoutMs?: number;
  /** Chamado quando o processo decide encerrar, por pedido ou por ociosidade. */
  onStop?: (reason: StopReason) => void;
  /** Atende os pedidos de terminal. Sem ele, esses pedidos recebem BAD_REQUEST. */
  handleTerminal?: (request: TerminalRequest, sink: EventSink) => Promise<Record<string, unknown>>;
  /** Chamado quando a conexão de um app cai, para soltar as assinaturas dela. */
  onConnectionClosed?: (sink: EventSink) => void;
};

export type TerminalHost = {
  readonly listening: boolean;
  /** Recomeça a contagem da ociosidade. Chame quando uma sessão abrir ou fechar. */
  touch(): void;
  /** Fecha o servidor e as conexões. Não chama onStop. */
  close(): Promise<void>;
};

type HelloRequest = Extract<HostRequest, { type: 'hello' }>;

/**
 * Processo de terminais: fica ouvindo um pipe, aceita o app depois de um hello com o token certo e
 * encerra só por pedido, sem sessões, ou por ociosidade. Um cliente que cai não derruba o processo.
 */
export async function startTerminalHost(options: TerminalHostOptions): Promise<TerminalHost> {
  const getSessionCount = options.getSessionCount ?? (() => 0);
  const helloTimeoutMs = options.helloTimeoutMs ?? 5_000;
  const sockets = new Set<Socket>();
  let authenticatedClients = 0;
  let listening = false;
  let stopping = false;
  let idleTimer: ReturnType<typeof setTimeout> | undefined;

  const server: Server = createServer((socket) => handleConnection(socket));

  function armIdle(): void {
    if (stopping) return;
    clearTimeout(idleTimer);
    idleTimer = setTimeout(() => {
      if (getSessionCount() === 0 && authenticatedClients === 0) void stop('idle');
      else armIdle();
    }, options.idleTimeoutMs);
  }

  function closeServer(): Promise<void> {
    clearTimeout(idleTimer);
    for (const socket of sockets) socket.destroy();
    if (!listening) return Promise.resolve();
    listening = false;
    return new Promise((resolve) => server.close(() => resolve()));
  }

  async function stop(reason: StopReason): Promise<void> {
    if (stopping) return;
    stopping = true;
    await closeServer();
    options.onStop?.(reason);
  }

  function handleConnection(socket: Socket): void {
    sockets.add(socket);
    const decoder = new LineDecoder();
    let authenticated = false;
    let finished = false;
    const sink: EventSink = {
      send: (event) => writeTo(socket, event),
    };

    const helloTimer = setTimeout(() => {
      if (!authenticated)
        finish(socket, '', 'HELLO_TIMEOUT', 'o cliente não se identificou a tempo');
    }, helloTimeoutMs);

    // Erro de um cliente (ele fechou no meio) não pode derrubar o processo.
    socket.on('error', () => undefined);
    socket.on('close', () => {
      clearTimeout(helloTimer);
      sockets.delete(socket);
      options.onConnectionClosed?.(sink);
      if (authenticated) {
        authenticatedClients -= 1;
        armIdle();
      }
    });

    function runTerminal(request: TerminalRequest): void {
      const handler = options.handleTerminal;
      if (handler === undefined) {
        socket.write(encodeMessage(failure(request.id, 'BAD_REQUEST', 'terminais indisponíveis')));
        return;
      }
      handler(request, sink).then(
        (data) => writeTo(socket, success(request.id, data)),
        (error: unknown) =>
          writeTo(socket, failure(request.id, hostErrorCode(error), messageOf(error))),
      );
    }

    function finish(target: Socket, id: string, code: HostErrorCode, message: string): void {
      finished = true;
      target.end(encodeMessage(failure(id, code, message)));
    }

    function handleLine(line: string): boolean {
      let request: HostRequest | null;
      try {
        request = parseRequest(JSON.parse(line));
      } catch {
        request = null;
      }
      if (request === null) {
        finish(socket, '', 'BAD_REQUEST', 'pedido fora do formato');
        return false;
      }
      if (request.type === 'hello') return hello(request);
      if (!authenticated) {
        finish(socket, request.id, 'NOT_AUTHENTICATED', 'envie o hello antes de qualquer pedido');
        return false;
      }
      if (request.type === 'ping') {
        socket.write(encodeMessage(success(request.id, {})));
        return true;
      }
      if (request.type === 'shutdown') return shutdown(request.id);
      runTerminal(request);
      return true;
    }

    function hello(request: HelloRequest): boolean {
      if (authenticated) {
        socket.write(
          encodeMessage(success(request.id, { protocolVersion: TERMINAL_HOST_PROTOCOL_VERSION })),
        );
        return true;
      }
      if (!tokensMatch(request.token, options.token)) {
        finish(socket, request.id, 'AUTH_FAILED', 'token inválido');
        return false;
      }
      if (request.protocolVersion !== TERMINAL_HOST_PROTOCOL_VERSION) {
        finish(
          socket,
          request.id,
          'VERSION_MISMATCH',
          `o processo fala a versão ${TERMINAL_HOST_PROTOCOL_VERSION}`,
        );
        return false;
      }
      authenticated = true;
      clearTimeout(helloTimer);
      authenticatedClients += 1;
      socket.write(
        encodeMessage(
          success(request.id, {
            protocolVersion: TERMINAL_HOST_PROTOCOL_VERSION,
            sessions: getSessionCount(),
          }),
        ),
      );
      return true;
    }

    function shutdown(id: string): boolean {
      if (getSessionCount() > 0) {
        // Recusa comum: a conexão segue aberta, porque o app ainda precisa do processo.
        socket.write(
          encodeMessage(failure(id, 'SESSIONS_ACTIVE', 'há sessões de terminal abertas')),
        );
        return true;
      }
      // A resposta sai antes do encerramento, para o app saber que o pedido foi aceito.
      socket.write(encodeMessage(success(id, {})), () => void stop('shutdown'));
      return false;
    }

    socket.on('data', (chunk: Buffer) => {
      if (finished) return;
      let lines: string[];
      try {
        lines = decoder.push(chunk);
      } catch {
        finish(socket, '', 'BAD_REQUEST', 'linha grande demais');
        return;
      }
      for (const line of lines) {
        if (!handleLine(line)) return;
      }
    });
  }

  await new Promise<void>((resolve, reject) => {
    const onError = (error: Error) => reject(error);
    server.once('error', onError);
    server.listen(options.pipePath, () => {
      server.off('error', onError);
      // Depois de ouvir, um erro do servidor não pode derrubar o processo.
      server.on('error', () => undefined);
      listening = true;
      resolve();
    });
  });
  armIdle();

  return {
    get listening() {
      return listening;
    },
    touch: armIdle,
    close: async () => {
      stopping = true;
      await closeServer();
    },
  };
}

/**
 * Escreve só se a conexão ainda aceita dados. Depois de um `end()` ou de uma queda, a escrita some sem
 * erro: o app que caiu não espera mais nada.
 */
function writeTo(socket: Socket, message: object): void {
  if (socket.writable) socket.write(encodeMessage(message));
}

/** Código de erro para a resposta. Erro que não é de terminal vira INTERNAL, sem detalhe. */
function hostErrorCode(error: unknown): HostErrorCode {
  return error instanceof TerminalError ? error.code : 'INTERNAL';
}

function messageOf(error: unknown): string {
  return error instanceof TerminalError ? error.message : 'erro interno do processo de terminais';
}

function success(id: string, data: Record<string, unknown>): HostResponse {
  return { id, ok: true, data };
}

function failure(id: string, code: HostErrorCode, message: string): HostResponse {
  return { id, ok: false, error: { code, message } };
}

/** Comparação em tempo constante, para o token não vazar pelo tempo de resposta. */
function tokensMatch(received: string, expected: string): boolean {
  const a = Buffer.from(received, 'utf8');
  const b = Buffer.from(expected, 'utf8');
  return a.length === b.length && timingSafeEqual(a, b);
}
