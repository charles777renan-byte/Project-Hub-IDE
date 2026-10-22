import { timingSafeEqual } from 'node:crypto';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { HookLog, assertExecutionId, type HookEntry } from './hook-log';
import { createHostToken } from './token';

/** Tamanho máximo de um evento de hook. Maior que isso recebe 413. */
export const HOOK_BODY_LIMIT_BYTES = 1024 * 1024;

const ROUTE = /^\/hooks\/([A-Za-z0-9_-]{1,64})$/;

export type HookRegistration = {
  /** Token que o hook da execução deve enviar no cabeçalho Authorization. */
  token: string;
  /** Endereço que o hook chama. Sempre em 127.0.0.1. */
  url: string;
};

export type HookReceiverOptions = {
  logDir: string;
};

export type HookReceiver = {
  readonly port: number;
  /** Registra uma execução e cria o token dela. Sem registro, nenhum evento é aceito. */
  registerExecution(executionId: string): HookRegistration;
  /** Os tokens da execução deixam de valer. O registro em disco fica. */
  unregisterExecution(executionId: string): void;
  readAfter(executionId: string, afterSeq?: number): HookEntry[];
  close(): Promise<void>;
};

/**
 * Recebe os eventos de hook dos agentes em 127.0.0.1. Cada execução tem o próprio token, e um token não
 * vale para outra execução. Uma execução desconhecida e um token errado recebem a mesma resposta, 401.
 */
export async function startHookReceiver(options: HookReceiverOptions): Promise<HookReceiver> {
  const log = new HookLog(options.logDir);
  const tokens = new Map<string, string>();

  const server: Server = createServer((req, res) => {
    handle(req, res).catch(() => send(res, 500, { error: 'INTERNAL' }));
  });

  async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const executionId = ROUTE.exec(req.url ?? '')?.[1];
    if (req.method !== 'POST' || executionId === undefined) {
      send(res, 404, { error: 'NOT_FOUND' });
      return;
    }
    const token = tokens.get(executionId);
    if (token === undefined || !bearerMatches(req.headers.authorization, token)) {
      send(res, 401, { error: 'UNAUTHORIZED' });
      return;
    }
    const declared = Number(req.headers['content-length'] ?? 0);
    if (declared > HOOK_BODY_LIMIT_BYTES) {
      send(res, 413, { error: 'PAYLOAD_TOO_LARGE' });
      return;
    }
    const body = await readBody(req, HOOK_BODY_LIMIT_BYTES);
    if (body === null) {
      send(res, 413, { error: 'PAYLOAD_TOO_LARGE' });
      return;
    }
    const payload = parsePayload(body);
    if (payload === undefined) {
      send(res, 400, { error: 'BAD_REQUEST' });
      return;
    }
    send(res, 201, { seq: log.append(executionId, payload) });
  }

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      server.off('error', reject);
      server.on('error', () => undefined);
      resolve();
    });
  });
  const port = (server.address() as AddressInfo).port;

  return {
    get port() {
      return port;
    },
    registerExecution(executionId: string): HookRegistration {
      assertExecutionId(executionId);
      const token = createHostToken();
      tokens.set(executionId, token);
      return { token, url: `http://127.0.0.1:${port}/hooks/${executionId}` };
    },
    unregisterExecution(executionId: string): void {
      tokens.delete(executionId);
    },
    readAfter(executionId: string, afterSeq = 0): HookEntry[] {
      return log.readAfter(executionId, afterSeq);
    },
    close: () =>
      new Promise<void>((resolve) => {
        server.close(() => resolve());
        server.closeAllConnections();
      }),
  };
}

/** Lê o corpo até o limite. Devolve null se passou do limite. */
function readBody(req: IncomingMessage, maxBytes: number): Promise<Buffer | null> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    let tooLarge = false;
    req.on('data', (chunk: Buffer) => {
      if (tooLarge) return;
      size += chunk.length;
      if (size > maxBytes) {
        tooLarge = true;
        chunks.length = 0;
        resolve(null);
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(tooLarge ? null : Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

/** Um evento de hook é um objeto JSON. Outra coisa recebe 400. */
function parsePayload(body: Buffer): Record<string, unknown> | undefined {
  let value: unknown;
  try {
    value = JSON.parse(body.toString('utf8'));
  } catch {
    return undefined;
  }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined;
  return value as Record<string, unknown>;
}

function bearerMatches(header: string | undefined, expected: string): boolean {
  if (header === undefined || !header.startsWith('Bearer ')) return false;
  const received = Buffer.from(header.slice('Bearer '.length), 'utf8');
  const wanted = Buffer.from(expected, 'utf8');
  return received.length === wanted.length && timingSafeEqual(received, wanted);
}

function send(res: ServerResponse, status: number, body: object): void {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  // Resposta de erro fecha a conexão: o corpo recusado pode não ter sido lido até o fim.
  if (status !== 201) headers['connection'] = 'close';
  res.writeHead(status, headers);
  res.end(JSON.stringify(body));
}
