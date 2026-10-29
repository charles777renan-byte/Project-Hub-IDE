import { describe, expect, it } from 'vitest';
import {
  estimateMessageCostUsd,
  summarizeUsage,
  type MessageUsage,
} from '../src/index';

function message(overrides: Partial<MessageUsage> = {}): MessageUsage {
  return {
    model: 'claude-sonnet-5-5',
    inputTokens: 0,
    outputTokens: 0,
    cacheReadInputTokens: 0,
    cacheWrite5mInputTokens: 0,
    cacheWrite1hInputTokens: 0,
    ...overrides,
  };
}

describe('estimateMessageCostUsd', () => {
  it('confere com o costUSD do Claude Code para o Sonnet 5.5 (fixture do planejador)', () => {
    // apps/desktop/test/fixtures/claude-plan-output.json, modelUsage.claude-sonnet-5-5.
    const cost = estimateMessageCostUsd(
      message({
        inputTokens: 4,
        outputTokens: 1475,
        cacheReadInputTokens: 60908,
        cacheWrite1hInputTokens: 61160,
      }),
    );
    expect(cost).toBeCloseTo(0.2654888, 9);
  });

  it('confere com o costUSD do Claude Code para o Haiku 5.5 (medido em 2026-10-28)', () => {
    const cost = estimateMessageCostUsd(
      message({
        model: 'claude-haiku-5-5',
        inputTokens: 2,
        outputTokens: 4,
        cacheWrite1hInputTokens: 45873,
      }),
    );
    expect(cost).toBeCloseTo(0.0091768, 9);
  });

  it('cobra a escrita de 5 minutos a 1,25 vez a entrada e a de 1 hora a 2 vezes', () => {
    const five = estimateMessageCostUsd(message({ cacheWrite5mInputTokens: 1_000_000 }));
    const hour = estimateMessageCostUsd(message({ cacheWrite1hInputTokens: 1_000_000 }));
    expect(five).toBeCloseTo(2.5, 9);
    expect(hour).toBeCloseTo(4, 9);
  });

  it('usa o preço de contexto longo do Haiku 5.5 acima de 100 mil tokens de entrada, contando o cache', () => {
    const below = estimateMessageCostUsd(
      message({ model: 'claude-haiku-5-5', inputTokens: 100_000, outputTokens: 1_000_000 }),
    );
    const above = estimateMessageCostUsd(
      message({
        model: 'claude-haiku-5-5',
        inputTokens: 1,
        cacheReadInputTokens: 100_000,
        outputTokens: 1_000_000,
      }),
    );
    expect(below).toBeCloseTo(0.01 + 0.5, 9);
    expect(above).toBeCloseTo((1 * 0.5 + 100_000 * 0.05) / 1_000_000 + 2.5, 9);
  });

  it('aplica o modo rápido e o adicional de inferência nos Estados Unidos', () => {
    const fast = estimateMessageCostUsd(
      message({ model: 'claude-opus-5-5', outputTokens: 1_000_000, speed: 'fast' }),
    );
    const us = estimateMessageCostUsd(message({ outputTokens: 1_000_000, inferenceGeo: 'us' }));
    expect(fast).toBeCloseTo(40, 9);
    expect(us).toBeCloseTo(11, 9);
  });

  it('aceita o id com data e recusa o modelo sem preço', () => {
    expect(
      estimateMessageCostUsd(message({ model: 'claude-sonnet-4-5-20250929', outputTokens: 1 })),
    ).toBeCloseTo(15 / 1_000_000, 12);
    expect(estimateMessageCostUsd(message({ model: 'sonnet', outputTokens: 1 }))).toBeUndefined();
    expect(
      estimateMessageCostUsd(message({ model: 'claude-sonnet-5-5', outputTokens: 1, speed: 'fast' })),
    ).toBeUndefined();
  });

  it('dá zero para resposta sem tokens, mesmo de modelo sem preço', () => {
    expect(estimateMessageCostUsd(message({ model: '<synthetic>' }))).toBe(0);
  });
});

describe('summarizeUsage', () => {
  it('soma os campos e o custo', () => {
    const summary = summarizeUsage([
      message({ inputTokens: 1, outputTokens: 2, cacheReadInputTokens: 3 }),
      message({ inputTokens: 10, outputTokens: 20, cacheWrite5mInputTokens: 4 }),
    ]);
    expect(summary).toMatchObject({
      inputTokens: 11,
      outputTokens: 22,
      cacheReadInputTokens: 3,
      cacheWrite5mInputTokens: 4,
      cacheWrite1hInputTokens: 0,
    });
    expect(summary.estimatedCostUsd).toBeGreaterThan(0);
  });

  it('deixa o custo de fora quando uma resposta não tem preço', () => {
    const summary = summarizeUsage([
      message({ outputTokens: 2 }),
      message({ model: 'modelo-novo', outputTokens: 2 }),
    ]);
    expect(summary.outputTokens).toBe(4);
    expect(summary).not.toHaveProperty('estimatedCostUsd');
  });
});
