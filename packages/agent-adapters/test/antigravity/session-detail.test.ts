import { describe, expect, it } from 'vitest';
import { readAntigravityHistory } from '../../src/antigravity/history-activity';

const WORKSPACE = String.raw`C:\proj\x`;

function ms(minute: number): number {
  return new Date(2026, 9, 30, 12, minute).getTime();
}

function line(fields: Record<string, unknown>): string {
  return JSON.stringify({ workspace: WORKSPACE, ...fields });
}

describe('readAntigravityHistory: detalhe da conversa', () => {
  it('o id é o conversationId, e o primeiro prompt é a primeira mensagem que não é comando', () => {
    const [session] = readAntigravityHistory(
      [
        line({ timestamp: ms(1), type: 'slash_command', display: '/model' }),
        line({ timestamp: ms(2), conversationId: 'conv-1', display: 'quero um painel' }),
        line({ timestamp: ms(3), conversationId: 'conv-1', display: 'segunda mensagem' }),
      ].join('\n') + '\n',
    );
    expect(session?.id).toBe('conv-1');
    expect(session?.detail?.firstPrompt).toBe('quero um painel');
    expect(session?.detail?.title).toBe('quero um painel');
  });

  it('o histórico não traz resposta do agente, então o último texto e os turnos são null', () => {
    const [session] = readAntigravityHistory(
      line({ timestamp: ms(2), conversationId: 'conv-1', display: 'oi' }) + '\n',
    );
    expect(session?.detail?.lastAgentText).toBeNull();
    expect(session?.detail?.lastTurns).toBeNull();
  });

  it('modelo é null, subagentes são zero, e as mensagens contam as do usuário', () => {
    const [session] = readAntigravityHistory(
      [
        line({ timestamp: ms(2), conversationId: 'conv-1', display: 'oi' }),
        line({ timestamp: ms(3), conversationId: 'conv-1', display: 'tudo bem' }),
      ].join('\n') + '\n',
    );
    expect(session?.detail?.model).toBeNull();
    expect(session?.detail?.subagents).toBe(0);
    expect(session?.detail?.messages).toBe(2);
  });

  it('a última atividade é a última mensagem da conversa', () => {
    const [session] = readAntigravityHistory(
      [
        line({ timestamp: ms(2), conversationId: 'conv-1', display: 'oi' }),
        line({ timestamp: ms(9), conversationId: 'conv-1', display: 'de novo' }),
      ].join('\n') + '\n',
    );
    expect(session?.lastActivityAt).toBe(new Date(ms(9)).toISOString());
  });

  it('o texto com HTML chega como texto, sem alteração', () => {
    const html = '<img src=x onerror=alert(1)>';
    const [session] = readAntigravityHistory(
      line({ timestamp: ms(2), conversationId: 'conv-1', display: html }) + '\n',
    );
    expect(session?.detail?.firstPrompt).toBe(html);
  });
});
