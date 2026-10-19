import {
  CHANNELS,
  responseSchemas,
  type AddProjectInput,
  type AppResult,
  type ProjectHubApi,
  type ProjectSummary,
} from '@project-hub/contracts';

/** Chamada ao processo principal. No preload, é `ipcRenderer.invoke`. */
export type Invoke = (channel: string, payload?: unknown) => Promise<unknown>;

type ResponseChannel = keyof typeof responseSchemas;

function invalidResponse(): AppResult<never> {
  return {
    ok: false,
    error: {
      code: 'VALIDATION_FAILED',
      message: 'O processo principal devolveu uma resposta fora do contrato.',
      retryable: false,
    },
  };
}

/**
 * Chama um canal e confere a resposta com o schema dele (seção 13.1 e R28). A resposta que não bate
 * vira VALIDATION_FAILED, e o renderer não recebe o dado inesperado.
 */
async function invokeChannel<T>(
  invoke: Invoke,
  channel: ResponseChannel,
  payload?: unknown,
): Promise<AppResult<T>> {
  const response = await invoke(channel, payload);
  return responseSchemas[channel].safeParse(response).success
    ? (response as AppResult<T>)
    : invalidResponse();
}

/**
 * Monta a API que o preload expõe ao renderer. É uma função pura: cada método chama um canal fixo
 * de `CHANNELS`, e o renderer nunca escolhe o canal nem recebe `invoke` (seção 13.4).
 */
export function buildProjectHubApi(invoke: Invoke): ProjectHubApi {
  const call = <T>(channel: ResponseChannel, payload?: unknown) =>
    invokeChannel<T>(invoke, channel, payload);

  return {
    ping: () => call<string>(CHANNELS.appPing),
    projects: {
      list: () => call<ProjectSummary[]>(CHANNELS.projectsList),
      chooseDirectory: () => call<{ path: string } | null>(CHANNELS.projectsChooseDirectory),
      add: (input: AddProjectInput) => call<ProjectSummary>(CHANNELS.projectsAdd, input),
    },
  };
}
