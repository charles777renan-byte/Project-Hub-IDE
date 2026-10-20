import {
  CHANNELS,
  missionEventDtoSchema,
  responseSchemas,
  type AddProjectInput,
  type AppResult,
  type CreateMissionInput,
  type DecideApprovalInput,
  type ExecutionDto,
  type MissionDto,
  type MissionEventDto,
  type MissionPlanDto,
  type MissionViewDto,
  type ProjectHubApi,
  type ProjectSummary,
  type ProvideInput,
} from '@project-hub/contracts';

/** Chamada ao processo principal. No preload, é `ipcRenderer.invoke`. */
export type Invoke = (channel: string, payload?: unknown) => Promise<unknown>;

/**
 * Assinatura de um canal que o processo principal envia (main → renderer). Devolve a função que
 * remove o ouvinte. No preload, é `ipcRenderer.on`.
 */
export type Subscribe = (channel: string, listener: (payload: unknown) => void) => () => void;

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
 * Chama um canal e confere a resposta com o schema dele (seção 13.1 e R28). Resposta que não bate vira
 * VALIDATION_FAILED, registrada com console.warn, e o renderer não recebe o dado inesperado. Resposta
 * que bate segue como o schema a define: campos extras do processo principal ficam de fora.
 */
async function invokeChannel<T>(
  invoke: Invoke,
  channel: ResponseChannel,
  payload?: unknown,
): Promise<AppResult<T>> {
  const response = await invoke(channel, payload);
  const parsed = responseSchemas[channel].safeParse(response);
  if (!parsed.success) {
    console.warn(`Resposta fora do contrato no canal ${channel}:`, parsed.error.issues);
    return invalidResponse();
  }
  return parsed.data as AppResult<T>;
}

/**
 * Monta a API que o preload expõe ao renderer. É uma função pura: cada método chama um canal fixo
 * de `CHANNELS`, e o renderer nunca escolhe o canal nem recebe `invoke` ou `on` (seção 13.4).
 */
export function buildProjectHubApi(invoke: Invoke, subscribe: Subscribe): ProjectHubApi {
  const call = <T>(channel: ResponseChannel, payload?: unknown) =>
    invokeChannel<T>(invoke, channel, payload);

  return {
    ping: () => call<string>(CHANNELS.appPing),
    projects: {
      list: () => call<ProjectSummary[]>(CHANNELS.projectsList),
      chooseDirectory: () => call<{ path: string } | null>(CHANNELS.projectsChooseDirectory),
      add: (input: AddProjectInput) => call<ProjectSummary>(CHANNELS.projectsAdd, input),
    },
    missions: {
      create: (input: CreateMissionInput) => call<MissionDto>(CHANNELS.missionsCreate, input),
      list: (projectId: string) => call<MissionDto[]>(CHANNELS.missionsList, { projectId }),
      get: (missionId: string) => call<MissionViewDto>(CHANNELS.missionsGet, { missionId }),
      plan: (missionId: string) => call<MissionPlanDto>(CHANNELS.missionsPlan, { missionId }),
      approvePlan: (missionId: string) => call<void>(CHANNELS.missionsApprovePlan, { missionId }),
      start: (missionId: string) => call<ExecutionDto>(CHANNELS.missionsStart, { missionId }),
      cancel: (missionId: string) => call<void>(CHANNELS.missionsCancel, { missionId }),
      pause: (missionId: string) => call<void>(CHANNELS.missionsPause, { missionId }),
      resume: (missionId: string) => call<void>(CHANNELS.missionsResume, { missionId }),
      retry: (missionId: string) => call<ExecutionDto>(CHANNELS.missionsRetry, { missionId }),
      provideInput: (input: ProvideInput) => call<void>(CHANNELS.missionsProvideInput, input),
      subscribe: (listener: (event: MissionEventDto) => void) =>
        subscribe(CHANNELS.missionsEvent, (payload) => {
          const parsed = missionEventDtoSchema.safeParse(payload);
          if (!parsed.success) {
            console.warn(
              `Evento fora do contrato no canal ${CHANNELS.missionsEvent}:`,
              parsed.error.issues,
            );
            return;
          }
          listener(parsed.data);
        }),
    },
    approvals: {
      decide: (input: DecideApprovalInput) => call<void>(CHANNELS.approvalsDecide, input),
    },
  };
}
