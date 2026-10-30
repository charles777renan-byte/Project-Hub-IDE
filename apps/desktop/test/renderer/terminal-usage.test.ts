import type { UsageSummaryDto } from '@project-hub/contracts';
import { describe, expect, it } from 'vitest';
import {
  USAGE_LEVEL_STARTS,
  formatTokensShort,
  usageDetailText,
  usageIndicatorText,
  usageLevel,
} from '../../src/renderer/terminal-usage';

/** O Intl do Brasil separa o código da moeda do valor com um espaço sem quebra; o teste compara com espaço comum. */
function plain(text: string): string {
  return text.replaceAll(String.fromCharCode(0xa0), ' ');
}

describe('formatTokensShort', () => {
  it.each([
    [0, '0'],
    [1, '1'],
    [872, '872'],
    [999, '999'],
    [1_000, '1k'],
    [1_234, '1,2k'],
    [12_345, '12,3k'],
    [999_999, '999,9k'],
    [1_000_000, '1M'],
    [1_234_567, '1,2M'],
  ])('%d vira "%s"', (count, expected) => {
    expect(formatTokensShort(count)).toBe(expected);
  });

  it('trunca a casa decimal em vez de arredondar: o número nunca passa do gasto real', () => {
    expect(formatTokensShort(1_999)).toBe('1,9k');
    expect(formatTokensShort(1_999_999)).toBe('1,9M');
    expect(formatTokensShort(1_299_999)).toBe('1,2M');
  });

  it('acima de mil milhões, os milhões ganham o separador de milhar', () => {
    expect(formatTokensShort(1_234_567_890)).toBe('1.234,5M');
  });
});

describe('usageLevel', () => {
  it('sobe um nível em cada limite, de 0 a ' + USAGE_LEVEL_STARTS.length, () => {
    expect(usageLevel(0)).toBe(0);
    USAGE_LEVEL_STARTS.forEach((start, index) => {
      expect(usageLevel(start - 1), `logo antes de ${start}`).toBe(index);
      expect(usageLevel(start), `em ${start}`).toBe(index + 1);
    });
    expect(usageLevel(10_000_000)).toBe(USAGE_LEVEL_STARTS.length);
  });

  it('os limites são crescentes', () => {
    expect([...USAGE_LEVEL_STARTS]).toEqual([...USAGE_LEVEL_STARTS].sort((a, b) => a - b));
  });
});

describe('usageIndicatorText', () => {
  it('é a saída no formato curto mais a palavra tokens', () => {
    expect(usageIndicatorText({ inputTokens: 5, outputTokens: 12_345 })).toBe('12,3k tokens');
    expect(usageIndicatorText({ inputTokens: 5, outputTokens: 0 })).toBe('0 tokens');
  });

  it('usa o singular para um token', () => {
    expect(usageIndicatorText({ inputTokens: 5, outputTokens: 1 })).toBe('1 token');
  });

  it('não depende da entrada nem do cache, só da saída', () => {
    const usage: UsageSummaryDto = {
      inputTokens: 9_000_000,
      outputTokens: 872,
      cacheReadInputTokens: 5_000_000,
    };
    expect(usageIndicatorText(usage)).toBe('872 tokens');
  });
});

describe('usageDetailText', () => {
  it('com custo: saída, entrada nova, cache lido e escrito (5 min + 1 h) e o custo estimado', () => {
    const usage: UsageSummaryDto = {
      inputTokens: 1_234,
      outputTokens: 12_345,
      cacheReadInputTokens: 456_789,
      cacheWrite5mInputTokens: 1_000,
      cacheWrite1hInputTokens: 234,
      estimatedCostUsd: 1.5,
    };
    expect(plain(usageDetailText(usage))).toBe(
      'Saída: 12.345 tokens · Entrada nova: 1.234 · Cache: 456.789 lidos, 1.234 escritos · ' +
        'Custo estimado a preço de lista da API: USD 1,50 (não é fatura)',
    );
  });

  it('sem custo, diz que a estimativa está indisponível', () => {
    const usage: UsageSummaryDto = {
      inputTokens: 10,
      outputTokens: 872,
      cacheReadInputTokens: 2_000,
      cacheWrite5mInputTokens: 30,
    };
    expect(usageDetailText(usage)).toBe(
      'Saída: 872 tokens · Entrada nova: 10 · Cache: 2.000 lidos, 30 escritos · ' +
        'Custo estimado indisponível',
    );
  });

  it('um uso antigo, sem os campos de cache, mostra o cache como zero só no detalhe', () => {
    expect(usageDetailText({ inputTokens: 100, outputTokens: 20 })).toBe(
      'Saída: 20 tokens · Entrada nova: 100 · Cache: 0 lidos, 0 escritos · Custo estimado indisponível',
    );
  });

  it('custo zero informado é custo, e abaixo de um centavo diz isso', () => {
    expect(
      plain(usageDetailText({ inputTokens: 1, outputTokens: 1, estimatedCostUsd: 0 })),
    ).toContain('Custo estimado a preço de lista da API: USD 0,00 (não é fatura)');
    expect(
      plain(usageDetailText({ inputTokens: 1, outputTokens: 1, estimatedCostUsd: 0.001 })),
    ).toContain('Custo estimado a preço de lista da API: menos de USD 0,01 (não é fatura)');
  });
});
