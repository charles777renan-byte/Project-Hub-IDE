import { describe, expect, it } from 'vitest';
import type { MissionEventDto } from '@project-hub/contracts';
import {
  conversationEvents,
  primaryActionOf,
  statusTone,
  stepStatus,
  verificationSummary,
  type MissionStatus,
} from '../../src/renderer/mission-text';

/**
 * Cada estado mantém o seu sentido na cor: lima roda, violeta espera a pessoa, vermelho falhou,
 * laranja pausou, e o resto fica neutro (muted).
 */
describe('tom dos estados da missão', () => {
  const expected: Record<MissionStatus, ReturnType<typeof statusTone>> = {
    draft: 'muted',
    planned: 'violet',
    queued: 'muted',
    running: 'lime',
    waiting_approval: 'violet',
    waiting_input: 'violet',
    paused: 'orange',
    succeeded: 'muted',
    failed: 'red',
    cancelled: 'muted',
  };

  it.each(Object.entries(expected) as [MissionStatus, string][])('%s é %s', (status, tone) => {
    expect(statusTone(status)).toBe(tone);
  });
});

describe('tom dos estados das etapas', () => {
  it.each([
    ['pending', 'muted'],
    ['running', 'lime'],
    ['blocked', 'violet'],
    ['succeeded', 'muted'],
    ['failed', 'red'],
    ['skipped', 'muted'],
  ] as const)('%s é %s', (status, tone) => {
    expect(stepStatus(status).tone).toBe(tone);
  });
});

function event(overrides: Partial<MissionEventDto>): MissionEventDto {
  return {
    id: 'ev',
    missionId: 'm1',
    aggregateType: 'execution',
    aggregateId: 'e1',
    eventType: 'message.delta',
    severity: 'info',
    actor: 'agent',
    payload: {},
    sequence: 1,
    createdAt: '2026-10-20T09:00:00.000Z',
    ...overrides,
  };
}

describe('ação principal do resumo da missão', () => {
  it.each([
    ['draft', 'generate_plan'],
    ['planned', 'approve_plan'],
    ['queued', 'start'],
    // Esperando a decisão, o banner "Aguardando você" é o único convite: o resumo não tem ação principal.
    ['waiting_approval', undefined],
    ['waiting_input', undefined],
    ['paused', 'resume'],
    ['failed', 'retry'],
    ['cancelled', 'retry'],
    ['running', undefined],
    ['succeeded', undefined],
  ] as const)('%s tem %s', (status, action) => {
    expect(primaryActionOf(status)).toBe(action);
  });
});

describe('verificationSummary', () => {
  const run = (id: string, sequence: number, command: string, passed: number, failed: number) =>
    event({
      id,
      sequence,
      eventType: 'verification.completed',
      payload: { command, passed, failed, durationMs: 10 },
    });

  it('sem verificação nenhuma, nenhum teste rodou', () => {
    expect(verificationSummary([])).toEqual({ kind: 'none' });
    expect(verificationSummary([event({})])).toEqual({ kind: 'none' });
  });

  it('um payload malformado não conta como verificação', () => {
    const broken = event({ eventType: 'verification.completed', payload: { command: 'x' } });
    expect(verificationSummary([broken])).toEqual({ kind: 'none' });
  });

  it('comando que não contou teste algum é uma verificação vazia', () => {
    expect(verificationSummary([run('a', 1, 'pnpm test', 0, 0)])).toEqual({ kind: 'empty' });
  });

  it('vale a última rodada de cada comando, e as rodadas de comandos diferentes somam', () => {
    const summary = verificationSummary([
      run('b', 2, 'pnpm test', 9, 0),
      run('a', 1, 'pnpm test', 3, 2),
      run('c', 3, 'pnpm lint', 1, 1),
    ]);
    expect(summary).toEqual({ kind: 'ran', passed: 10, total: 11, failed: true });
  });

  it('sem falhas, não marca falha', () => {
    expect(verificationSummary([run('a', 1, 'pnpm test', 14, 0)])).toEqual({
      kind: 'ran',
      passed: 14,
      total: 14,
      failed: false,
    });
  });
});

describe('conversationEvents', () => {
  it('mantém a história da missão e deixa o detalhe técnico para os Logs', () => {
    const types = [
      'mission.created',
      'plan.generated',
      'mission.status_changed',
      'message.delta',
      'input.requested',
      'input.provided',
      'approval.requested',
      'approval.decided',
      'approval.expired',
      'session.completed',
      'execution.interrupted',
      'worktree.created',
      'execution.started',
      'session.started',
      'tool.requested',
      'tool.completed',
      'verification.completed',
      'usage.updated',
    ];
    const kept = conversationEvents(
      types.map((eventType, index) => event({ id: eventType, eventType, sequence: index })),
    ).map((item) => item.eventType);

    expect(kept).toEqual(types.slice(0, 11));
  });
});
