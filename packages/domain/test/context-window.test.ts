import { describe, expect, it } from 'vitest';
import { DEFAULT_CONTEXT_WINDOW, contextTokensOf, contextWindowOf } from '../src/index';

describe('contextWindowOf', () => {
  it('devolve um inteiro positivo para um modelo conhecido', () => {
    const window = contextWindowOf('claude-sonnet-5-5');
    expect(Number.isInteger(window)).toBe(true);
    expect(window).toBeGreaterThan(0);
  });

  it('usa a janela padrão para modelo desconhecido e para texto vazio', () => {
    expect(contextWindowOf('modelo-x')).toBe(DEFAULT_CONTEXT_WINDOW);
    expect(contextWindowOf('')).toBe(DEFAULT_CONTEXT_WINDOW);
  });

  it('resolve o id com sufixo de data como o id sem data', () => {
    expect(contextWindowOf('claude-sonnet-4-5-20250929')).toBe(
      contextWindowOf('claude-sonnet-4-5'),
    );
    expect(contextWindowOf('claude-sonnet-5-5-20261101')).toBe(
      contextWindowOf('claude-sonnet-5-5'),
    );
  });
});

describe('contextTokensOf', () => {
  it('soma entrada, cache lido e cache escrito de 5 minutos e de 1 hora, sem a saída', () => {
    expect(
      contextTokensOf({
        inputTokens: 10,
        cacheReadInputTokens: 100,
        cacheWrite5mInputTokens: 5,
        cacheWrite1hInputTokens: 1,
      }),
    ).toBe(116);
  });
});
