import type { WebPreferences } from 'electron';

/**
 * Barra de título do Windows com a cor do app: some a faixa cinza do sistema, e os botões de janela
 * (minimizar, maximizar, fechar) ficam por cima do cabeçalho. A cor é o `--bg` de tokens.css. A
 * altura é a do `.app-header` (50px) menos a linha de baixo de 1px, que a barra não pode cobrir.
 * Os testes em window.test.ts conferem as duas coisas.
 */
export const TITLE_BAR_OVERLAY = { color: '#080614', symbolColor: '#b7adcf', height: 49 } as const;

/**
 * Preferências do renderer (seção 24.4 e ADR 0001): sem Node.js, com contexto isolado, sandbox e
 * política de mesma origem. O renderer só alcança o processo principal pela API do preload.
 */
export function buildWebPreferences(preloadPath: string): WebPreferences {
  return {
    preload: preloadPath,
    nodeIntegration: false,
    contextIsolation: true,
    sandbox: true,
    webSecurity: true,
  };
}
