// Sem dependências: o renderer importa este arquivo direto, sem puxar o zod dos esquemas para o bundle
// (o zod sonda `Function('')` ao carregar, e a CSP do renderer reporta isso como violação).
export const LAYOUT_LIMITS = {
  maxLeaves: 12,
  maxDepth: 6,
  minRatio: 0.1,
  maxRatio: 0.9,
} as const;
