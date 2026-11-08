/**
 * Limites dos textos de detalhe de uma sessão. São os mesmos de `packages/contracts/src/sessions.ts`
 * (`SESSION_*`): este pacote não depende do contrato, então os números ficam repetidos aqui. O teste
 * `test/session-text.test.ts` fixa os valores; quem mudar um limite no contrato muda aqui também.
 */
export const DETAIL_LIMITS = {
  title: 200,
  titleFromPrompt: 80,
  firstPrompt: 2000,
  lastAgentText: 400,
  turn: 600,
  lastTurns: 4,
} as const;

/**
 * Corta o texto em no máximo `max` unidades de código, sem partir um par substituto (emoji fora do BMP).
 * Não põe reticências: o texto cortado é o que o renderer mostra, e ele não sabe que houve corte.
 */
export function cutText(text: string, max: number): string {
  const cut = text.slice(0, max);
  return /[\uD800-\uDBFF]$/.test(cut) ? cut.slice(0, -1) : cut;
}
