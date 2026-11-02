import {
  createMission,
  deleteMission,
  failure,
  getMissionDiff,
  getMissionView,
  listMissions,
  type CreateMissionDeps,
  type DeleteMissionDeps,
  type MissionDiffDeps,
  type MissionQueryDeps,
  type Orchestrator,
  type PlanEdit,
} from '@project-hub/application';
import {
  CHANNELS,
  createMissionInputSchema,
  editPlanStepInputSchema,
  listMissionsInputSchema,
  missionIdInputSchema,
  planMissionInputSchema,
  provideInputSchema,
  requestChangesInputSchema,
  type AppResult,
} from '@project-hub/contracts';
import { registerTrustedHandler, type IpcRegistry, type SenderCheck } from './trusted-handler';

/**
 * O que os canais de missão precisam: o orquestrador e as consultas (criação, leitura, alterações e
 * exclusão).
 */
export type MissionsIpcDeps = {
  orchestrator: Orchestrator;
  createDeps: CreateMissionDeps;
  queryDeps: MissionQueryDeps;
  diffDeps: MissionDiffDeps;
  deleteDeps: DeleteMissionDeps;
};

const INVALID_MISSION = 'Confira os campos da missão: título, objetivo e um critério de aceite.';
const INVALID_PROJECT = 'Informe o projeto da missão.';
const INVALID_MISSION_ID = 'Informe a missão.';
const INVALID_INPUT = 'Confira a resposta antes de enviar.';
const INVALID_PLAN_REQUEST = 'Informe a missão e, se quiser, um pedido de até 1000 caracteres.';
const INVALID_PLAN_EDIT =
  'Confira a edição da tarefa: o título tem de 1 a 120 caracteres, a descrição até 2000 e a posição começa em 1.';

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

/** Alterações do worktree da missão. Só lê; a missão sem worktree devolve a lista vazia. */
export function handleMissionDiff(deps: MissionDiffDeps, payload: unknown) {
  const input = missionIdInputSchema.safeParse(payload);
  if (!input.success) return failure('VALIDATION_FAILED', INVALID_MISSION_ID);
  return getMissionDiff(deps, input.data.missionId);
}

/** Exclui a missão. Quem confere se ela já encerrou é o caso de uso, não o IPC. */
export function handleDeleteMission(deps: DeleteMissionDeps, payload: unknown) {
  const input = missionIdInputSchema.safeParse(payload);
  if (!input.success) return failure('VALIDATION_FAILED', INVALID_MISSION_ID);
  return deleteMission(deps, input.data.missionId);
}

/**
 * Gera ou refaz o plano. A instrução vai ao orquestrador só quando a pessoa a escreveu; sem ela, a
 * chamada é a de sempre.
 */
function handlePlanMission(orchestrator: Orchestrator, payload: unknown) {
  const input = planMissionInputSchema.safeParse(payload);
  if (!input.success) return failure('VALIDATION_FAILED', INVALID_PLAN_REQUEST);
  const { missionId, instruction } = input.data;
  return instruction === undefined
    ? orchestrator.planMission(missionId)
    : orchestrator.planMission(missionId, { instruction });
}

/** Edita uma tarefa do plano. A forma da edição é conferida aqui; as regras do plano, no orquestrador. */
export function handleEditPlanStep(orchestrator: Orchestrator, payload: unknown) {
  const input = editPlanStepInputSchema.safeParse(payload);
  if (!input.success) return failure('VALIDATION_FAILED', INVALID_PLAN_EDIT);
  const { missionId, stepId, edit } = input.data;
  // O schema deixa `description` opcional com `undefined`; o `PlanEdit` da aplicação não aceita a chave
  // presente e vazia (exactOptionalPropertyTypes), então ela só segue quando a pessoa a escreveu.
  const planEdit: PlanEdit =
    edit.op === 'rename'
      ? {
          op: 'rename',
          title: edit.title,
          ...(edit.description === undefined ? {} : { description: edit.description }),
        }
      : edit;
  return orchestrator.editPlanStep({ missionId, stepId, edit: planEdit });
}

/**
 * Canais de ação sobre uma missão. Cada um confere a entrada e chama o orquestrador (seção 15.3).
 * Quem decide o estado é o orquestrador; o IPC só repassa.
 */
export function handleMissionAction(
  orchestrator: Orchestrator,
  action:
    | 'plan'
    | 'approvePlan'
    | 'cancelPlanning'
    | 'start'
    | 'cancel'
    | 'pause'
    | 'resume'
    | 'retry'
    | 'approveReview',
  payload: unknown,
) {
  if (action === 'plan') return handlePlanMission(orchestrator, payload);
  const input = missionIdInputSchema.safeParse(payload);
  if (!input.success) return failure('VALIDATION_FAILED', INVALID_MISSION_ID);
  const { missionId } = input.data;
  switch (action) {
    case 'approvePlan':
      return orchestrator.approvePlan(missionId);
    case 'cancelPlanning':
      return orchestrator.cancelPlanning(missionId);
    case 'start':
      return orchestrator.startMission(missionId);
    case 'cancel':
      return orchestrator.cancelMission(missionId);
    case 'pause':
      return orchestrator.pauseMission(missionId);
    case 'resume':
      return orchestrator.resumeMission(missionId);
    case 'retry':
      return orchestrator.retryMission(missionId);
    case 'approveReview':
      return orchestrator.approveReview(missionId);
  }
}

export function handleProvideInput(orchestrator: Orchestrator, payload: unknown) {
  const input = provideInputSchema.safeParse(payload);
  if (!input.success) return failure('VALIDATION_FAILED', INVALID_INPUT);
  return orchestrator.provideInput(input.data);
}

/** Pedido de ajuste na revisão: a entrada é validada aqui, e a regra de estado fica no orquestrador. */
export function handleRequestChanges(orchestrator: Orchestrator, payload: unknown) {
  const input = requestChangesInputSchema.safeParse(payload);
  if (!input.success) return failure('VALIDATION_FAILED', INVALID_INPUT);
  return orchestrator.requestChanges(input.data);
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
  on(CHANNELS.missionsDiff, (payload) => handleMissionDiff(deps.diffDeps, payload));
  on(CHANNELS.missionsPlan, (payload) => handleMissionAction(orchestrator, 'plan', payload));
  on(CHANNELS.missionsEditPlan, (payload) => handleEditPlanStep(orchestrator, payload));
  on(CHANNELS.missionsApprovePlan, (payload) =>
    handleMissionAction(orchestrator, 'approvePlan', payload),
  );
  on(CHANNELS.missionsCancelPlanning, (payload) =>
    handleMissionAction(orchestrator, 'cancelPlanning', payload),
  );
  on(CHANNELS.missionsStart, (payload) => handleMissionAction(orchestrator, 'start', payload));
  on(CHANNELS.missionsCancel, (payload) => handleMissionAction(orchestrator, 'cancel', payload));
  on(CHANNELS.missionsPause, (payload) => handleMissionAction(orchestrator, 'pause', payload));
  on(CHANNELS.missionsResume, (payload) => handleMissionAction(orchestrator, 'resume', payload));
  on(CHANNELS.missionsRetry, (payload) => handleMissionAction(orchestrator, 'retry', payload));
  on(CHANNELS.missionsDelete, (payload) => handleDeleteMission(deps.deleteDeps, payload));
  on(CHANNELS.missionsProvideInput, (payload) => handleProvideInput(orchestrator, payload));
  on(CHANNELS.missionsApproveReview, (payload) =>
    handleMissionAction(orchestrator, 'approveReview', payload),
  );
  on(CHANNELS.missionsRequestChanges, (payload) => handleRequestChanges(orchestrator, payload));
}
