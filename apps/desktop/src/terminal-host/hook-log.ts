import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/** Um evento de hook gravado. `seq` cresce de 1 em 1 dentro de cada execução. */
export type HookEntry = {
  seq: number;
  receivedAt: string;
  payload: Record<string, unknown>;
};

/** Id de execução: nome simples, sem barra nem ponto, que vira nome de arquivo. */
const EXECUTION_ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;

/** Lança se o id não for um nome simples de arquivo. */
export function assertExecutionId(executionId: string): void {
  if (!EXECUTION_ID_PATTERN.test(executionId)) {
    throw new Error(`id de execução inválido: ${JSON.stringify(executionId)}`);
  }
}

type ExecutionState = {
  lastSeq: number;
  /** Verdadeiro quando o arquivo termina sem quebra de linha, por uma gravação que foi interrompida. */
  needsLineBreak: boolean;
};

/**
 * Registro dos eventos de hook de cada execução, em um arquivo JSONL por execução. Cada linha é um
 * evento com número de sequência. O arquivo sobrevive ao reinício do processo, e a sequência continua
 * de onde parou.
 */
export class HookLog {
  private readonly dir: string;
  private readonly states = new Map<string, ExecutionState>();

  constructor(dir: string) {
    this.dir = dir;
    mkdirSync(dir, { recursive: true });
  }

  /** Grava o evento e devolve o número da sequência que ele recebeu. */
  append(executionId: string, payload: Record<string, unknown>, now = new Date()): number {
    const state = this.stateOf(executionId);
    const seq = state.lastSeq + 1;
    const entry: HookEntry = { seq, receivedAt: now.toISOString(), payload };
    const prefix = state.needsLineBreak ? '\n' : '';
    appendFileSync(this.fileOf(executionId), `${prefix}${JSON.stringify(entry)}\n`);
    state.lastSeq = seq;
    state.needsLineBreak = false;
    return seq;
  }

  /** Eventos com sequência maior que `afterSeq`, em ordem. Linhas que não são eventos são ignoradas. */
  readAfter(executionId: string, afterSeq = 0): HookEntry[] {
    return this.readAll(executionId).filter((entry) => entry.seq > afterSeq);
  }

  private stateOf(executionId: string): ExecutionState {
    const known = this.states.get(executionId);
    if (known !== undefined) return known;
    const content = this.readContent(executionId);
    const state: ExecutionState = {
      lastSeq: maxSeq(parseEntries(content)),
      needsLineBreak: content !== '' && !content.endsWith('\n'),
    };
    this.states.set(executionId, state);
    return state;
  }

  private readAll(executionId: string): HookEntry[] {
    return parseEntries(this.readContent(executionId));
  }

  private readContent(executionId: string): string {
    const file = this.fileOf(executionId);
    return existsSync(file) ? readFileSync(file, 'utf8') : '';
  }

  private fileOf(executionId: string): string {
    assertExecutionId(executionId);
    return join(this.dir, `${executionId}.jsonl`);
  }
}

function parseEntries(content: string): HookEntry[] {
  const entries: HookEntry[] = [];
  for (const line of content.split('\n')) {
    if (line === '') continue;
    const entry = parseEntry(line);
    if (entry !== undefined) entries.push(entry);
  }
  return entries;
}

function parseEntry(line: string): HookEntry | undefined {
  let value: unknown;
  try {
    value = JSON.parse(line);
  } catch {
    return undefined;
  }
  if (typeof value !== 'object' || value === null) return undefined;
  const candidate = value as Record<string, unknown>;
  const { seq, receivedAt, payload } = candidate;
  if (typeof seq !== 'number' || typeof receivedAt !== 'string') return undefined;
  if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) return undefined;
  return { seq, receivedAt, payload: payload as Record<string, unknown> };
}

function maxSeq(entries: readonly HookEntry[]): number {
  let max = 0;
  for (const entry of entries) max = Math.max(max, entry.seq);
  return max;
}
