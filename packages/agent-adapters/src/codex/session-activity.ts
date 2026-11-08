import { readdirSync, readFileSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { zstdDecompressSync } from 'node:zlib';
import {
  localDayOf,
  type DayUsage,
  type SessionActivity,
  type SessionDetail,
  type SessionTurn,
} from '../activity-types';
import { DETAIL_LIMITS, cutText } from '../session-text';

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

/** O texto de um item do Codex: os blocos `text` do `content`, juntos. Item sem texto devolve `undefined`. */
function itemText(item: Record<string, unknown>): string | undefined {
  const content = item['content'];
  if (!Array.isArray(content)) return undefined;
  const parts = content
    .filter((block): block is Record<string, unknown> => isRecord(block))
    .map((block) => block['text'])
    .filter((text): text is string => typeof text === 'string' && text.trim() !== '');
  return parts.length === 0 ? undefined : parts.join('\n');
}

/**
 * Lê o conteúdo de uma sessão do Codex (`rollout-*.jsonl`) e devolve a sessão: o id e a pasta vêm da linha
 * `session_meta`; sem ela não há como ligar a sessão a um terminal nem retomá-la, então devolve `undefined`.
 * Mensagem é um `UserMessage` concluído. O Codex grava os tokens como total acumulado da sessão; cada dia
 * recebe a diferença para o valor anterior (a primeira linha conta inteira, e uma diferença negativa conta
 * zero). O cache fica fora do número. O detalhe vem dos itens concluídos e do `turn_context` (o modelo). O
 * O formato não grava subagentes, então `subagents` é zero, como manda o spec. Linha que não é JSON é ignorada.
 */
export function readCodexSessionActivity(text: string): SessionActivity | undefined {
  let id: string | undefined;
  let cwd: string | undefined;
  let startedAt: string | undefined;
  let lastActivityAt: string | undefined;
  let model: string | undefined;
  let firstPrompt: string | undefined;
  let lastAgentText: string | undefined;
  const turns: SessionTurn[] = [];
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
      const sessionId = payload['id'] ?? payload['session_id'];
      if (typeof folder !== 'string' || folder === '') continue;
      if (typeof started !== 'string' || localDayOf(started) === undefined) continue;
      if (typeof sessionId !== 'string' || sessionId === '') continue;
      cwd = folder;
      startedAt = started;
      id = sessionId;
      continue;
    }

    if (record['type'] === 'turn_context') {
      if (typeof payload['model'] === 'string' && payload['model'] !== '') model = payload['model'];
      continue;
    }

    if (record['type'] !== 'event_msg' || typeof timestamp !== 'string') continue;
    const date = localDayOf(timestamp);
    if (date === undefined) continue;
    lastActivityAt = timestamp;

    if (payload['type'] === 'item_completed') {
      const item = payload['item'];
      if (!isRecord(item)) continue;
      const text = itemText(item);
      if (item['type'] === 'UserMessage') {
        messagesByDay.set(date, (messagesByDay.get(date) ?? 0) + 1);
        if (text !== undefined) {
          firstPrompt ??= text;
          turns.push({ role: 'user', text });
        }
      } else if (item['type'] === 'AgentMessage' && text !== undefined) {
        lastAgentText = text;
        turns.push({ role: 'agent', text });
      }
    } else if (payload['type'] === 'token_count') {
      const current = cumulativeTokens(payload);
      if (current === undefined) continue;
      const delta = Math.max(0, current - previous);
      previous = current;
      if (delta > 0) tokensByDay.set(date, (tokensByDay.get(date) ?? 0) + delta);
    }
  }

  if (id === undefined || cwd === undefined || startedAt === undefined) return undefined;
  if (lastActivityAt === undefined) lastActivityAt = startedAt;

  const dates = [...new Set([...messagesByDay.keys(), ...tokensByDay.keys()])].sort();
  const days: DayUsage[] = dates.map((date) => ({
    date,
    messages: messagesByDay.get(date) ?? 0,
    tokens: tokensByDay.get(date) ?? 0,
  }));

  const detail: SessionDetail = {
    title: firstPrompt === undefined ? null : cutText(firstPrompt, DETAIL_LIMITS.titleFromPrompt),
    firstPrompt: firstPrompt === undefined ? null : cutText(firstPrompt, DETAIL_LIMITS.firstPrompt),
    lastAgentText:
      lastAgentText === undefined ? null : cutText(lastAgentText, DETAIL_LIMITS.lastAgentText),
    lastTurns:
      turns.length === 0
        ? null
        : turns.slice(-DETAIL_LIMITS.lastTurns).map((turn) => ({
            role: turn.role,
            text: cutText(turn.text, DETAIL_LIMITS.turn),
          })),
    model: model ?? null,
    subagents: 0,
    messages: [...messagesByDay.values()].reduce((sum, count) => sum + count, 0),
  };
  return { id, agent: 'codex', cwd, startedAt, lastActivityAt, days, detail };
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
 * Teto de tamanho de um arquivo de sessão, em disco e depois de aberto: 512 MiB. Medido numa máquina de uso
 * real: o maior `.jsonl.zst` abre em 81,7 MB e o maior `.jsonl` do Claude tem 131,9 MB (4x isso é 528 MB, e
 * 512 MiB também é o que cabe numa string do V8). Arquivo maior que isso é ilegível, não memória gasta.
 */
export const MAX_SESSION_FILE_BYTES = 512 * 1024 * 1024;

/**
 * O texto de uma sessão listada por `listCodexSessions`: descomprime o `.jsonl.zst` e lê o `.jsonl`
 * como está. Arquivo ilegível, compressão corrompida ou arquivo que passa de `maxBytes` (em disco, ou depois
 * de descomprimido) lança; quem chama decide se o dia fica como "sem dado" (nunca como zero).
 */
export function readCodexSessionFile(
  file: string,
  maxBytes: number = MAX_SESSION_FILE_BYTES,
): string {
  if (statSync(file).size > maxBytes) {
    throw new Error(`Arquivo de sessão acima do limite de ${maxBytes} bytes: ${file}`);
  }
  const content = readFileSync(file);
  // `maxOutputLength` faz o zstd lançar ao passar do limite, em vez de crescer sem fim com uma bomba de descompressão.
  const raw = file.endsWith('.zst')
    ? zstdDecompressSync(content, { maxOutputLength: maxBytes })
    : content;
  return raw.toString('utf8');
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
