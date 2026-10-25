import { describe, expect, it } from 'vitest';
import { canTransition, MISSION_STATUSES, type MissionStatus } from '../src/index';

/**
 * Arestas da seção 9.3 do planejamento, uma por par (origem, destino). Os dois últimos grupos são
 * a decisão da Tarefa 9: cancelar de qualquer estado não terminal, e a nova tentativa a partir de
 * `failed` e `cancelled`, que volta para `queued` (ADR 0007).
 */
const ALLOWED: ReadonlyArray<readonly [MissionStatus, MissionStatus]> = [
  ['draft', 'planned'],
  ['planned', 'queued'],
  ['queued', 'running'],
  ['running', 'waiting_approval'],
  ['running', 'waiting_input'],
  ['running', 'paused'],
  ['running', 'review'],
  ['running', 'failed'],
  ['review', 'succeeded'],
  ['review', 'queued'],
  ['review', 'cancelled'],
  ['waiting_approval', 'running'],
  ['waiting_input', 'running'],
  ['paused', 'running'],
  ['draft', 'cancelled'],
  ['planned', 'cancelled'],
  ['queued', 'cancelled'],
  ['running', 'cancelled'],
  ['waiting_approval', 'cancelled'],
  ['waiting_input', 'cancelled'],
  ['paused', 'cancelled'],
  ['failed', 'queued'],
  ['cancelled', 'queued'],
];

describe('canTransition', () => {
  it('transições válidas são permitidas', () => {
    expect(canTransition('draft', 'planned')).toBe(true);
    expect(canTransition('running', 'waiting_approval')).toBe(true);
  });

  it('o agente que termina leva a missão a review, e só a pessoa a leva a succeeded', () => {
    expect(canTransition('running', 'succeeded')).toBe(false);
    expect(canTransition('running', 'review')).toBe(true);
    expect(canTransition('review', 'succeeded')).toBe(true);
  });

  it('revisão não volta a running direto: o pedido de ajuste abre nova tentativa pela fila', () => {
    expect(canTransition('review', 'running')).toBe(false);
    expect(canTransition('review', 'queued')).toBe(true);
  });

  it('estado terminal não volta a running', () => {
    expect(canTransition('succeeded', 'running')).toBe(false);
  });

  it('qualquer estado não terminal pode ser cancelado', () => {
    expect(canTransition('paused', 'cancelled')).toBe(true);
  });

  it('segue a tabela da seção 9.3, par a par, nos dez estados', () => {
    expect(MISSION_STATUSES).toHaveLength(11);
    for (const from of MISSION_STATUSES) {
      for (const to of MISSION_STATUSES) {
        const expected = ALLOWED.some(([a, b]) => a === from && b === to);
        expect(canTransition(from, to), `${from} -> ${to}`).toBe(expected);
      }
    }
  });

  it('recusa sair de succeeded para qualquer estado', () => {
    for (const to of MISSION_STATUSES) {
      expect(canTransition('succeeded', to), `succeeded -> ${to}`).toBe(false);
    }
  });
});
