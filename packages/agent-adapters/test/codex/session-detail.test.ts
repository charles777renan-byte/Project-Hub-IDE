import { describe, expect, it } from 'vitest';
import { readCodexSessionActivity } from '../../src/codex/session-activity';

const SESSION_ID = '0196e3a4-7b1c-7d2e-9f3a-4b5c6d7e8f90';

function at(minute: number): string {
  return new Date(2026, 9, 30, 12, minute).toISOString();
}

function meta(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    timestamp: at(0),
    type: 'session_meta',
    payload: { id: SESSION_ID, cwd: 'C:\\proj\\x', timestamp: at(0), ...overrides },
  });
}

function item(minute: number, type: 'UserMessage' | 'AgentMessage', text: string): string {
  return JSON.stringify({
    timestamp: at(minute),
    type: 'event_msg',
    payload: {
      type: 'item_completed',
      item: { type, id: `i${minute}`, content: [{ type: 'text', text }] },
    },
  });
}

function turnContext(minute: number, model: string): string {
  return JSON.stringify({ timestamp: at(minute), type: 'turn_context', payload: { model } });
}

function transcript(...lines: string[]): string {
  return lines.join('\n') + '\n';
}

describe('readCodexSessionActivity: detalhe da sessão', () => {
  it('o id vem do session_meta', () => {
    const activity = readCodexSessionActivity(transcript(meta(), item(1, 'UserMessage', 'oi')));
    expect(activity?.id).toBe(SESSION_ID);
  });

  it('sem id no session_meta a sessão não é listada', () => {
    const text = transcript(meta({ id: undefined }), item(1, 'UserMessage', 'oi'));
    expect(readCodexSessionActivity(text)).toBeUndefined();
  });

  it('o modelo é o do último turn_context', () => {
    const activity = readCodexSessionActivity(
      transcript(meta(), turnContext(1, 'gpt-5.5-codex'), item(2, 'UserMessage', 'oi'), turnContext(3, 'gpt-5.6-codex')),
    );
    expect(activity?.detail?.model).toBe('gpt-5.6-codex');
  });

  it('o primeiro prompt é a primeira mensagem do usuário, e o título é esse texto cortado em 80', () => {
    const activity = readCodexSessionActivity(
      transcript(meta(), item(1, 'UserMessage', 'a'.repeat(100)), item(2, 'UserMessage', 'depois')),
    );
    expect(activity?.detail?.firstPrompt).toBe('a'.repeat(100));
    expect(activity?.detail?.title).toBe('a'.repeat(80));
  });

  it('o último texto do agente é a última mensagem dele, cortada em 400 caracteres', () => {
    const activity = readCodexSessionActivity(
      transcript(meta(), item(1, 'UserMessage', 'oi'), item(2, 'AgentMessage', 'z'.repeat(450))),
    );
    expect(activity?.detail?.lastAgentText).toBe('z'.repeat(400));
  });

  it('os últimos 4 turnos vêm em ordem', () => {
    const activity = readCodexSessionActivity(
      transcript(
        meta(),
        item(1, 'UserMessage', 'um'),
        item(2, 'AgentMessage', 'dois'),
        item(3, 'UserMessage', 'três'),
        item(4, 'AgentMessage', 'quatro'),
        item(5, 'UserMessage', 'cinco'),
      ),
    );
    expect(activity?.detail?.lastTurns).toEqual([
      { role: 'agent', text: 'dois' },
      { role: 'user', text: 'três' },
      { role: 'agent', text: 'quatro' },
      { role: 'user', text: 'cinco' },
    ]);
  });

  it('o Codex não grava subagentes: o número é zero, como manda o spec', () => {
    const activity = readCodexSessionActivity(transcript(meta(), item(1, 'UserMessage', 'oi')));
    expect(activity?.detail?.subagents).toBe(0);
  });

  it('a última atividade é o instante da última linha lida', () => {
    const activity = readCodexSessionActivity(
      transcript(meta(), item(1, 'UserMessage', 'oi'), item(7, 'AgentMessage', 'olá')),
    );
    expect(activity?.lastActivityAt).toBe(at(7));
  });

  it('o texto com HTML chega como texto, sem alteração', () => {
    const html = '<img src=x onerror=alert(1)>';
    const activity = readCodexSessionActivity(transcript(meta(), item(1, 'UserMessage', html)));
    expect(activity?.detail?.firstPrompt).toBe(html);
  });

  it('a última linha pela metade não entra e as anteriores seguem', () => {
    const cut = transcript(meta(), item(1, 'UserMessage', 'primeiro')) + '{"timestamp":"2026-10-30T12:0';
    const activity = readCodexSessionActivity(cut);
    expect(activity?.detail?.firstPrompt).toBe('primeiro');
  });
});
