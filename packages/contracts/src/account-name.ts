// Sem dependências: o renderer importa este arquivo direto, sem puxar o zod dos esquemas para o bundle
// (o zod sonda `Function('')` ao carregar, e a CSP do renderer reporta isso como violação).

/** O tamanho máximo do nome de uma conta. */
export const ACCOUNT_NAME_MAX = 40;
