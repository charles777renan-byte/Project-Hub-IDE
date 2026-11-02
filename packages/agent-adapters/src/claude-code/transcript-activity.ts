import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { localDayOf, type DayUsage, type SessionActivity } from '../activity-types';
import { readUsageLine } from './transcript-usage';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** O texto que a pessoa digitou, ou `undefined` quando a linha não é uma mensagem dela (resultado de ferramenta, anexo). */
function typedText(content: unknown): string | undefined {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return undefined;
  let text: string | undefined;
  for (const item of content) {
    if (!isRecord(item)) continue;
    if (item['type'] === 'tool_result') return undefined;
    if (item['type'] === 'text' && text === undefined && typeof item['text'] === 'string') {
      text = item['text'];
    }
  }
  return text;
}

function isUserMessage(record: Record<string, unknown>): boolean {
  if (record['type'] !== 'user' || record['isMeta'] === true) return false;
  const message = record['message'];
  if (!isRecord(message)) return false;
  const text = typedText(message['content']);
  if (text === undefined) return false;
  const start = text.trimStart();
  // Comando de barra e a saída dele não são mensagens da pessoa ao agente.
  return !start.startsWith('<command-name>') && !start.startsWith('<local-command');
}

/**
 * Lê o conteúdo de um transcript do Claude Code e devolve o uso por dia local. Mensagem é um texto
 * digitado pela pessoa; tokens são entrada nova mais saída (o cache fica fora), com o último uso visto
 * de cada resposta, no dia da linha que fixou esse valor. Linha que não é JSON é ignorada.
 */
export function readClaudeTranscriptActivity(
  text: string,
  cwd: string,
): SessionActivity | undefined {
  let startedAt: string | undefined;
  const messagesByDay = new Map<string, number>();
  const responses = new Map<string, { date: string; tokens: number }>();

  for (const line of text.split('\n')) {
    if (line.trim() === '') continue;
    let record: unknown;
    try {
      record = JSON.parse(line);
    } catch {
      continue;
    }
    if (!isRecord(record)) continue;
    const timestamp = record['timestamp'];
    const date = typeof timestamp === 'string' ? localDayOf(timestamp) : undefined;
    if (typeof timestamp !== 'string' || date === undefined) continue;
    startedAt ??= timestamp;

    if (isUserMessage(record)) messagesByDay.set(date, (messagesByDay.get(date) ?? 0) + 1);

    const parsed = readUsageLine(line);
    if (parsed !== undefined) {
      // A resposta repetida em várias linhas fica com o valor da última, no dia dela.
      responses.set(parsed.id, {
        date,
        tokens: parsed.usage.inputTokens + parsed.usage.outputTokens,
      });
    }
  }

  if (startedAt === undefined) return undefined;

  const tokensByDay = new Map<string, number>();
  for (const { date, tokens } of responses.values()) {
    tokensByDay.set(date, (tokensByDay.get(date) ?? 0) + tokens);
  }
  const dates = [...new Set([...messagesByDay.keys(), ...tokensByDay.keys()])].sort();
  const days: DayUsage[] = dates.map((date) => ({
    date,
    messages: messagesByDay.get(date) ?? 0,
    tokens: tokensByDay.get(date) ?? 0,
  }));
  return { agent: 'claude', cwd, startedAt, days };
}

/**
 * Os transcripts de um projeto: `<configDir>/projects/<pasta codificada>/*.jsonl`. O Claude Code troca
 * todo caractere fora de `[A-Za-z0-9]` do caminho por `-`. Pasta inexistente devolve lista vazia.
 */
export function listClaudeTranscripts(configDir: string, cwd: string): string[] {
  const folder = join(configDir, 'projects', cwd.replace(/[^A-Za-z0-9]/g, '-'));
  try {
    return readdirSync(folder, { withFileTypes: true })
      .filter((entry) => entry.isFile() && entry.name.endsWith('.jsonl'))
      .map((entry) => join(folder, entry.name))
      .sort();
  } catch {
    return [];
  }
}
