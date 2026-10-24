import { describe, expect, it } from 'vitest';
import {
  statusTone,
  stepStatus,
  verificationOutcome,
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

describe('resultado de uma verificação', () => {
  it('verificationOutcome devolve empty quando nenhum teste rodou', () => {
    expect(verificationOutcome({ passed: 0, failed: 0 })).toBe('empty');
    expect(verificationOutcome({ passed: 3, failed: 0 })).toBe('passed');
    expect(verificationOutcome({ passed: 3, failed: 1 })).toBe('failed');
    expect(verificationOutcome({ passed: 0, failed: 2 })).toBe('failed');
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
