import type { MissionStatus } from './mission-state';

/** Valores de cada enumeração do modelo (seção 9). O banco confere os mesmos valores em `CHECK`. */
export const MISSION_PRIORITIES = ['low', 'normal', 'high'] as const;
export const MISSION_STEP_KINDS = [
  'analysis',
  'code',
  'command',
  'test',
  'review',
  'custom',
] as const;
/** Papel de uma tarefa no plano. Sem papel, a etapa é só apresentação (a missão roda numa sessão só). */
export const MISSION_ROLES = ['frontend', 'backend', 'database', 'docs', 'qa', 'general'] as const;
export const MISSION_STEP_STATUSES = [
  'pending',
  'running',
  'blocked',
  'succeeded',
  'failed',
  'skipped',
] as const;
export const EXECUTION_STATUSES = [
  'queued',
  'running',
  'paused',
  'succeeded',
  'failed',
  'cancelled',
] as const;
/**
 * Motivo do fim de uma execução. `completed` vale para `succeeded`; os demais, para `failed` e
 * `cancelled`.
 */
export const EXIT_REASONS = [
  'completed',
  'agent_failed',
  'approval_rejected',
  'cancelled_by_user',
  'interrupted_by_restart',
] as const;
export const APPROVAL_STATUSES = ['pending', 'approved', 'rejected', 'expired'] as const;
export const AUDIT_AGGREGATE_TYPES = [
  'project',
  'mission',
  'execution',
  'worktree',
  'settings',
] as const;
export const AUDIT_SEVERITIES = ['debug', 'info', 'warning', 'error'] as const;
export const AUDIT_ACTORS = ['user', 'agent', 'system'] as const;

/** Ações que exigem aprovação por padrão (seção 17.3). */
export const PROTECTED_ACTIONS = [
  'write_outside_worktree',
  'sensitive_directory_access',
  'global_install',
  'privilege_elevation',
  'unplanned_network_access',
  'new_credential_use',
  'recursive_delete',
  'global_git_config_change',
  'push_or_publish',
  'run_downloaded_binary',
  'read_secret_file',
] as const;

export type MissionPriority = (typeof MISSION_PRIORITIES)[number];
export type MissionStepKind = (typeof MISSION_STEP_KINDS)[number];
export type MissionRole = (typeof MISSION_ROLES)[number];
export type MissionStepStatus =(typeof MISSION_STEP_STATUSES)[number];
export type ExecutionStatus = (typeof EXECUTION_STATUSES)[number];
export type ExitReason = (typeof EXIT_REASONS)[number];
export type ApprovalStatus = (typeof APPROVAL_STATUSES)[number];
export type AuditAggregateType = (typeof AUDIT_AGGREGATE_TYPES)[number];
export type AuditSeverity = (typeof AUDIT_SEVERITIES)[number];
export type AuditActor = (typeof AUDIT_ACTORS)[number];
export type ProtectedAction = (typeof PROTECTED_ACTIONS)[number];

/** Critério de aceite da missão. `position` ordena os critérios dentro da missão. */
export type AcceptanceCriterion = { id: string; position: number; text: string };

/** Missão: objetivo com ciclo de vida próprio (seção 9.1). */
export type Mission = {
  id: string;
  projectId: string;
  title: string;
  objective: string;
  context?: string;
  acceptanceCriteria: AcceptanceCriterion[];
  status: MissionStatus;
  priority: MissionPriority;
  agentProfileId: string;
  executionProfileId: string;
  /** Campo novo da Tarefa 9: `true` quando a missão grava código, e então precisa de Git e worktree. */
  altersCode: boolean;
  /** Identificador do worktree da missão. A tabela `worktrees` chega depois; até lá o id é só uma referência. */
  worktreeId?: string;
  /** Caminho do worktree em uso. Fica na missão para que uma nova tentativa reaproveite o mesmo worktree. */
  worktreePath?: string;
  createdAt: string;
  updatedAt: string;
  startedAt?: string;
  finishedAt?: string;
};

/** Etapa do plano de uma missão. No MVP as etapas são sequenciais (seção 15.3). */
export type MissionStep = {
  id: string;
  missionId: string;
  position: number;
  title: string;
  description: string;
  kind: MissionStepKind;
  status: MissionStepStatus;
  dependsOn: string[];
  /** Quando existe, a etapa é uma tarefa: roda numa sessão própria, depois das que ela depende. */
  role?: MissionRole;
  startedAt?: string;
  finishedAt?: string;
};

/** Uma tentativa de execução. Uma missão pode ter várias (seção 9.1). */
export type Execution = {
  id: string;
  missionId: string;
  attempt: number;
  status: ExecutionStatus;
  /** Tarefa que esta tentativa executa. Vazio na tentativa que roda a missão inteira. */
  stepId?: string;
  agentSessionId?: string;
  /** Última saída do agente que a aplicação aplicou. Opaca: só o adaptador a interpreta. */
  agentCursor?: string;
  exitReason?: ExitReason;
  usage?: UsageSummary;
  startedAt?: string;
  finishedAt?: string;
};

/** Uso informado pelo agente, em contagens de tokens. */
export type UsageSummary = { inputTokens: number; outputTokens: number };

/** Pedido de aprovação de uma ação protegida (seção 9.1). */
export type ApprovalRequest = {
  id: string;
  missionId: string;
  executionId: string;
  actionType: ProtectedAction;
  title: string;
  rationale: string;
  commandPreview?: string;
  affectedResources: string[];
  status: ApprovalStatus;
  requestedAt: string;
  decidedAt?: string;
  decisionNote?: string;
};

/** Evento de auditoria (seção 9.1). `sequence` cresce dentro de cada `aggregateId` (seção 15.3). */
export type AuditEvent = {
  id: string;
  aggregateType: AuditAggregateType;
  aggregateId: string;
  eventType: string;
  severity: AuditSeverity;
  actor: AuditActor;
  payload: Record<string, unknown>;
  sequence: number;
  createdAt: string;
};

/** Evento antes de o repositório lhe dar `id` e `sequence`. */
export type NewAuditEvent = Omit<AuditEvent, 'id' | 'sequence'>;
