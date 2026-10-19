import type { AppResult } from './result';

/**
 * API que o preload expõe ao renderer em `window.projectHub` (seção 13.3).
 * Cada método chama um canal fixo de `CHANNELS`; não existe envio genérico (seção 13.4).
 */
export type ProjectHubApi = {
  /** Confere que o processo principal responde. Devolve `'pong'`. */
  ping(): Promise<AppResult<string>>;
};
