import type { UsageSummaryDto } from '@project-hub/contracts';
import { formatTokens, formatUsd } from './mission-usage';

/*
 * Gasto de tokens de um terminal, no cabeçalho do painel (workspace/PaneUsage.tsx). O número em destaque é
 * só a saída (`outputTokens`), num formato curto; o detalhe (entrada nova, cache e custo estimado) vai na dica
 * e no texto para leitor de tela. Sem `usage` não há número: quem chama não mostra nada, nunca zero.
 */

const SHORT = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 1 });

/**
 * Contagem curta no formato do Brasil: até 999.999, o número inteiro com o separador de milhar ("872",
 * "12.345"), para que cada token novo apareça enquanto o contador sobe; de um milhão em diante, em milhões com
 * uma casa ("1,2 mi"). A casa decimal é truncada, não arredondada: o número nunca passa do gasto real. Casa
 * decimal zero some ("1 mi").
 */
export function formatTokensShort(count: number): string {
  const whole = Math.max(0, Math.floor(count));
  if (whole < 1_000_000) return SHORT.format(whole);
  return `${SHORT.format(Math.floor(whole / 100_000) / 10)} mi`;
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
