import type { WebPreferences } from 'electron';

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
