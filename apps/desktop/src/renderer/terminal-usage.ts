import type { UsageSummaryDto } from '@project-hub/contracts';
import { formatTokens, formatUsd } from './mission-usage';

/*
 * Gasto de tokens de um terminal, no cabeçalho do painel (workspace/PaneUsage.tsx). O número em destaque é
 * só a saída (`outputTokens`), num formato curto; o detalhe (entrada nova, cache e custo estimado) vai na dica
 * e no texto para leitor de tela. Sem `usage` não há número: quem chama não mostra nada, nunca zero.
 */

const SHORT = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 1 });

/**
 * Contagem abreviada, com a vírgula decimal do Brasil: até 999, o número inteiro ("872"); de mil em diante, em
 * milhares com uma casa ("1k", "12,3k"); de um milhão em diante, em milhões ("1,2M"). A casa decimal é truncada,
 * não arredondada: o número nunca passa do gasto real. Casa decimal zero some ("1k").
 */
export function formatTokensShort(count: number): string {
  const whole = Math.max(0, Math.floor(count));
  if (whole < 1_000) return SHORT.format(whole);
  if (whole < 1_000_000) return `${SHORT.format(Math.floor(whole / 100) / 10)}k`;
  return `${SHORT.format(Math.floor(whole / 100_000) / 10)}M`;
}

/** Onde cada nível de uso começa, em tokens de saída. O nível 0 vai até o primeiro limite. */
export const USAGE_LEVEL_STARTS = [1_000, 5_000, 20_000, 60_000, 150_000] as const;

/**
 * O nível de uso de um terminal, de 0 (pouco) a `USAGE_LEVEL_STARTS.length` (muito), pela saída. A tela pinta a
 * pílula numa rampa do frio ao quente conforme o nível (app.css, `data-level`).
 */
export function usageLevel(outputTokens: number): number {
  return USAGE_LEVEL_STARTS.filter((start) => outputTokens >= start).length;
}

/**
 * O texto visível do indicador: a saída no formato curto mais a palavra "tokens" (a palavra, e não um glifo
 * como "↓", porque diz sozinha o que o número conta e não depende de legenda).
 */
export function usageIndicatorText(usage: UsageSummaryDto): string {
  return `${formatTokensShort(usage.outputTokens)} ${usage.outputTokens === 1 ? 'token' : 'tokens'}`;
}

/**
 * O detalhe da dica e do leitor de tela: "Saída: N tokens · Entrada nova: N · Cache: N lidos, N escritos ·
 * Custo …". Cache escrito soma as escritas de 5 min e de 1 h; um uso antigo, sem os campos de cache, mostra
 * zero só aqui, no detalhe. O custo é estimativa a preço de lista da API e falta quando algum modelo não tem
 * preço.
 */
export function usageDetailText(usage: UsageSummaryDto): string {
  const cacheRead = usage.cacheReadInputTokens ?? 0;
  const cacheWrite = (usage.cacheWrite5mInputTokens ?? 0) + (usage.cacheWrite1hInputTokens ?? 0);
  const cost =
    usage.estimatedCostUsd === undefined
      ? 'Custo estimado indisponível'
      : `Custo estimado a preço de lista da API: ${formatUsd(usage.estimatedCostUsd)} (não é fatura)`;
  return [
    `Saída: ${formatTokens(usage.outputTokens)} tokens`,
    `Entrada nova: ${formatTokens(usage.inputTokens)}`,
    `Cache: ${formatTokens(cacheRead)} lidos, ${formatTokens(cacheWrite)} escritos`,
    cost,
  ].join(' · ');
}
