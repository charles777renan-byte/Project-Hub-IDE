import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import {
  localDayOf,
  type DayUsage,
  type SessionActivity,
  type SessionDetail,
  type SessionTurn,
} from '../activity-types';
import { DETAIL_LIMITS, cutText } from '../session-text';
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

/** O texto de uma resposta do agente: os blocos de texto, juntos. Resposta só de ferramenta devolve `undefined`. */
function replyText(content: unknown): string | undefined {
  if (!Array.isArray(content)) return undefined;
  const parts = content
    .filter((item): item is Record<string, unknown> => isRecord(item) && item['type'] === 'text')
    .map((item) => item['text'])
    .filter((text): text is string => typeof text === 'string' && text.trim() !== '');
  return parts.length === 0 ? undefined : parts.join('\n');
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
 * Lê o conteúdo de um transcript do Claude Code e devolve a sessão: o id (o `sessionId` das linhas, que é o
 * que `claude --resume` usa), o uso por dia local e o detalhe da aba Sessões. Mensagem é um texto digitado
 * pela pessoa; tokens são entrada nova mais saída (o cache fica fora), com o último uso visto de cada
 * resposta, no dia da linha que fixou esse valor. O detalhe usa só o canal principal da conversa (o que a
 * pessoa e o agente trocaram); as linhas laterais são dos subagentes, e contam só para o número deles. Sem
 * `sessionId` a sessão não tem como ser retomada, então devolve `undefined`. Linha que não é JSON é ignorada.
 */
export function readClaudeTranscriptActivity(
  text: string,
  cwd: string,
): SessionActivity | undefined {
  let id: string | undefined;
  let startedAt: string | undefined;
  let lastActivityAt: string | undefined;
  let aiTitle: string | undefined;
  let firstPrompt: string | undefined;
  let model: string | undefined;
  let lastAgentText: string | undefined;
  let lastAssistantId: string | undefined;
  const turns: SessionTurn[] = [];
  const subagentIds = new Set<string>();
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
    lastActivityAt = timestamp;
    const sessionId = record['sessionId'];
    if (id === undefined && typeof sessionId === 'string' && sessionId !== '') id = sessionId;

    const sidechain = record['isSidechain'] === true;
    if (sidechain && typeof record['agentId'] === 'string') subagentIds.add(record['agentId']);
    if (record['type'] === 'ai-title' && typeof record['aiTitle'] === 'string') {
      aiTitle = record['aiTitle'];
    }

    if (isUserMessage(record)) {
      messagesByDay.set(date, (messagesByDay.get(date) ?? 0) + 1);
      const typed = typedText((record['message'] as Record<string, unknown>)['content']);
      if (!sidechain && typed !== undefined) {
        firstPrompt ??= typed;
        turns.push({ role: 'user', text: typed });
      }
    }

    if (record['type'] === 'assistant' && !sidechain && isRecord(record['message'])) {
      const message = record['message'];
      if (typeof message['model'] === 'string' && message['model'] !== '') model = message['model'];
      const reply = replyText(message['content']);
      if (reply !== undefined) {
        lastAgentText = reply;
        // Uma resposta gravada em várias linhas (uma por bloco) vira um turno só.
        const sameReply = typeof message['id'] === 'string' && message['id'] === lastAssistantId;
        const last = turns[turns.length - 1];
        if (sameReply && last?.role === 'agent') last.text = reply;
        else turns.push({ role: 'agent', text: reply });
        lastAssistantId = typeof message['id'] === 'string' ? message['id'] : undefined;
      }
    }

    const parsed = readUsageLine(line);
    if (parsed !== undefined) {
      // A resposta repetida em várias linhas fica com o valor da última, no dia dela.
      responses.set(parsed.id, {
        date,
        tokens: parsed.usage.inputTokens + parsed.usage.outputTokens,
      });
    }
  }

  if (id === undefined || startedAt === undefined || lastActivityAt === undefined) return undefined;

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

  const detail: SessionDetail = {
    title: detailTitle(aiTitle, firstPrompt),
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
    // O Claude grava o subagente nas linhas laterais; sem elas, zero é o número certo.
    subagents: subagentIds.size,
    messages: [...messagesByDay.values()].reduce((sum, count) => sum + count, 0),
  };
  return { id, agent: 'claude', cwd, startedAt, lastActivityAt, days, detail };
}

/**
 * A pasta de trabalho gravada no transcript: o `cwd` da primeira linha que o traz. É a pasta real da sessão, sem
 * a codificação do nome da pasta do transcript (que troca caracteres e não se desfaz). Sem nenhum `cwd`, `undefined`.
 */
export function transcriptCwd(text: string): string | undefined {
  for (const line of text.split('\n')) {
    if (line.trim() === '') continue;
    let record: unknown;
    try {
      record = JSON.parse(line);
    } catch {
      continue;
    }
    if (isRecord(record) && typeof record['cwd'] === 'string' && record['cwd'] !== '') {
      return record['cwd'];
    }
  }
  return undefined;
}

/** O título do ai-title; sem ele, o primeiro prompt cortado em 80. Sem nada, `null`. */
export function detailTitle(aiTitle: string | undefined, firstPrompt: string | undefined): string | null {
  if (aiTitle !== undefined && aiTitle.trim() !== '') return cutText(aiTitle, DETAIL_LIMITS.title);
  if (firstPrompt !== undefined && firstPrompt.trim() !== '') {
    return cutText(firstPrompt, DETAIL_LIMITS.titleFromPrompt);
  }
  return null;
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
