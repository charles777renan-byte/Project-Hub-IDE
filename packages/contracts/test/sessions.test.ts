import { describe, expect, it } from 'vitest';
import {
  CHANNELS,
  sessionsListInputSchema,
  sessionSummarySchema,
  sessionsResumeInputSchema,
} from '../src';

const UUID = '3f2b8c1e-9a4d-4e7b-8c2a-1d5e6f7a8b9c';

describe('sessionsResumeInputSchema', () => {
  it('aceita um UUID minúsculo', () => {
    const result = sessionsResumeInputSchema.safeParse({ workspaceId: 'w1', sessionId: UUID });
    expect(result.success).toBe(true);
  });

  it.each([
    ['barra', '3f2b8c1e/9a4d-4e7b-8c2a-1d5e6f7a8b9c'],
    ['espaço', '3f2b8c1e 9a4d-4e7b-8c2a-1d5e6f7a8b9c'],
    ['ponto-ponto', '..'],
    ['vazio', ''],
    ['maiúsculas', UUID.toUpperCase()],
  ])('recusa sessionId com %s', (_label, sessionId) => {
    const result = sessionsResumeInputSchema.safeParse({ workspaceId: 'w1', sessionId });
    expect(result.success).toBe(false);
  });
});

describe('sessionsListInputSchema', () => {
  it('aceita os três escopos', () => {
    for (const scope of ['workspace', 'project', 'all'] as const) {
      expect(sessionsListInputSchema.safeParse({ scope, projectId: 'p1' }).success).toBe(true);
    }
  });

  it('recusa escopo desconhecido', () => {
    expect(sessionsListInputSchema.safeParse({ scope: 'tudo' }).success).toBe(false);
  });
});

function summary(overrides: Record<string, unknown>) {
  return {
    id: UUID,
    provider: 'claude',
    title: null,
    folder: 'C:/projeto',
    projectId: 'p1',
    branch: null,
    isWorktree: false,
    startedAt: '2026-11-07T10:00:00.000Z',
    lastActivityAt: '2026-11-07T10:05:00.000Z',
    messages: 3,
    subagents: null,
    model: null,
    firstPrompt: null,
    lastAgentText: null,
    lastTurns: null,
    resumable: true,
    resumeBlockedReason: null,
    ...overrides,
  };
}

describe('SessionSummary: limites de texto', () => {
  it('firstPrompt aceita 2 000 caracteres e recusa 2 001', () => {
    expect(sessionSummarySchema.safeParse(summary({ firstPrompt: 'a'.repeat(2000) })).success).toBe(true);
    expect(sessionSummarySchema.safeParse(summary({ firstPrompt: 'a'.repeat(2001) })).success).toBe(false);
  });

  it('lastAgentText aceita 400 caracteres e recusa 401', () => {
    expect(sessionSummarySchema.safeParse(summary({ lastAgentText: 'a'.repeat(400) })).success).toBe(true);
    expect(sessionSummarySchema.safeParse(summary({ lastAgentText: 'a'.repeat(401) })).success).toBe(false);
  });

  it('cada turno aceita 600 caracteres e recusa 601', () => {
    const turn = (text: string) => [{ role: 'user', text }];
    expect(sessionSummarySchema.safeParse(summary({ lastTurns: turn('a'.repeat(600)) })).success).toBe(true);
    expect(sessionSummarySchema.safeParse(summary({ lastTurns: turn('a'.repeat(601)) })).success).toBe(false);
  });
});

describe('CHANNELS das sessões', () => {
  it('tem os dois canais novos com os nomes do plano', () => {
    expect(CHANNELS.sessionsList).toBe('sessions:list:v1');
    expect(CHANNELS.sessionsResume).toBe('sessions:resume:v1');
  });
});
