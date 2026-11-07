import { describe, expect, it } from 'vitest';
import { readClaudeTranscriptActivity } from '../../src/claude-code/transcript-activity';

const CWD = String.raw`C:\proj\x`;
const SESSION = '239cc7d5-58ba-47d7-8c2a-1d5e6f7a8b9c';

function at(minute: number): string {
  return new Date(2026, 9, 30, 12, minute).toISOString();
}

function rec(fields: Record<string, unknown>): string {
  return JSON.stringify({ sessionId: SESSION, timestamp: at(0), ...fields });
}

function prompt(minute: number, text: string, extra: Record<string, unknown> = {}): string {
  return rec({
    type: 'user',
    timestamp: at(minute),
    message: { role: 'user', content: text },
    ...extra,
  });
}

function reply(minute: number, text: string, extra: Record<string, unknown> = {}): string {
  return rec({
    type: 'assistant',
    timestamp: at(minute),
    message: {
      id: `m${minute}`,
      role: 'assistant',
      model: 'claude-sonnet-5-5',
      content: [{ type: 'text', text }],
      usage: { input_tokens: 10, output_tokens: 5 },
    },
    ...extra,
  });
}

function transcript(...lines: string[]): string {
  return lines.join('\n') + '\n';
}

describe('readClaudeTranscriptActivity: detalhe da sessão', () => {
  it('usa o sessionId das linhas como id e o último instante como última atividade', () => {
    const activity = readClaudeTranscriptActivity(
      transcript(prompt(1, 'oi'), reply(2, 'olá')),
      CWD,
    );
    expect(activity?.id).toBe(SESSION);
    expect(activity?.startedAt).toBe(at(1));
    expect(activity?.lastActivityAt).toBe(at(2));
  });

  it('sem sessionId nas linhas não há como retomar a sessão, então devolve undefined', () => {
    const text = transcript(JSON.stringify({ type: 'user', timestamp: at(1), message: { content: 'oi' } }));
    expect(readClaudeTranscriptActivity(text, CWD)).toBeUndefined();
  });

  it('o título vem do ai-title quando existe', () => {
    const activity = readClaudeTranscriptActivity(
      transcript(prompt(1, 'quero um painel'), rec({ type: 'ai-title', aiTitle: 'Painel de sessões' })),
      CWD,
    );
    expect(activity?.detail?.title).toBe('Painel de sessões');
  });

  it('sem ai-title, o título é o primeiro prompt cortado em 80 caracteres', () => {
    const activity = readClaudeTranscriptActivity(transcript(prompt(1, 'a'.repeat(120))), CWD);
    expect(activity?.detail?.title).toBe('a'.repeat(80));
  });

  it('o primeiro prompt é cortado em 2 000 caracteres', () => {
    const activity = readClaudeTranscriptActivity(transcript(prompt(1, 'b'.repeat(2500))), CWD);
    expect(activity?.detail?.firstPrompt).toBe('b'.repeat(2000));
  });

  it('o modelo é o da última resposta do canal principal', () => {
    const activity = readClaudeTranscriptActivity(
      transcript(prompt(1, 'oi'), reply(2, 'olá')),
      CWD,
    );
    expect(activity?.detail?.model).toBe('claude-sonnet-5-5');
  });

  it('subagentes são os agentId distintos das linhas laterais; sem elas, zero', () => {
    const sidechain = (minute: number, agentId: string) =>
      reply(minute, 'trabalho do subagente', { isSidechain: true, agentId });
    const withAgents = readClaudeTranscriptActivity(
      transcript(prompt(1, 'oi'), sidechain(2, 'a1'), sidechain(3, 'a1'), sidechain(4, 'a2')),
      CWD,
    );
    expect(withAgents?.detail?.subagents).toBe(2);
    const without = readClaudeTranscriptActivity(transcript(prompt(1, 'oi'), reply(2, 'olá')), CWD);
    expect(without?.detail?.subagents).toBe(0);
  });

  it('o último texto do agente ignora o canal lateral e é cortado em 400 caracteres', () => {
    const activity = readClaudeTranscriptActivity(
      transcript(
        prompt(1, 'oi'),
        reply(2, 'c'.repeat(500)),
        reply(3, 'do subagente', { isSidechain: true, agentId: 'a1' }),
      ),
      CWD,
    );
    expect(activity?.detail?.lastAgentText).toBe('c'.repeat(400));
  });

  it('os últimos 4 turnos vêm em ordem, cada um cortado em 600 caracteres', () => {
    const activity = readClaudeTranscriptActivity(
      transcript(
        prompt(1, 'um'),
        reply(2, 'dois'),
        prompt(3, 'três'),
        reply(4, 'quatro'),
        prompt(5, 'cinco'),
        reply(6, 'x'.repeat(700)),
      ),
      CWD,
    );
    expect(activity?.detail?.lastTurns).toEqual([
      { role: 'user', text: 'três' },
      { role: 'agent', text: 'quatro' },
      { role: 'user', text: 'cinco' },
      { role: 'agent', text: 'x'.repeat(600) },
    ]);
  });

  it('o texto com HTML chega como texto, sem alteração', () => {
    const html = '<img src=x onerror=alert(1)>';
    const activity = readClaudeTranscriptActivity(transcript(prompt(1, html)), CWD);
    expect(activity?.detail?.firstPrompt).toBe(html);
  });

  it('a última linha pela metade não entra e as anteriores seguem', () => {
    const full = transcript(prompt(1, 'primeiro'), reply(2, 'resposta'));
    const cut = full + '{"type":"user","timestamp":"2026-10-30T12:';
    const activity = readClaudeTranscriptActivity(cut, CWD);
    expect(activity?.detail?.firstPrompt).toBe('primeiro');
    expect(activity?.detail?.lastAgentText).toBe('resposta');
  });
});
