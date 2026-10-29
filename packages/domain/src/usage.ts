import type { UsageSummary } from './mission';

/** Uso de uma resposta do modelo, como o transcript do agente a grava. */
export type MessageUsage = {
  /** Id do modelo da resposta (`claude-sonnet-5-5`, por exemplo). */
  model: string;
  inputTokens: number;
  outputTokens: number;
  cacheReadInputTokens: number;
  cacheWrite5mInputTokens: number;
  cacheWrite1hInputTokens: number;
  /** `fast` quando a resposta veio do modo rápido. */
  speed?: string;
  /** `us` quando a inferência ficou presa aos Estados Unidos (10% a mais). */
  inferenceGeo?: string;
};

/** Preço de um modelo, em US$ por milhão de tokens. */
type ModelPrice = {
  input: number;
  output: number;
  /** Fração do preço de entrada cobrada na leitura de cache. */
  cacheReadFactor: number;
  /** Preço do modo rápido. Sem ele, o modelo não tem modo rápido. */
  fast?: { input: number; output: number };
  /** Preço maior para pedido com entrada (contando o cache) acima do limite. */
  longContext?: { aboveTokens: number; input: number; output: number };
};

/** Escrita de cache: 1,25 vez a entrada para 5 minutos, 2 vezes para 1 hora. */
const CACHE_WRITE_5M_FACTOR = 1.25;
const CACHE_WRITE_1H_FACTOR = 2;
const US_INFERENCE_FACTOR = 1.1;
const PER_TOKEN = 1 / 1_000_000;

/**
 * Tabela de preços de lista da API, conferida em 2026-10-28 em
 * https://platform.claude.com/docs/en/about-claude/pricing. A conta confere com o `costUSD` que o
 * Claude Code 2.1.312 informa (`apps/desktop/test/fixtures/claude-plan-output.json`). Modelo novo fica
 * sem preço até entrar aqui.
 */
export const MODEL_PRICES: Readonly<Record<string, ModelPrice>> = {
  'claude-fable-5-1': { input: 10, output: 50, cacheReadFactor: 0.025 },
  'claude-mythos-5-1': { input: 10, output: 50, cacheReadFactor: 0.025 },
  'claude-fable-5': { input: 10, output: 50, cacheReadFactor: 0.1 },
  'claude-mythos-5': { input: 10, output: 50, cacheReadFactor: 0.1 },
  'claude-opus-5-5': {
    input: 4,
    output: 20,
    cacheReadFactor: 0.05,
    fast: { input: 8, output: 40 },
  },
  'claude-opus-5': { input: 5, output: 25, cacheReadFactor: 0.1, fast: { input: 10, output: 50 } },
  'claude-opus-4-8': {
    input: 5,
    output: 25,
    cacheReadFactor: 0.1,
    fast: { input: 10, output: 50 },
  },
  'claude-opus-4-7': { input: 5, output: 25, cacheReadFactor: 0.1 },
  'claude-opus-4-6': { input: 5, output: 25, cacheReadFactor: 0.1 },
  'claude-opus-4-5': { input: 5, output: 25, cacheReadFactor: 0.1 },
  'claude-opus-4-1': { input: 15, output: 75, cacheReadFactor: 0.1 },
  'claude-opus-4': { input: 15, output: 75, cacheReadFactor: 0.1 },
  'claude-sonnet-5-5': { input: 2, output: 10, cacheReadFactor: 0.05 },
  'claude-sonnet-5': { input: 2, output: 10, cacheReadFactor: 0.1 },
  'claude-sonnet-4-6': { input: 3, output: 15, cacheReadFactor: 0.1 },
  'claude-sonnet-4-5': { input: 3, output: 15, cacheReadFactor: 0.1 },
  'claude-sonnet-4': { input: 3, output: 15, cacheReadFactor: 0.1 },
  'claude-haiku-5-5': {
    input: 0.1,
    output: 0.5,
    cacheReadFactor: 0.1,
    longContext: { aboveTokens: 100_000, input: 0.5, output: 2.5 },
  },
  'claude-haiku-4-5': { input: 1, output: 5, cacheReadFactor: 0.1 },
  'claude-3-5-haiku': { input: 0.8, output: 4, cacheReadFactor: 0.1 },
};

/** Tira o sufixo de data do id (`claude-sonnet-4-5-20250929` vira `claude-sonnet-4-5`). */
function priceKey(model: string): string {
  return model.replace(/-\d{8}$/, '');
}

function totalTokens(usage: MessageUsage): number {
  return (
    usage.inputTokens +
    usage.outputTokens +
    usage.cacheReadInputTokens +
    usage.cacheWrite5mInputTokens +
    usage.cacheWrite1hInputTokens
  );
}

/**
 * Custo estimado de uma resposta, em US$, a preço de lista. Resposta sem nenhum token custa zero, seja
 * qual for o modelo (o Claude Code grava respostas sintéticas assim). Modelo sem preço, ou modo rápido
 * num modelo que não o tem, devolve `undefined`: sem preço, não há estimativa.
 */
export function estimateMessageCostUsd(usage: MessageUsage): number | undefined {
  if (totalTokens(usage) === 0) return 0;
  const price = MODEL_PRICES[priceKey(usage.model)];
  if (price === undefined) return undefined;
  let input = price.input;
  let output = price.output;
  const prompt =
    usage.inputTokens +
    usage.cacheReadInputTokens +
    usage.cacheWrite5mInputTokens +
    usage.cacheWrite1hInputTokens;
  if (price.longContext !== undefined && prompt > price.longContext.aboveTokens) {
    input = price.longContext.input;
    output = price.longContext.output;
  }
  if (usage.speed === 'fast') {
    if (price.fast === undefined) return undefined;
    input = price.fast.input;
    output = price.fast.output;
  }
  const cost =
    (usage.inputTokens * input +
      usage.cacheWrite5mInputTokens * input * CACHE_WRITE_5M_FACTOR +
      usage.cacheWrite1hInputTokens * input * CACHE_WRITE_1H_FACTOR +
      usage.cacheReadInputTokens * input * price.cacheReadFactor +
      usage.outputTokens * output) *
    PER_TOKEN;
  return usage.inferenceGeo === 'us' ? cost * US_INFERENCE_FACTOR : cost;
}

/**
 * Soma as respostas num resumo. O custo só sai quando todas as respostas têm preço: um total parcial
 * pareceria completo.
 */
export function summarizeUsage(messages: Iterable<MessageUsage>): UsageSummary {
  const summary = {
    inputTokens: 0,
    outputTokens: 0,
    cacheReadInputTokens: 0,
    cacheWrite5mInputTokens: 0,
    cacheWrite1hInputTokens: 0,
  };
  let cost: number | undefined = 0;
  for (const message of messages) {
    summary.inputTokens += message.inputTokens;
    summary.outputTokens += message.outputTokens;
    summary.cacheReadInputTokens += message.cacheReadInputTokens;
    summary.cacheWrite5mInputTokens += message.cacheWrite5mInputTokens;
    summary.cacheWrite1hInputTokens += message.cacheWrite1hInputTokens;
    const messageCost = estimateMessageCostUsd(message);
    cost = cost === undefined || messageCost === undefined ? undefined : cost + messageCost;
  }
  return cost === undefined ? summary : { ...summary, estimatedCostUsd: cost };
}
