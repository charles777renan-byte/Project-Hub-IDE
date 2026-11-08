/*
 * Contexto de um terminal de agente, no cabeçalho do painel: quanto da janela de contexto a última resposta
 * ocupa, e o rótulo do modelo. Só números e o id do modelo chegam aqui (o texto da resposta nunca). Sem dado,
 * quem chama não mostra a barra, nunca um zero.
 */

const COUNT = new Intl.NumberFormat('pt-BR');

/** A partir de quantos por cento a barra de contexto passa de cinza a violeta. Nunca vermelho. */
export const CONTEXT_HIGH_FROM = 80;

type Context = { usedTokens: number; windowTokens: number };

/**
 * A porcentagem da janela ocupada, inteira de 0 a 100. Trunca (a barra nunca promete mais do que há) e tem teto
 * de 100 quando o uso passa da janela. Janela zero ou negativa devolve 0.
 */
export function contextPercent(context: Context): number {
  if (!(context.windowTokens > 0)) return 0;
  const percent = Math.floor((context.usedTokens / context.windowTokens) * 100);
  return Math.min(100, Math.max(0, percent));
}

/** O nível da barra: `high` de `CONTEXT_HIGH_FROM` por cento em diante, `normal` abaixo. */
export function contextLevel(percent: number): 'normal' | 'high' {
  return percent >= CONTEXT_HIGH_FROM ? 'high' : 'normal';
}

/** O detalhe da dica e do leitor de tela: "Contexto: 76.000 de 200.000 tokens (38%)". */
export function contextDetailText(context: Context): string {
  return `Contexto: ${COUNT.format(context.usedTokens)} de ${COUNT.format(context.windowTokens)} tokens (${contextPercent(context)}%)`;
}

const MODEL_FAMILY = /^claude-(opus|sonnet|haiku|fable|mythos)(?:-|$)/;

/**
 * A família do modelo com inicial maiúscula ("Opus", "Sonnet"). Id que não reconhece devolve `undefined`, e
 * quem chama mostra o nome do programa no lugar.
 */
export function modelLabel(model: string): string | undefined {
  const family = MODEL_FAMILY.exec(model)?.[1];
  return family === undefined ? undefined : family.charAt(0).toUpperCase() + family.slice(1);
}
