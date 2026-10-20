import {
  createMission,
  failure,
  getMissionView,
  listMissions,
  type CreateMissionDeps,
  type MissionQueryDeps,
  type Orchestrator,
} from '@project-hub/application';
import {
  CHANNELS,
  createMissionInputSchema,
  listMissionsInputSchema,
  missionIdInputSchema,
  provideInputSchema,
  type AppResult,
} from '@project-hub/contracts';
import { registerTrustedHandler, type IpcRegistry, type SenderCheck } from './trusted-handler';

/** O que os canais de missão precisam: o orquestrador e as duas consultas (criação e leitura). */
export type MissionsIpcDeps = {
  orchestrator: Orchestrator;
  createDeps: CreateMissionDeps;
  queryDeps: MissionQueryDeps;
};

const INVALID_MISSION = 'Confira os campos da missão: título, objetivo e um critério de aceite.';
const INVALID_PROJECT = 'Informe o projeto da missão.';
const INVALID_MISSION_ID = 'Informe a missão.';
const INVALID_INPUT = 'Confira a resposta antes de enviar.';

/** Cria a missão em rascunho. A entrada é conferida pelo schema antes de qualquer gravação (R165). */
export function handleCreateMission(deps: CreateMissionDeps, payload: unknown) {
  const input = createMissionInputSchema.safeParse(payload);
  if (!input.success) return failure('VALIDATION_FAILED', INVALID_MISSION);
  return createMission(deps, input.data);
}

export function handleListMissions(deps: MissionQueryDeps, payload: unknown) {
  const input = listMissionsInputSchema.safeParse(payload);
  if (!input.success) return failure('VALIDATION_FAILED', INVALID_PROJECT);
  return listMissions(deps, input.data.projectId);
}

export function handleGetMission(deps: MissionQueryDeps, payload: unknown) {
  const input = missionIdInputSchema.safeParse(payload);
  if (!input.success) return failure('VALIDATION_FAILED', INVALID_MISSION_ID);
  return getMissionView(deps, input.data.missionId);
}

/**
 * Canais de ação sobre uma missão. Cada um confere a entrada e chama o orquestrador (seção 15.3).
 * Quem decide o estado é o orquestrador; o IPC só repassa.
 */
export function handleMissionAction(
  orchestrator: Orchestrator,
  action: 'plan' | 'approvePlan' | 'start' | 'cancel',
  payload: unknown,
) {
  const input = missionIdInputSchema.safeParse(payload);
  if (!input.success) return failure('VALIDATION_FAILED', INVALID_MISSION_ID);
  const { missionId } = input.data;
  switch (action) {
    case 'plan':
      return orchestrator.planMission(missionId);
    case 'approvePlan':
      return orchestrator.approvePlan(missionId);
    case 'start':
      return orchestrator.startMission(missionId);
    case 'cancel':
      return orchestrator.cancelMission(missionId);
  }
}

export function handleProvideInput(orchestrator: Orchestrator, payload: unknown) {
  const input = provideInputSchema.safeParse(payload);
  if (!input.success) return failure('VALIDATION_FAILED', INVALID_INPUT);
  return orchestrator.provideInput(input.data);
}

/** Liga os canais de missão. Todos recusam remetente de outra origem (R65, R165). */
export function registerMissionHandlers(
  registry: IpcRegistry,
  isTrusted: SenderCheck,
  deps: MissionsIpcDeps,
): void {
  const { orchestrator } = deps;
  const on = (
    channel: string,
    run: (payload: unknown) => Promise<AppResult<unknown>> | AppResult<unknown>,
  ) =>
    registerTrustedHandler(registry, channel, isTrusted, (_event, payload) =>
      Promise.resolve(run(payload)),
    );

  on(CHANNELS.missionsCreate, (payload) => handleCreateMission(deps.createDeps, payload));
  on(CHANNELS.missionsList, (payload) => handleListMissions(deps.queryDeps, payload));
  on(CHANNELS.missionsGet, (payload) => handleGetMission(deps.queryDeps, payload));
  on(CHANNELS.missionsPlan, (payload) => handleMissionAction(orchestrator, 'plan', payload));
  on(CHANNELS.missionsApprovePlan, (payload) =>
    handleMissionAction(orchestrator, 'approvePlan', payload),
  );
  on(CHANNELS.missionsStart, (payload) => handleMissionAction(orchestrator, 'start', payload));
  on(CHANNELS.missionsCancel, (payload) => handleMissionAction(orchestrator, 'cancel', payload));
  on(CHANNELS.missionsProvideInput, (payload) => handleProvideInput(orchestrator, payload));
}
