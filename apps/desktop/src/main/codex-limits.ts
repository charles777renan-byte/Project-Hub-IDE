import { readdirSync, statSync } from 'node:fs';
import { open } from 'node:fs/promises';
import { join } from 'node:path';
import type { LimitWindowDto } from '@project-hub/contracts';
import {
  MAX_SESSION_FILE_BYTES,
  listCodexSessions,
  readCodexSessionFile,
} from '@project-hub/agent-adapters';
import type { LimitsReading } from './claude-limits';

/** Um evento `token_count` do Codex com limites: a hora do evento e as janelas válidas. */
export interface CodexRateLimitEvent {
  capturedAt: string;
  windows: LimitWindowDto[];
  /** A conta informa créditos ilimitados (sem limite por janela). */
  creditsUnlimited: boolean;
}

/** Janelas de leitura do fim do arquivo, da menor para a maior (depois vem o arquivo inteiro). */
const TAIL_STEPS = [256 * 1024, 1024 * 1024, 4 * 1024 * 1024];
/** Quantos `.jsonl.zst` (do mais novo para o mais antigo) valem a descompressão numa varredura. */
const MAX_ZST_FILES = 8;
/** Teto de um `.jsonl.zst` descomprimido (o maior medido abre em ~82 MB): evita alocar centenas de MB. */
const MAX_ZST_BYTES = 128 * 1024 * 1024;
/** Um `.zst` com nome até esta folga antes do evento mais novo dos `.jsonl` ainda pode ter algo mais novo. */
const ZST_NAME_SLACK_MS = 36 * 60 * 60 * 1000;
/** Teto da leitura de um `.jsonl` inteiro (último degrau): arquivo maior só tem o fim examinado. */
const MAX_PLAIN_READ_BYTES = 64 * 1024 * 1024;
/** Snapshots de sessões simultâneas até este intervalo antes do mais novo entram na conta. */
const SIMULTANEOUS_MS = 2 * 60 * 1000;
/** Tolerância entre os `resets_at` de uma mesma janela (o Codex varia de 1 a 4 s). */
const RESET_TOLERANCE_MS = 60 * 1000;

const WINDOW_IDS: Readonly<Record<number, string>> = {
  300: 'five_hour',
  10080: 'seven_day',
  43200: 'thirty_day',
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Uma janela do Codex. `used_percent` já vem de 0 a 100 (diferente do Claude, que usa 0 a 1: não multiplicar).
 * Valor fora do intervalo ou campo faltando descarta a janela: nunca se inventa número.
 */
function toWindow(value: unknown): LimitWindowDto | undefined {
  if (!isRecord(value)) return undefined;
  const used = value['used_percent'];
  const minutes = value['window_minutes'];
  const resets = value['resets_at'];
  if (typeof used !== 'number' || !Number.isFinite(used) || used < 0 || used > 100)
    return undefined;
  if (typeof minutes !== 'number' || !Number.isInteger(minutes) || minutes <= 0) return undefined;
  if (minutes > 527040) return undefined;
  if (typeof resets !== 'number' || !Number.isFinite(resets) || resets <= 0) return undefined;
  const date = new Date(resets * 1000);
  if (Number.isNaN(date.getTime())) return undefined;
  return {
    id: WINDOW_IDS[minutes] ?? `window_${minutes}m`,
    usedPercent: Math.round(used),
    resetsAt: date.toISOString(),
    durationMinutes: minutes,
  };
}

/** Lê uma linha como evento; aceita evento sem janela (só para detectar créditos ilimitados). */
function parseEvent(line: string): CodexRateLimitEvent | null {
  if (!line.includes('"token_count"')) return null;
  let record: unknown;
  try {
    record = JSON.parse(line);
  } catch {
    return null;
  }
  if (!isRecord(record) || record['type'] !== 'event_msg') return null;
  const payload = record['payload'];
  if (!isRecord(payload) || payload['type'] !== 'token_count') return null;
  const limits = payload['rate_limits'];
  if (!isRecord(limits)) return null;
  const limitId = limits['limit_id'];
  if (limitId !== undefined && limitId !== null && limitId !== 'codex') return null;
  const timestamp = record['timestamp'];
  if (typeof timestamp !== 'string') return null;
  const time = new Date(timestamp);
  if (Number.isNaN(time.getTime())) return null;

  const windows: LimitWindowDto[] = [];
  for (const key of ['primary', 'secondary']) {
    const window = toWindow(limits[key]);
    if (window !== undefined && !windows.some((other) => other.id === window.id)) {
      windows.push(window);
    }
  }
  const credits = limits['credits'];
  const creditsUnlimited = isRecord(credits) && credits['unlimited'] === true;
  return { capturedAt: time.toISOString(), windows, creditsUnlimited };
}

/**
 * Lê uma linha `token_count` do Codex. Devolve o evento ou `null` quando a linha não é um `token_count`
 * do limite `codex` com pelo menos uma janela válida. Chaves desconhecidas são ignoradas: o formato é
 * interno do Codex e muda.
 */
export function parseCodexRateLimitLine(line: string): CodexRateLimitEvent | null {
  const event = parseEvent(line);
  return event !== null && event.windows.length > 0 ? event : null;
}

/**
 * Escolhe a leitura mais nova. Sessões simultâneas gravam snapshots até 9 pontos atrás um do outro, então,
 * para cada janela do evento mais novo, vale o maior percentual entre os eventos até 2 minutos antes dele
 * com a mesma janela (mesmo id e `resetsAt` a até 60 s). Janelas de `resetsAt` distintos não se misturam.
 */
export function pickLatestReading(
  events: readonly CodexRateLimitEvent[],
): CodexRateLimitEvent | undefined {
  let newest: CodexRateLimitEvent | undefined;
  for (const event of events) {
    if (event.windows.length === 0) continue;
    if (newest === undefined || Date.parse(event.capturedAt) > Date.parse(newest.capturedAt)) {
      newest = event;
    }
  }
  if (newest === undefined) return undefined;
  const newestTime = Date.parse(newest.capturedAt);
  const windows = newest.windows.map((window) => {
    let used = window.usedPercent;
    for (const event of events) {
      if (newestTime - Date.parse(event.capturedAt) > SIMULTANEOUS_MS) continue;
      for (const other of event.windows) {
        if (other.id !== window.id) continue;
        const gap = Math.abs(Date.parse(other.resetsAt) - Date.parse(window.resetsAt));
        if (gap > RESET_TOLERANCE_MS) continue;
        used = Math.max(used, other.usedPercent);
      }
    }
    return { ...window, usedPercent: used };
  });
  return { capturedAt: newest.capturedAt, windows, creditsUnlimited: newest.creditsUnlimited };
}

/**
 * Resultado por arquivo, guardado em cache: os eventos recentes do arquivo e se houve créditos ilimitados.
 * `unreadable` marca o arquivo que falhou ao ler (corrompido, grande demais): fica em cache para não repetir.
 */
interface FileResult {
  events: CodexRateLimitEvent[];
  unlimited: boolean;
  unreadable?: boolean;
}

/**
 * Eventos de um texto de sessão, lido do fim para o começo: os com janela, e se houve algum com créditos
 * ilimitados. Para ao achar um evento mais de 2 minutos antes do mais novo (o resto não entra na conta).
 */
function eventsOfLines(lines: readonly string[]): FileResult {
  const events: CodexRateLimitEvent[] = [];
  let unlimited = false;
  let newest = Number.NEGATIVE_INFINITY;
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const event = parseEvent(lines[index] ?? '');
    if (event === null) continue;
    if (event.windows.length === 0) {
      if (event.creditsUnlimited) unlimited = true;
      continue;
    }
    const time = Date.parse(event.capturedAt);
    if (events.length > 0 && newest - time > SIMULTANEOUS_MS) break;
    newest = Math.max(newest, time);
    events.push(event);
  }
  return { events, unlimited };
}

/**
 * As linhas do fim de um `.jsonl`, por leitura posicional (o arquivo não vai inteiro para a memória). A primeira
 * linha é descartada quando a leitura começa no meio do arquivo (pode estar cortada). Arquivo maior que o teto
 * de sessão lê só os últimos bytes do teto.
 */
export async function readTailLines(file: string, bytes: number): Promise<string[]> {
  const handle = await open(file, 'r');
  try {
    const { size } = await handle.stat();
    const length = Math.min(bytes, size, MAX_SESSION_FILE_BYTES);
    const start = size - length;
    const buffer = Buffer.alloc(length);
    let done = 0;
    while (done < length) {
      const { bytesRead } = await handle.read(buffer, done, length - done, start + done);
      if (bytesRead === 0) break;
      done += bytesRead;
    }
    const lines = buffer.subarray(0, done).toString('utf8').split('\n');
    return start > 0 ? lines.slice(1) : lines;
  } finally {
    await handle.close();
  }
}

/** Mantém só o evento mais novo e os que cabem na janela de snapshots simultâneos antes dele. */
function recentEvents(events: CodexRateLimitEvent[]): CodexRateLimitEvent[] {
  if (events.length === 0) return events;
  let newest = Number.NEGATIVE_INFINITY;
  for (const event of events) newest = Math.max(newest, Date.parse(event.capturedAt));
  return events.filter((event) => newest - Date.parse(event.capturedAt) <= SIMULTANEOUS_MS);
}

async function scanPlain(file: string, size: number): Promise<FileResult> {
  const steps = [
    ...TAIL_STEPS.filter((step) => step < Math.min(size, MAX_PLAIN_READ_BYTES)),
    Math.min(size, MAX_PLAIN_READ_BYTES),
  ];
  let result: FileResult = { events: [], unlimited: false };
  for (const step of steps) {
    result = eventsOfLines(await readTailLines(file, step));
    if (result.events.length > 0 || result.unlimited) break;
  }
  return { events: recentEvents(result.events), unlimited: result.unlimited };
}

async function scanZst(file: string): Promise<FileResult> {
  // Cede o laço de eventos antes de descomprimir (síncrono): a interface não trava entre um arquivo e outro.
  await new Promise<void>((resolve) => setImmediate(resolve));
  const result = eventsOfLines(readCodexSessionFile(file, MAX_ZST_BYTES).split('\n'));
  return { events: recentEvents(result.events), unlimited: result.unlimited };
}

const ROLLOUT_FILE = /^rollout-.*\.jsonl(\.zst)?$/;

/** Os rollouts de `<codexHome>/archived_sessions/` (pasta plana). `.jsonl` vence `.jsonl.zst` do mesmo nome. */
function archivedSessions(codexHome: string): string[] {
  const folder = join(codexHome, 'archived_sessions');
  try {
    const names = readdirSync(folder, { withFileTypes: true })
      .filter((entry) => entry.isFile() && ROLLOUT_FILE.test(entry.name))
      .map((entry) => entry.name);
    const plain = new Set(names);
    return names
      .filter((name) => !(name.endsWith('.zst') && plain.has(name.slice(0, -'.zst'.length))))
      .map((name) => join(folder, name));
  } catch {
    return [];
  }
}

/** Data do nome `rollout-AAAA-MM-DDTHH-MM-SS-<id>`, só para ordenar candidatos `.zst`. */
function nameStamp(file: string): string {
  const name = file.split(/[\\/]/).pop() ?? file;
  return /^rollout-(\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2})/.exec(name)?.[1] ?? '';
}

export interface CodexLimitsReaderOptions {
  /** Pasta do Codex (`~/.codex` ou `CODEX_HOME`). */
  codexHome: string;
  /** Gancho de teste: chamado a cada arquivo realmente lido (o cache não conta). */
  onFileRead?: (file: string) => void;
}

/**
 * O leitor de limites do Codex: lê só as linhas `token_count` dos arquivos de sessão, sem rede e sem
 * credencial. O dado vale a hora do evento (`capturedAt`), não a da leitura. Nunca abre `auth.json`, o
 * `config.toml` nem os `.sqlite`, e nunca guarda conteúdo de conversa.
 */
export function createCodexLimitsReader(options: CodexLimitsReaderOptions): {
  read(signal: AbortSignal): Promise<LimitsReading>;
} {
  const { codexHome, onFileRead } = options;
  const cache = new Map<string, { size: number; mtimeMs: number; result: FileResult }>();
  const empty: FileResult = { events: [], unlimited: false };

  /** Um erro num arquivo não derruba a leitura: o arquivo vira "sem evento" (ou "ilegível", em cache). */
  async function resultOf(file: string): Promise<FileResult> {
    let stat;
    try {
      stat = statSync(file);
    } catch {
      return empty; // sumiu entre a listagem e a leitura (compressão, arquivamento)
    }
    const cached = cache.get(file);
    if (cached !== undefined && cached.size === stat.size && cached.mtimeMs === stat.mtimeMs) {
      return cached.result;
    }
    onFileRead?.(file);
    let result: FileResult;
    try {
      result = file.endsWith('.zst') ? await scanZst(file) : await scanPlain(file, stat.size);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return empty;
      result = { events: [], unlimited: false, unreadable: true };
    }
    cache.set(file, { size: stat.size, mtimeMs: stat.mtimeMs, result });
    return result;
  }

  async function read(signal: AbortSignal): Promise<LimitsReading> {
    try {
      try {
        if (!statSync(codexHome).isDirectory()) return { ok: false, problem: 'not-installed' };
      } catch {
        return { ok: false, problem: 'not-installed' };
      }
      const candidates = [
        ...listCodexSessions(codexHome, '2000-01-01T12:00:00.000Z'),
        ...archivedSessions(codexHome),
      ];
      // O cache não guarda arquivo que saiu da lista (comprimido, arquivado, apagado).
      const listed = new Set(candidates);
      for (const key of cache.keys()) if (!listed.has(key)) cache.delete(key);
      const plain = candidates.filter((file) => !file.endsWith('.zst'));
      const zst = candidates
        .filter((file) => file.endsWith('.zst'))
        .sort((a, b) => nameStamp(b).localeCompare(nameStamp(a)) || b.localeCompare(a));

      let events: CodexRateLimitEvent[] = [];
      let unlimited = false;
      let hadError = false;
      const collect = (result: FileResult) => {
        events = events.concat(result.events);
        unlimited ||= result.unlimited;
        hadError ||= result.unreadable === true;
      };
      for (const file of plain) {
        if (signal.aborted) return { ok: false, problem: 'failed' };
        collect(await resultOf(file));
      }
      // Os `.zst` só valem se nenhum `.jsonl` deu evento, ou se o nome deles é mais novo que o melhor evento
      // achado (um `.jsonl` antigo, arquivado sem compressão, não pode esconder um `.zst` mais novo).
      let floor = '';
      if (events.length > 0) {
        let best = Number.NEGATIVE_INFINITY;
        for (const event of events) best = Math.max(best, Date.parse(event.capturedAt));
        floor = new Date(best - ZST_NAME_SLACK_MS).toISOString().slice(0, 19).replace(/:/g, '-');
      }
      const newer = zst.filter((file) => floor === '' || nameStamp(file) >= floor);
      for (const file of newer.slice(0, MAX_ZST_FILES)) {
        if (signal.aborted) return { ok: false, problem: 'failed' };
        const before = events.length;
        collect(await resultOf(file));
        if (before === 0 && events.length > 0) break;
      }

      const picked = pickLatestReading(events);
      if (picked !== undefined) {
        return { ok: true, windows: picked.windows, capturedAt: picked.capturedAt };
      }
      if (unlimited) return { ok: false, problem: 'no-limits' };
      return { ok: false, problem: hadError ? 'failed' : 'no-data' };
    } catch {
      // Sem caminho nem conteúdo na mensagem: o problema é só a categoria.
      return { ok: false, problem: 'failed' };
    }
  }

  return { read };
}
