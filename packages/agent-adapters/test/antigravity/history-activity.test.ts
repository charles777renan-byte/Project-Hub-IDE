import { homedir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  antigravityHistoryFile,
  readAntigravityHistory,
} from '../../src/antigravity/history-activity';

const WORKSPACE = String.raw`C:\proj\x`;

function ms(year: number, month: number, day: number, hour = 12, minute = 0): number {
  return new Date(year, month - 1, day, hour, minute).getTime();
}

function line(fields: Record<string, unknown>): string {
  return JSON.stringify({ display: 'texto', workspace: WORKSPACE, ...fields });
}

function history(...lines: string[]): string {
  return lines.join('\n') + '\n';
}

describe('readAntigravityHistory', () => {
  it('conta as mensagens da conversa e deixa o comando de barra de fora', () => {
    const sessions = readAntigravityHistory(
      history(
        line({ timestamp: ms(2026, 10, 30), type: 'slash_command', display: '/model' }),
        line({ timestamp: ms(2026, 10, 30, 12, 5), conversationId: 'c1' }),
        line({
          timestamp: ms(2026, 10, 30, 12, 6),
          conversationId: 'c1',
          type: 'slash_command',
          display: '/usage',
        }),
        line({ timestamp: ms(2026, 10, 30, 12, 9), conversationId: 'c1' }),
      ),
    );

    expect(sessions).toHaveLength(1);
    expect(sessions[0]).toEqual({
      agent: 'antigravity',
      cwd: WORKSPACE,
      startedAt: new Date(ms(2026, 10, 30, 12, 5)).toISOString(),
      days: [{ date: '2026-10-30', messages: 2, tokens: null }],
    });
  });

  it('separa duas conversas na mesma pasta em duas sessões', () => {
    const sessions = readAntigravityHistory(
      history(
        line({ timestamp: ms(2026, 10, 30), conversationId: 'c1' }),
        line({ timestamp: ms(2026, 10, 31), conversationId: 'c2' }),
      ),
    );

    expect(sessions.map((session) => session.cwd)).toEqual([WORKSPACE, WORKSPACE]);
    expect(sessions.map((session) => session.days)).toEqual([
      [{ date: '2026-10-30', messages: 1, tokens: null }],
      [{ date: '2026-10-31', messages: 1, tokens: null }],
    ]);
  });

  it('reparte a conversa que cruza a meia-noite pelo dia local de cada mensagem', () => {
    const [session] = readAntigravityHistory(
      history(
        line({ timestamp: ms(2026, 10, 30, 23, 59), conversationId: 'c1' }),
        line({ timestamp: ms(2026, 10, 31, 0, 1), conversationId: 'c1' }),
      ),
    );

    expect(session?.days).toEqual([
      { date: '2026-10-30', messages: 1, tokens: null },
      { date: '2026-10-31', messages: 1, tokens: null },
    ]);
  });

  it('usa a primeira mensagem como início, mesmo fora de ordem no arquivo', () => {
    const [session] = readAntigravityHistory(
      history(
        line({ timestamp: ms(2026, 10, 30, 15), conversationId: 'c1' }),
        line({ timestamp: ms(2026, 10, 30, 9), conversationId: 'c1' }),
      ),
    );

    expect(session?.startedAt).toBe(new Date(ms(2026, 10, 30, 9)).toISOString());
  });

  it('deixa os tokens como null, porque o Antigravity não os informa', () => {
    const sessions = readAntigravityHistory(
      history(line({ timestamp: ms(2026, 10, 30), conversationId: 'c1' })),
    );

    for (const session of sessions) {
      for (const day of session.days) expect(day.tokens).toBeNull();
    }
  });

  it('ignora linha sem conversa, sem pasta ou sem horário válido', () => {
    const sessions = readAntigravityHistory(
      history(
        line({ timestamp: ms(2026, 10, 30) }),
        line({ timestamp: ms(2026, 10, 30), conversationId: 'c1', workspace: undefined }),
        line({ timestamp: 'ontem', conversationId: 'c1' }),
        line({ timestamp: ms(2026, 10, 30), conversationId: 'c1' }),
      ),
    );

    expect(sessions).toHaveLength(1);
    expect(sessions[0]?.days).toEqual([{ date: '2026-10-30', messages: 1, tokens: null }]);
  });

  it('ignora linha que não é JSON, inclusive a cortada no fim', () => {
    const text =
      history(
        'isto não é JSON',
        line({ timestamp: ms(2026, 10, 30), conversationId: 'c1' }),
      ) + '{"display":"texto","timest';

    const sessions = readAntigravityHistory(text);

    expect(sessions).toHaveLength(1);
    expect(sessions[0]?.days).toEqual([{ date: '2026-10-30', messages: 1, tokens: null }]);
  });

  it('devolve lista vazia para texto vazio', () => {
    expect(readAntigravityHistory('')).toEqual([]);
    expect(readAntigravityHistory('\n\n')).toEqual([]);
  });
});

describe('antigravityHistoryFile', () => {
  it('aponta para o histórico do CLI na pasta pessoal', () => {
    expect(antigravityHistoryFile()).toBe(
      join(homedir(), '.gemini', 'antigravity-cli', 'history.jsonl'),
    );
  });
});
