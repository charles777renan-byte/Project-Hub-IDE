import { readdirSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { zstdDecompressSync } from 'node:zlib';
import { localDayOf, type DayUsage, type SessionActivity } from '../activity-types';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function count(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : 0;
}

/** Tokens acumulados da sessão em uma linha `token_count`: entrada nova (sem cache) mais saída. */
function cumulativeTokens(payload: Record<string, unknown>): number | undefined {
  const info = payload['info'];
  if (!isRecord(info)) return undefined;
  const total = info['total_token_usage'];
  if (!isRecord(total)) return undefined;
  const input = count(total['input_tokens']);
  const cached = count(total['cached_input_tokens']);
  return Math.max(0, input - cached) + count(total['output_tokens']);
}

/**
 * Lê o conteúdo de uma sessão do Codex (`rollout-*.jsonl`) e devolve o uso por dia local. A pasta e o
 * início vêm da linha `session_meta`; sem ela não há como ligar a sessão a um terminal, então devolve
 * `undefined`. Mensagem é um `UserMessage` concluído. O Codex grava os tokens como total acumulado da
 * sessão; cada dia recebe a diferença para o valor anterior (a primeira linha conta inteira, e uma
 * diferença negativa conta zero). O cache fica fora do número. Linha que não é JSON é ignorada.
 */
export function readCodexSessionActivity(text: string): SessionActivity | undefined {
  let cwd: string | undefined;
  let startedAt: string | undefined;
  const messagesByDay = new Map<string, number>();
  const tokensByDay = new Map<string, number>();
  let previous = 0;

  for (const line of text.split('\n')) {
    if (line.trim() === '') continue;
    let record: unknown;
    try {
      record = JSON.parse(line);
    } catch {
      continue;
    }
    if (!isRecord(record)) continue;
    const payload = record['payload'];
    if (!isRecord(payload)) continue;
    const timestamp = record['timestamp'];

    if (record['type'] === 'session_meta') {
      if (cwd !== undefined) continue;
      const folder = payload['cwd'];
      const started = payload['timestamp'] ?? timestamp;
      if (typeof folder !== 'string' || folder === '') continue;
      if (typeof started !== 'string' || localDayOf(started) === undefined) continue;
      cwd = folder;
      startedAt = started;
      continue;
    }

    if (record['type'] !== 'event_msg' || typeof timestamp !== 'string') continue;
    const date = localDayOf(timestamp);
    if (date === undefined) continue;

    if (payload['type'] === 'item_completed') {
      const item = payload['item'];
      if (isRecord(item) && item['type'] === 'UserMessage') {
        messagesByDay.set(date, (messagesByDay.get(date) ?? 0) + 1);
      }
    } else if (payload['type'] === 'token_count') {
      const current = cumulativeTokens(payload);
      if (current === undefined) continue;
      const delta = Math.max(0, current - previous);
      previous = current;
      if (delta > 0) tokensByDay.set(date, (tokensByDay.get(date) ?? 0) + delta);
    }
  }

  if (cwd === undefined || startedAt === undefined) return undefined;

  const dates = [...new Set([...messagesByDay.keys(), ...tokensByDay.keys()])].sort();
  const days: DayUsage[] = dates.map((date) => ({
    date,
    messages: messagesByDay.get(date) ?? 0,
    tokens: tokensByDay.get(date) ?? 0,
  }));
  return { agent: 'codex', cwd, startedAt, days };
}

function numberedFolders(parent: string, pattern: RegExp): string[] {
  try {
    return readdirSync(parent, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && pattern.test(entry.name))
      .map((entry) => entry.name)
      .sort();
  } catch {
    return [];
  }
}

const ROLLOUT_FILE = /^rollout-.*\.jsonl(\.zst)?$/;

/**
 * Os `rollout-*.jsonl` de `<codexHome>/sessions/AAAA/MM/DD/` a partir do dia local de `sinceIso`
 * (inclusive). O Codex comprime as sessões antigas para `rollout-*.jsonl.zst`; elas entram na lista
 * também, e `readCodexSessionFile` sabe abrir as duas formas. Se a mesma sessão existe nas duas formas
 * (compressão em andamento), vale só a descomprimida. Pasta inexistente, ou sem nenhuma sessão,
 * devolve lista vazia.
 */
export function listCodexSessions(codexHome: string, sinceIso: string): string[] {
  const since = localDayOf(sinceIso);
  if (since === undefined) return [];
  const root = join(codexHome, 'sessions');
  const files: string[] = [];
  for (const year of numberedFolders(root, /^\d{4}$/)) {
    for (const month of numberedFolders(join(root, year), /^\d{2}$/)) {
      for (const day of numberedFolders(join(root, year, month), /^\d{2}$/)) {
        if (`${year}-${month}-${day}` < since) continue;
        const folder = join(root, year, month, day);
        try {
          const names = readdirSync(folder, { withFileTypes: true })
            .filter((entry) => entry.isFile() && ROLLOUT_FILE.test(entry.name))
            .map((entry) => entry.name);
          const plain = new Set(names);
          for (const name of names) {
            if (name.endsWith('.zst') && plain.has(name.slice(0, -'.zst'.length))) continue;
            files.push(join(folder, name));
          }
        } catch {
          // A pasta sumiu entre a listagem e a leitura: segue sem ela.
        }
      }
    }
  }
  return files.sort();
}

/**
 * O texto de uma sessão listada por `listCodexSessions`: descomprime o `.jsonl.zst` e lê o `.jsonl`
 * como está. Arquivo ilegível ou compressão corrompida lança; quem chama decide se o dia fica como
 * "sem dado" (nunca como zero).
 */
export function readCodexSessionFile(file: string): string {
  const content = readFileSync(file);
  return (file.endsWith('.zst') ? zstdDecompressSync(content) : content).toString('utf8');
}

/**
 * A pasta do Codex: `CODEX_HOME` do ambiente (o nome é comparado sem diferenciar maiúsculas, como no
 * Windows), ou `~/.codex`. Quem lê as sessões precisa passar o mesmo ambiente que o terminal recebe.
 */
export function codexHomeOf(env: Readonly<Record<string, string | undefined>>): string {
  const entry = Object.entries(env).find(([key]) => key.toUpperCase() === 'CODEX_HOME');
  const value = entry?.[1];
  return value !== undefined && value !== '' ? value : join(homedir(), '.codex');
}
