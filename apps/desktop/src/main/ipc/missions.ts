import {
  createMission,
  deleteMission,
  failure,
  getMissionDiff,
  getMissionView,
  listMissions,
  setMissionAccount,
  setMissionProfile,
  withMissionAccount,
  type CreateMissionDeps,
  type DeleteMissionDeps,
  type MissionDiffDeps,
  type MissionAccountDeps,
  type MissionQueryDeps,
  type Orchestrator,
  type PlanEdit,
  type SetMissionAccountDeps,
  type SetMissionProfileDeps,
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
  setMissionAccountInputSchema,
  setMissionProfileInputSchema,
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
  /** A conta de cada missão (nome, removida, travada) e a troca dela. Só ids e nomes passam por aqui. */
  accountDeps: MissionAccountIpcDeps;
};

const INVALID_MISSION = 'Confira os campos da missão: título, objetivo e um critério de aceite.';
const INVALID_PROJECT = 'Informe o projeto da missão.';
const INVALID_MISSION_ID = 'Informe a missão.';
const INVALID_INPUT = 'Confira a resposta antes de enviar.';
const INVALID_ACCOUNT = 'Informe a missão e a conta.';
const INVALID_PROFILE = 'Informe a missão e o perfil.';
const INVALID_PLAN_REQUEST = 'Informe a missão e, se quiser, um pedido de até 1000 caracteres.';
const INVALID_PLAN_EDIT =
  'Confira a edição da tarefa: o título tem de 1 a 120 caracteres, a descrição até 2000 e a posição começa em 1.';

/** Cria a missão em rascunho. A entrada é conferida pelo schema antes de qualquer gravação (R165). */
export function handleCreateMission(
  deps: CreateMissionDeps,
  payload: unknown,
  account?: MissionAccountDeps,
) {
  const input = createMissionInputSchema.safeParse(payload);
  if (!input.success) return failure('VALIDATION_FAILED', INVALID_MISSION);
  const created = createMission(deps, input.data);
  if (!created.ok || account === undefined) return created;
  return { ok: true as const, data: withMissionAccount(account, created.data) };
}

/** As missões do projeto. Com `account`, cada uma sai com a conta dela, na forma que a tela espera. */
export function handleListMissions(
  deps: MissionQueryDeps,
  payload: unknown,
  account?: MissionAccountDeps,
) {
  const input = listMissionsInputSchema.safeParse(payload);
  if (!input.success) return failure('VALIDATION_FAILED', INVALID_PROJECT);
  const listed = listMissions(deps, input.data.projectId);
  if (!listed.ok || account === undefined) return listed;
  return {
    ok: true as const,
    data: listed.data.map((mission) => withMissionAccount(account, mission)),
  };
}

export function handleGetMission(
  deps: MissionQueryDeps,
  payload: unknown,
  account?: MissionAccountDeps,
) {
  const input = missionIdInputSchema.safeParse(payload);
  if (!input.success) return failure('VALIDATION_FAILED', INVALID_MISSION_ID);
  const view = getMissionView(deps, input.data.missionId);
  if (!view.ok || account === undefined) return view;
  return {
    ok: true as const,
    data: { ...view.data, mission: withMissionAccount(account, view.data.mission) },
  };
}

/** Troca a conta da missão. Só o id da missão e o da conta: a regra (antes de começar, conta que vale) é do caso de uso. */
export function handleSetMissionAccount(deps: SetMissionAccountDeps, payload: unknown) {
  const input = setMissionAccountInputSchema.safeParse(payload);
  if (!input.success) return failure('VALIDATION_FAILED', INVALID_ACCOUNT);
  return setMissionAccount(deps, input.data);
}

/** O que os canais da conta e do perfil da missão precisam: as duas trocas leem a mesma trava. */
export type MissionAccountIpcDeps = SetMissionAccountDeps & SetMissionProfileDeps;

/** Troca o perfil de execução da missão. Só o id da missão e o do perfil: a regra é do caso de uso. */
export function handleSetMissionProfile(deps: SetMissionProfileDeps, payload: unknown) {
  const input = setMissionProfileInputSchema.safeParse(payload);
  if (!input.success) return failure('VALIDATION_FAILED', INVALID_PROFILE);
  return setMissionProfile(deps, input.data);
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

  const account = deps.accountDeps;
  on(CHANNELS.missionsCreate, (payload) => handleCreateMission(deps.createDeps, payload, account));
  on(CHANNELS.missionsList, (payload) => handleListMissions(deps.queryDeps, payload, account));
  on(CHANNELS.missionsGet, (payload) => handleGetMission(deps.queryDeps, payload, account));
  on(CHANNELS.missionsSetAccount, (payload) => handleSetMissionAccount(account, payload));
  on(CHANNELS.missionsSetProfile, (payload) => handleSetMissionProfile(account, payload));
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
