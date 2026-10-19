import { CHANNELS, type AppResult, type ProjectHubApi } from '@project-hub/contracts';

/** Chamada ao processo principal. No preload, é `ipcRenderer.invoke`. */
export type Invoke = (channel: string, payload?: unknown) => Promise<unknown>;

/**
 * Monta a API que o preload expõe ao renderer. É uma função pura: cada método chama um canal fixo
 * de `CHANNELS`, e o renderer nunca escolhe o canal nem recebe `invoke` (seção 13.4).
 */
export function buildProjectHubApi(invoke: Invoke): ProjectHubApi {
  return {
    // O processo principal responde no formato AppResult; a resposta ainda não passa por schema.
    ping: () => invoke(CHANNELS.appPing) as Promise<AppResult<string>>,
  };
}
