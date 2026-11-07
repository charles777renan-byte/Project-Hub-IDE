import { describe, expect, it } from 'vitest';
import { DETAIL_LIMITS, cutText } from '../src/session-text';

describe('DETAIL_LIMITS', () => {
  it('tem os limites do detalhe de sessão fixados pelo contrato', () => {
    expect(DETAIL_LIMITS).toEqual({
      title: 200,
      titleFromPrompt: 80,
      firstPrompt: 2000,
      lastAgentText: 400,
      turn: 600,
      lastTurns: 4,
    });
  });
});

describe('cutText', () => {
  it('corta em no máximo o número de unidades de código, sem reticências', () => {
    expect(cutText('abcdef', 4)).toBe('abcd');
    expect(cutText('abc', 4)).toBe('abc');
  });

  it('não deixa um par substituto partido no fim do corte', () => {
    // O emoji ocupa duas unidades de código: cortar em 3 separaria o par.
    expect(cutText('ab\u{1F600}', 3)).toBe('ab');
  });
});
