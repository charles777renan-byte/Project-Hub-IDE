import { posix } from 'node:path';
import { StringDecoder } from 'node:string_decoder';

/**
 * Versão do protocolo entre o app e o processo de terminais. Muda quando a forma das mensagens muda.
 * O app confere a versão no hello e recusa um processo de outra versão.
 */
export const TERMINAL_HOST_PROTOCOL_VERSION = 2;

/**
 * Tamanho máximo de uma linha. As mensagens de controle são pequenas. A saída dos terminais não passa
 * por este canal.
 */
export const MAX_LINE_BYTES = 64 * 1024;

/** Pedido do app ao processo de terminais, sem o id. */
export type HostRequestBody =
  | { type: 'hello'; protocolVersion: number; token: string }
  | { type: 'ping' }
  | { type: 'shutdown' }
  | TerminalRequestBody;

export type HostRequest = HostRequestBody & { id: string };

/** Pedidos de terminal. `terminalId` nomeia o terminal. A saída chega como evento, não na resposta. */
export type TerminalRequestBody =
  | {
      type: 'terminal.open';
      terminalId: string;
      cwd: string;
      command: string;
      args: string[];
      env: Record<string, string>;
      cols?: number;
      rows?: number;
    }
  | { type: 'terminal.write'; terminalId: string; data: string }
  | { type: 'terminal.resize'; terminalId: string; cols: number; rows: number }
  | { type: 'terminal.kill'; terminalId: string }
  | { type: 'terminal.snapshot'; terminalId: string }
  | { type: 'terminal.subscribe'; terminalId: string }
  | { type: 'terminal.unsubscribe'; terminalId: string }
  | { type: 'terminal.list' }
  | { type: 'hook.register'; executionId: string }
  | { type: 'hook.unregister'; executionId: string }
  | { type: 'hook.read'; executionId: string; afterSeq: number };

export type TerminalRequest = TerminalRequestBody & { id: string };

/** Evento que o processo manda sem ser resposta: saída e fim de um terminal assinado. */
export type HostEvent =
  | { event: 'terminal.data'; terminalId: string; data: string }
  | { event: 'terminal.exit'; terminalId: string; exitCode: number; signal?: number };

export type HostErrorCode =
  | 'AUTH_FAILED'
  | 'VERSION_MISMATCH'
  | 'NOT_AUTHENTICATED'
  | 'SESSIONS_ACTIVE'
  | 'BAD_REQUEST'
  | 'HELLO_TIMEOUT'
  | 'TERMINAL_NOT_FOUND'
  | 'TERMINAL_ALREADY_EXISTS'
  | 'TERMINAL_EXITED'
  | 'PROCESS_START_FAILED'
  | 'INTERNAL';

export type HostResponse =
  | { id: string; ok: true; data: Record<string, unknown> }
  | { id: string; ok: false; error: { code: HostErrorCode; message: string } };

/** Uma mensagem vira uma linha JSON, terminada com quebra de linha. */
export function encodeMessage(message: object): string {
  return `${JSON.stringify(message)}\n`;
}

/**
 * Separa as linhas que chegam pelo pipe. Um pedaço pode terminar no meio de uma linha ou de um caractere
 * com acento, então o resto fica guardado até a próxima chegada.
 */
export class LineDecoder {
  private readonly decoder = new StringDecoder('utf8');
  private pending = '';

  push(chunk: Buffer | string): string[] {
    this.pending += typeof chunk === 'string' ? chunk : this.decoder.write(chunk);
    const parts = this.pending.split('\n');
    this.pending = parts.pop() ?? '';
    if (Buffer.byteLength(this.pending) > MAX_LINE_BYTES || parts.some(isTooLong)) {
      throw new Error(`linha acima do limite de ${MAX_LINE_BYTES} bytes`);
    }
    return parts.filter((line) => line !== '');
  }
}

function isTooLong(line: string): boolean {
  return Buffer.byteLength(line) > MAX_LINE_BYTES;
}

/**
 * Lê uma mensagem que chegou do pipe. Devolve null para qualquer coisa fora do formato, sem lançar: a
 * entrada vem de outro processo e não é confiável.
 */
export function parseRequest(raw: unknown): HostRequest | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const message = raw as Record<string, unknown>;
  const id = message['id'];
  if (typeof id !== 'string') return null;
  const type = message['type'];
  switch (type) {
    case 'hello': {
      const token = message['token'];
      const protocolVersion = message['protocolVersion'];
      if (typeof token !== 'string' || typeof protocolVersion !== 'number') return null;
      return { id, type, protocolVersion, token };
    }
    case 'ping':
    case 'shutdown':
      return { id, type };
    default: {
      const body = parseTerminalBody(String(type), message);
      return body === null ? null : { ...body, id };
    }
  }
}

/** Valida um pedido de terminal. Devolve null se algum campo não bate com o formato. */
function parseTerminalBody(
  type: string,
  message: Record<string, unknown>,
): TerminalRequestBody | null {
  if (type === 'terminal.list') return { type: 'terminal.list' };
  if (type === 'hook.register' || type === 'hook.unregister') {
    const executionId = message['executionId'];
    return typeof executionId === 'string' ? { type, executionId } : null;
  }
  if (type === 'hook.read') {
    const executionId = message['executionId'];
    const afterSeq = message['afterSeq'];
    return typeof executionId === 'string' &&
      typeof afterSeq === 'number' &&
      Number.isInteger(afterSeq) &&
      afterSeq >= 0
      ? { type, executionId, afterSeq }
      : null;
  }
  const terminalId = message['terminalId'];
  if (typeof terminalId !== 'string') return null;
  switch (type) {
    case 'terminal.open': {
      const cwd = message['cwd'];
      const command = message['command'];
      const args = message['args'];
      const env = message['env'];
      const cols = optionalPositiveInt(message['cols']);
      const rows = optionalPositiveInt(message['rows']);
      if (typeof cwd !== 'string' || typeof command !== 'string') return null;
      if (!isStringArray(args) || !isStringRecord(env)) return null;
      if (cols === null || rows === null) return null;
      return {
        type: 'terminal.open',
        terminalId,
        cwd,
        command,
        args,
        env,
        ...(cols === undefined ? {} : { cols }),
        ...(rows === undefined ? {} : { rows }),
      };
    }
    case 'terminal.write': {
      const data = message['data'];
      return typeof data === 'string' ? { type: 'terminal.write', terminalId, data } : null;
    }
    case 'terminal.resize': {
      const cols = message['cols'];
      const rows = message['rows'];
      return isPositiveInt(cols) && isPositiveInt(rows)
        ? { type: 'terminal.resize', terminalId, cols, rows }
        : null;
    }
    case 'terminal.kill':
      return { type: 'terminal.kill', terminalId };
    case 'terminal.snapshot':
      return { type: 'terminal.snapshot', terminalId };
    case 'terminal.subscribe':
      return { type: 'terminal.subscribe', terminalId };
    case 'terminal.unsubscribe':
      return { type: 'terminal.unsubscribe', terminalId };
    default:
      return null;
  }
}

function isPositiveInt(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value > 0;
}

/** Campo opcional: undefined se ausente, o número se válido, null se presente e inválido. */
function optionalPositiveInt(value: unknown): number | undefined | null {
  if (value === undefined) return undefined;
  return isPositiveInt(value) ? value : null;
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string');
}

function isStringRecord(value: unknown): value is Record<string, string> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  return Object.values(value).every((item) => typeof item === 'string');
}

/**
 * Caminho do pipe do processo de terminais, um por usuário. No Windows é um pipe nomeado. Nos outros
 * sistemas, um arquivo de socket na pasta indicada.
 */
export function terminalHostPipePath(
  username: string,
  platform: NodeJS.Platform,
  tmpDir = '',
): string {
  const safe = username.replace(/[^A-Za-z0-9_.-]/g, '_');
  const name = `project-hub-terminal-${safe}`;
  return platform === 'win32' ? `\\\\.\\pipe\\${name}` : posix.join(tmpDir, `${name}.sock`);
}
