import { z } from 'zod';

/*
 * DTOs de missão que atravessam o IPC (seção 13.4). Os valores das enumerações espelham as listas do
 * domínio (`MISSION_STATUSES` e as outras em `@project-hub/domain`). O contracts não importa o domínio
 * para não ganhar dependência nova; o teste `apps/desktop/test/mission-contract.test.ts` confere que
 * as listas batem.
 */

export const MISSION_STATUS_VALUES = [
  'draft',
  'planned',
  'queued',
  'running',
  'waiting_approval',
  'waiting_input',
  'paused',
  'succeeded',
  'failed',
  'cancelled',
] as const;
export const STEP_STATUS_VALUES = [
  'pending',
  'running',
  'blocked',
  'succeeded',
  'failed',
  'skipped',
] as const;
export const EXECUTION_STATUS_VALUES = [
  'queued',
  'running',
  'paused',
  'succeeded',
  'failed',
  'cancelled',
] as const;
export const EXIT_REASON_VALUES = [
  'completed',
  'agent_failed',
  'approval_rejected',
  'cancelled_by_user',
  'interrupted_by_restart',
] as const;
export const APPROVAL_STATUS_VALUES = ['pending', 'approved', 'rejected', 'expired'] as const;
export const AUDIT_SEVERITY_VALUES = ['debug', 'info', 'warning', 'error'] as const;
export const AUDIT_ACTOR_VALUES = ['user', 'agent', 'system'] as const;
export const AUDIT_AGGREGATE_VALUES = [
  'project',
  'mission',
  'execution',
  'worktree',
  'settings',
] as const;

const missionStatusSchema = z.enum(MISSION_STATUS_VALUES);

/** Critérios de aceite são obrigatórios; a aplicação recusa os que ficam vazios depois de aparados. */
export const createMissionInputSchema = z.object({
  projectId: z.string().min(1),
  title: z.string().min(1),
  objective: z.string().min(1),
  acceptanceCriteria: z.array(z.string()).min(1),
  altersCode: z.boolean(),
});
export type CreateMissionInput = z.infer<typeof createMissionInputSchema>;

/** Entrada de `missions:list:v1`. */
export const listMissionsInputSchema = z.object({ projectId: z.string().min(1) });

/** Entrada dos canais que agem numa missão só (plan, approve-plan, start, cancel, get). */
export const missionIdInputSchema = z.object({ missionId: z.string().min(1) });

/** Entrada de `missions:provide-input:v1`: a resposta do usuário ao pedido de entrada do agente. */
export const provideInputSchema = z.object({
  missionId: z.string().min(1),
  text: z.string().min(1),
});
export type ProvideInput = z.infer<typeof provideInputSchema>;

/** Entrada de `approvals:decide:v1`. A nota é opcional e só vai ao agente quando a pessoa a escreve. */
export const decideApprovalInputSchema = z.object({
  approvalId: z.string().min(1),
  decision: z.enum(['approved', 'rejected']),
  note: z.string().optional(),
});
export type DecideApprovalInput = z.infer<typeof decideApprovalInputSchema>;

export const missionDtoSchema = z.object({
  id: z.string(),
  projectId: z.string(),
  title: z.string(),
  objective: z.string(),
  status: missionStatusSchema,
  altersCode: z.boolean(),
  acceptanceCriteria: z.array(z.object({ id: z.string(), position: z.number(), text: z.string() })),
  worktreePath: z.string().optional(),
  startedAt: z.string().optional(),
  finishedAt: z.string().optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type MissionDto = z.infer<typeof missionDtoSchema>;

export const missionStepDtoSchema = z.object({
  id: z.string(),
  position: z.number(),
  title: z.string(),
  status: z.enum(STEP_STATUS_VALUES),
});
export type MissionStepDto = z.infer<typeof missionStepDtoSchema>;

export const missionPlanDtoSchema = z.object({
  missionId: z.string(),
  steps: z.array(missionStepDtoSchema),
});
export type MissionPlanDto = z.infer<typeof missionPlanDtoSchema>;

export const executionDtoSchema = z.object({
  id: z.string(),
  missionId: z.string(),
  attempt: z.number(),
  status: z.enum(EXECUTION_STATUS_VALUES),
  exitReason: z.enum(EXIT_REASON_VALUES).optional(),
});
export type ExecutionDto = z.infer<typeof executionDtoSchema>;

export const approvalDtoSchema = z.object({
  id: z.string(),
  missionId: z.string(),
  executionId: z.string(),
  actionType: z.string(),
  title: z.string(),
  rationale: z.string(),
  commandPreview: z.string().optional(),
  affectedResources: z.array(z.string()),
  status: z.enum(APPROVAL_STATUS_VALUES),
  requestedAt: z.string(),
});
export type ApprovalDto = z.infer<typeof approvalDtoSchema>;

/**
 * Evento da auditoria de uma missão, com o `missionId` da missão a que ele pertence (o da execução
 * também). `payload` depende do tipo do evento, então o renderer o lê com cuidado.
 */
export const missionEventDtoSchema = z.object({
  id: z.string(),
  missionId: z.string(),
  aggregateType: z.enum(AUDIT_AGGREGATE_VALUES),
  aggregateId: z.string(),
  eventType: z.string(),
  severity: z.enum(AUDIT_SEVERITY_VALUES),
  actor: z.enum(AUDIT_ACTOR_VALUES),
  payload: z.record(z.string(), z.unknown()),
  sequence: z.number(),
  createdAt: z.string(),
});
export type MissionEventDto = z.infer<typeof missionEventDtoSchema>;

/** Como um arquivo aparece no diff. `untracked` é arquivo novo que ainda não entrou no Git. */
export const DIFF_STATUS_VALUES = ['added', 'modified', 'deleted', 'untracked'] as const;

export const missionDiffFileSchema = z.object({
  path: z.string(),
  status: z.enum(DIFF_STATUS_VALUES),
  added: z.number(),
  removed: z.number(),
  binary: z.boolean(),
  truncated: z.boolean(),
  patch: z.string().optional(),
});
export type MissionDiffFileDto = z.infer<typeof missionDiffFileSchema>;

/** Alterações do worktree da missão. `truncatedFiles` indica que a lista traz só os primeiros arquivos. */
export const missionDiffDtoSchema = z.object({
  files: z.array(missionDiffFileSchema),
  truncatedFiles: z.boolean(),
});
export type MissionDiffDto = z.infer<typeof missionDiffDtoSchema>;

export const missionViewSchema = z.object({
  mission: missionDtoSchema,
  project: z.object({
    id: z.string(),
    name: z.string(),
    path: z.string(),
    defaultBranch: z.string().optional(),
  }),
  steps: z.array(missionStepDtoSchema),
  executions: z.array(executionDtoSchema),
  pendingApprovals: z.array(approvalDtoSchema),
  events: z.array(missionEventDtoSchema),
});
export type MissionViewDto = z.infer<typeof missionViewSchema>;
