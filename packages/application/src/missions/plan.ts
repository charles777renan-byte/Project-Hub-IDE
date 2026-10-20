/** Passo do plano: posição a partir de 1, e o título é o critério de aceite. */
export type MissionPlanStep = { position: number; title: string };

/**
 * Plano da missão: um passo por critério, na ordem dos critérios. O MVP executa as etapas em
 * sequência (seção 15.3), então a ordem é a da lista.
 */
export function planFromCriteria(criteria: readonly string[]): { steps: MissionPlanStep[] } {
  return { steps: criteria.map((title, index) => ({ position: index + 1, title })) };
}
