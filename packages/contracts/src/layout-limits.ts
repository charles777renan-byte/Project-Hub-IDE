// Sem dependências: o renderer importa este arquivo direto, sem puxar o zod dos esquemas para o bundle
// (o zod sonda `Function('')` ao carregar, e a CSP do renderer reporta isso como violação).
export const LAYOUT_LIMITS = {
  maxLeaves: 12,
  maxDepth: 6,
  /** A menor fração que um filho de uma divisão pode ter. */
  minSize: 0.02,
  /** Quanto a soma dos tamanhos de uma divisão pode se afastar de 1. */
  sizeTolerance: 0.01,
} as const;
