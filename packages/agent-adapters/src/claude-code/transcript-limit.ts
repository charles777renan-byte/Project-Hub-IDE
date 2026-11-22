/**
 * A linha que o Claude Code grava no transcript quando o limite de uso da conta acaba. Ela vem como uma
 * resposta sintética com `error: "rate_limit"` e `isApiErrorMessage: true`. As versões novas trazem a
 * hora de renovação em `apiErrorParams.rate_limit_info`; as antigas só no texto ("resets 8:10pm (Zona)").
 * Só a janela, a hora e o instante saem daqui: o texto da linha não é copiado.
 */

/** A janela do limite: a de cinco horas, a semanal ou outra que a linha não deixa saber. */
export type LimitWindowKind = 'session' | 'weekly' | 'other';

export type LimitLine = {
  window: LimitWindowKind;
  /** Quando o limite renova (ISO). Sem uma hora que dê para ler, fica de fora. */
  resetsAt?: string;
  /** O `timestamp` da linha, em milissegundos. */
  at: number;
};

/** Uma linha de limite lida num transcript principal, com a sessão e o caminho real do arquivo. */
export type LimitHit = LimitLine & { sessionId: string; transcriptPath: string };

const DAY_MS = 24 * 60 * 60 * 1000;
/** A hora logo depois de "resets ", com a zona IANA entre parênteses opcional. Data antes da hora não bate. */
const RESET_TEXT = /resets (\d{1,2})(?::(\d{2}))?\s*(am|pm)(?:\s*\(([^)\s]+)\))?/i;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** O texto da resposta sintética, juntando os pedaços de texto. */
function textOf(record: Record<string, unknown>): string {
  const message = record['message'];
  if (!isRecord(message) || !Array.isArray(message['content'])) return '';
  return message['content']
    .map((part) => (isRecord(part) && typeof part['text'] === 'string' ? part['text'] : ''))
    .join(' ');
}

function windowOf(info: Record<string, unknown> | undefined, text: string): LimitWindowKind {
  const type = info?.['rateLimitType'];
  if (typeof type === 'string') {
    if (type === 'five_hour') return 'session';
    if (type.startsWith('seven_day')) return 'weekly';
    return 'other';
  }
  if (/session limit/i.test(text)) return 'session';
  if (/weekly limit/i.test(text)) return 'weekly';
  return 'other';
}

/** O formatador da zona, ou `undefined` quando a zona não existe. */
function formatterOf(timeZone: string): Intl.DateTimeFormat | undefined {
  try {
    return new Intl.DateTimeFormat('en-US', {
      timeZone,
      hourCycle: 'h23',
      year: 'numeric',
      month: 'numeric',
      day: 'numeric',
      hour: 'numeric',
      minute: 'numeric',
      second: 'numeric',
    });
  } catch {
    return undefined;
  }
}

/** O relógio da zona no instante dado, como se fosse UTC (em milissegundos). */
function wallClockOf(format: Intl.DateTimeFormat, instant: number): number {
  const parts: Record<string, number> = {};
  for (const part of format.formatToParts(new Date(instant))) {
    if (part.type !== 'literal') parts[part.type] = Number(part.value);
  }
  return Date.UTC(
    parts['year'] ?? 1970,
    (parts['month'] ?? 1) - 1,
    parts['day'] ?? 1,
    parts['hour'] ?? 0,
    parts['minute'] ?? 0,
    parts['second'] ?? 0,
  );
}

/** O instante UTC em que o relógio da zona marca `wall`. Duas correções cobrem a troca de horário de verão. */
function instantOfWall(format: Intl.DateTimeFormat, wall: number): number {
  let guess = wall - (wallClockOf(format, wall) - wall);
  guess = wall - (wallClockOf(format, guess) - guess);
  return guess;
}

/** O próximo instante, a partir de `at`, em que o relógio da zona marca `hour:minute`. */
function nextResetFromText(text: string, at: number): string | undefined {
  const match = RESET_TEXT.exec(text);
  if (match === null) return undefined;
  const hour12 = Number(match[1]);
  const minute = match[2] === undefined ? 0 : Number(match[2]);
  if (hour12 < 1 || hour12 > 12 || minute > 59) return undefined;
  const hour = (hour12 % 12) + (match[3]?.toLowerCase() === 'pm' ? 12 : 0);
  const zone = match[4] ?? Intl.DateTimeFormat().resolvedOptions().timeZone;
  const format = formatterOf(zone);
  if (format === undefined) return undefined;
  const local = new Date(wallClockOf(format, at));
  const day = Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate());
  let reset = instantOfWall(format, day + (hour * 60 + minute) * 60 * 1000);
  if (reset <= at) reset = instantOfWall(format, day + DAY_MS + (hour * 60 + minute) * 60 * 1000);
  return new Date(reset).toISOString();
}

/**
 * Lê uma linha de limite de uso. Qualquer outra linha (resposta comum, outro erro, JSON quebrado ou
 * sem `timestamp` válido) devolve `undefined`. A mensagem de erro do `JSON.parse` é descartada.
 */
export function readLimitLine(line: string): LimitLine | undefined {
  // Filtro barato antes do parse: quase nenhuma linha é de limite.
  if (!line.includes('rate_limit')) return undefined;
  let record: unknown;
  try {
    record = JSON.parse(line);
  } catch {
    return undefined;
  }
  if (!isRecord(record)) return undefined;
  if (record['error'] !== 'rate_limit' || record['isApiErrorMessage'] !== true) return undefined;
  const at = typeof record['timestamp'] === 'string' ? Date.parse(record['timestamp']) : Number.NaN;
  if (!Number.isFinite(at)) return undefined;
  const params = record['apiErrorParams'];
  const info =
    isRecord(params) && isRecord(params['rate_limit_info']) ? params['rate_limit_info'] : undefined;
  const text = textOf(record);
  const seconds = info?.['resetsAt'];
  const resetsAt =
    typeof seconds === 'number' && Number.isFinite(seconds) && seconds > 0
      ? new Date(seconds * 1000).toISOString()
      : nextResetFromText(text, at);
  const result: LimitLine = { window: windowOf(info, text), at };
  if (resetsAt !== undefined) result.resetsAt = resetsAt;
  return result;
}
