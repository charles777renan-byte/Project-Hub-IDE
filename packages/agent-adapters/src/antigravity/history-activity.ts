import { homedir } from 'node:os';
import { join } from 'node:path';
import {
  localDayOf,
  type DayUsage,
  type SessionActivity,
  type SessionDetail,
} from '../activity-types';
import { DETAIL_LIMITS, cutText } from '../session-text';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

type Conversation = {
  cwd: string;
  firstMs: number;
  lastMs: number;
  firstPrompt: string | undefined;
  messagesByDay: Map<string, number>;
};

/**
 * Lê o conteúdo do histórico do Antigravity CLI (`history.jsonl`, uma mensagem por linha) e devolve uma
 * sessão por conversa, com o id da conversa (`conversationId`). O histórico só guarda o texto enviado, o
 * horário em milissegundos e a pasta, então os tokens ficam `null`: sem dado, nunca zero. O detalhe traz o
 * primeiro prompt e o número de mensagens; o último texto do agente, os turnos e o modelo ficam `null`,
 * porque o histórico não os guarda. Os subagentes são zero, como manda o spec. Comando de barra não conta,
 * linha sem conversa ou sem pasta é ignorada e linha que não é JSON também.
 */
export function readAntigravityHistory(text: string): SessionActivity[] {
  const conversations = new Map<string, Conversation>();

  for (const line of text.split('\n')) {
    if (line.trim() === '') continue;
    let record: unknown;
    try {
      record = JSON.parse(line);
    } catch {
      continue;
    }
    if (!isRecord(record) || record['type'] === 'slash_command') continue;
    const id = record['conversationId'];
    const workspace = record['workspace'];
    const timestamp = record['timestamp'];
    if (typeof id !== 'string' || id === '') continue;
    if (typeof workspace !== 'string' || workspace === '') continue;
    if (typeof timestamp !== 'number') continue;
    const date = localDayOf(timestamp);
    if (date === undefined) continue;

    let conversation = conversations.get(id);
    if (conversation === undefined) {
      conversation = {
        cwd: workspace,
        firstMs: timestamp,
        lastMs: timestamp,
        firstPrompt: undefined,
        messagesByDay: new Map(),
      };
      conversations.set(id, conversation);
    }
    conversation.firstMs = Math.min(conversation.firstMs, timestamp);
    conversation.lastMs = Math.max(conversation.lastMs, timestamp);
    const display = record['display'];
    if (conversation.firstPrompt === undefined && typeof display === 'string' && display.trim() !== '') {
      conversation.firstPrompt = display;
    }
    conversation.messagesByDay.set(date, (conversation.messagesByDay.get(date) ?? 0) + 1);
  }

  return [...conversations].map(([id, conversation]) => {
    const days: DayUsage[] = [...conversation.messagesByDay.entries()]
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([date, messages]) => ({ date, messages, tokens: null }));
    const firstPrompt = conversation.firstPrompt;
    const detail: SessionDetail = {
      title:
        firstPrompt === undefined ? null : cutText(firstPrompt, DETAIL_LIMITS.titleFromPrompt),
      firstPrompt: firstPrompt === undefined ? null : cutText(firstPrompt, DETAIL_LIMITS.firstPrompt),
      lastAgentText: null,
      lastTurns: null,
      model: null,
      subagents: 0,
      messages: [...conversation.messagesByDay.values()].reduce((sum, count) => sum + count, 0),
    };
    return {
      id,
      agent: 'antigravity',
      cwd: conversation.cwd,
      startedAt: new Date(conversation.firstMs).toISOString(),
      lastActivityAt: new Date(conversation.lastMs).toISOString(),
      days,
      detail,
    };
  });
}

/** O histórico do Antigravity CLI: `~/.gemini/antigravity-cli/history.jsonl`. */
export function antigravityHistoryFile(): string {
  return join(homedir(), '.gemini', 'antigravity-cli', 'history.jsonl');
}
