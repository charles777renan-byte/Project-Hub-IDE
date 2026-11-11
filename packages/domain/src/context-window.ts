import type { MessageUsage } from './usage';

/**
 * O que a resposta principal mais recente de um agente deixou na janela de contexto: o id do modelo que
 * respondeu e os tokens ocupados. Sobe e desce (um `/compact` derruba), ao contrário do gasto, que só soma.
 * O tamanho da janela não vem aqui: sai de `contextWindowOf(model)` na hora de mostrar.
 */
export type ContextUsage = { model: string; usedTokens: number };

/**
 * Tamanho máximo do nome de um modelo. O nome vem do transcript, que é um arquivo: um valor maior que isto não é um
 * id de modelo, e não segue para o banco nem para a tela. O contrato do terminal usa o mesmo número.
 */
export const MODEL_NAME_MAX_LENGTH = 100;

/** Janela de contexto de um modelo fora da tabela, em tokens. */
export const DEFAULT_CONTEXT_WINDOW = 200_000;

const ONE_MILLION = 1_000_000;

/**
 * Janela de contexto por modelo, em tokens, conferida em 2026-11-08 em
 * https://platform.claude.com/docs/en/build-with-claude/context-windows (seção "Context window sizes
 * by model": 1M por padrão, sem cabeçalho beta, nos modelos abaixo; os demais, como o Sonnet 4.5, têm
 * 200 mil). Só entram os modelos de 1M, na ordem das famílias de `MODEL_PRICES`; o que não está aqui
 * usa `DEFAULT_CONTEXT_WINDOW`.
 *
 * Limitação aceita: o transcript traz o id do modelo, mas não diz o tamanho da janela da sessão. Esta
 * tabela é a janela que a API dá ao modelo; uma sessão do Claude Code com janela menor mostra uma
 * porcentagem abaixo da real, e uma sessão de 1M num modelo fora da tabela mostra uma acima da real.
 */
export const CONTEXT_WINDOWS: Readonly<Record<string, number>> = {
  'claude-fable-5-1': ONE_MILLION,
  'claude-mythos-5-1': ONE_MILLION,
  'claude-fable-5': ONE_MILLION,
  'claude-mythos-5': ONE_MILLION,
  'claude-opus-5-5': ONE_MILLION,
  'claude-opus-5': ONE_MILLION,
  'claude-opus-4-8': ONE_MILLION,
  'claude-opus-4-7': ONE_MILLION,
  'claude-opus-4-6': ONE_MILLION,
  'claude-sonnet-5-5': ONE_MILLION,
  'claude-sonnet-5': ONE_MILLION,
  'claude-sonnet-4-6': ONE_MILLION,
  'claude-haiku-5-5': ONE_MILLION,
};

/** Janela de contexto do modelo; id com sufixo de data (`-20250929`) vale como o id sem ele. */
export function contextWindowOf(model: string): number {
  return CONTEXT_WINDOWS[model.replace(/-\d{8}$/, '')] ?? DEFAULT_CONTEXT_WINDOW;
}

/**
 * Tokens que a resposta deixa ocupando a janela: entrada nova, cache lido e cache escrito (5 minutos e
 * 1 hora). A saída não entra.
 */
export function contextTokensOf(
  usage: Pick<
    MessageUsage,
    'inputTokens' | 'cacheReadInputTokens' | 'cacheWrite5mInputTokens' | 'cacheWrite1hInputTokens'
  >,
): number {
  return (
    usage.inputTokens +
    usage.cacheReadInputTokens +
    usage.cacheWrite5mInputTokens +
    usage.cacheWrite1hInputTokens
  );
}
