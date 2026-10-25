// Sem dependências: o renderer importa este arquivo direto, sem puxar o zod dos esquemas para o bundle
// (o zod sonda `Function('')` ao carregar, e a CSP do renderer reporta isso como violação).

/** Janela fixa da atividade na tela Início: os últimos 90 dias, contando o dia de hoje. */
export const ACTIVITY_WINDOW_DAYS = 90;
