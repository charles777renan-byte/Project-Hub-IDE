import {
  APPROVAL_STATUSES,
  AUDIT_ACTORS,
  AUDIT_AGGREGATE_TYPES,
  AUDIT_SEVERITIES,
  EXECUTION_STATUSES,
  EXIT_REASONS,
  MISSION_AGENTS,
  MISSION_PRIORITIES,
  MISSION_STATUSES,
  MISSION_ROLES,
  MISSION_STEP_KINDS,
  MISSION_STEP_STATUSES,
  PROTECTED_ACTIONS,
  type ContextUsage,
  type UsageSummary,
} from '@project-hub/domain';
import { sql } from 'drizzle-orm';
import { check, index, integer, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';

/** Lista SQL dos valores de uma enumeração. Os valores vêm de constantes do domínio, nunca de entrada. */
const oneOf = (values: readonly string[]) =>
  sql.raw(values.map((value) => `'${value}'`).join(', '));

export const projects = sqliteTable(
  'projects',
  {
    id: text('id').primaryKey(),
    name: text('name').notNull(),
    path: text('path').notNull(),
    normalizedPath: text('normalized_path').notNull().unique(),
    description: text('description'),
    repositoryKind: text('repository_kind', { enum: ['git', 'none'] }).notNull(),
    defaultBranch: text('default_branch'),
    isFavorite: integer('is_favorite', { mode: 'boolean' })
      .notNull()
      .default(sql`0`),
    trusted: integer('trusted', { mode: 'boolean' })
      .notNull()
      .default(sql`0`),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
    lastOpenedAt: text('last_opened_at'),
    archivedAt: text('archived_at'),
    removedAt: text('removed_at'),
    groupName: text('group_name'),
    nickname: text('nickname'),
  },
  (table) => [
    check('projects_repository_kind_check', sql`${table.repositoryKind} IN ('git', 'none')`),
  ],
);

export const missions = sqliteTable(
  'missions',
  {
    id: text('id').primaryKey(),
    projectId: text('project_id')
      .notNull()
      .references(() => projects.id),
    title: text('title').notNull(),
    objective: text('objective').notNull(),
    context: text('context'),
    status: text('status', { enum: MISSION_STATUSES }).notNull(),
    priority: text('priority', { enum: MISSION_PRIORITIES }).notNull(),
    agentProfileId: text('agent_profile_id').notNull(),
    executionProfileId: text('execution_profile_id').notNull(),
    altersCode: integer('alters_code', { mode: 'boolean' })
      .notNull()
      .default(sql`0`),
    worktreeId: text('worktree_id'),
    worktreePath: text('worktree_path'),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
    startedAt: text('started_at'),
    finishedAt: text('finished_at'),
  },
  (table) => [
    check('missions_status_check', sql`${table.status} IN (${oneOf(MISSION_STATUSES)})`),
    check('missions_priority_check', sql`${table.priority} IN (${oneOf(MISSION_PRIORITIES)})`),
    index('missions_project_status_updated_idx').on(table.projectId, table.status, table.updatedAt),
  ],
);

export const missionAcceptanceCriteria = sqliteTable(
  'mission_acceptance_criteria',
  {
    id: text('id').primaryKey(),
    missionId: text('mission_id')
      .notNull()
      .references(() => missions.id, { onDelete: 'cascade' }),
    position: integer('position').notNull(),
    text: text('text').notNull(),
  },
  (table) => [
    uniqueIndex('mission_acceptance_criteria_position_unique').on(table.missionId, table.position),
  ],
);

export const missionSteps = sqliteTable(
  'mission_steps',
  {
    id: text('id').primaryKey(),
    missionId: text('mission_id')
      .notNull()
      .references(() => missions.id, { onDelete: 'cascade' }),
    position: integer('position').notNull(),
    title: text('title').notNull(),
    description: text('description').notNull(),
    kind: text('kind', { enum: MISSION_STEP_KINDS }).notNull(),
    status: text('status', { enum: MISSION_STEP_STATUSES }).notNull(),
    dependsOn: text('depends_on', { mode: 'json' }).$type<string[]>().notNull(),
    role: text('role', { enum: MISSION_ROLES }),
    agent: text('agent', { enum: MISSION_AGENTS }).notNull().default('claude-code'),
    startedAt: text('started_at'),
    finishedAt: text('finished_at'),
  },
  (table) => [
    uniqueIndex('mission_steps_position_unique').on(table.missionId, table.position),
    check(
      'mission_steps_role_check',
      sql`${table.role} IS NULL OR ${table.role} IN (${oneOf(MISSION_ROLES)})`,
    ),
    check('mission_steps_agent_check', sql`${table.agent} IN (${oneOf(MISSION_AGENTS)})`),
    check('mission_steps_kind_check', sql`${table.kind} IN (${oneOf(MISSION_STEP_KINDS)})`),
    check('mission_steps_status_check', sql`${table.status} IN (${oneOf(MISSION_STEP_STATUSES)})`),
  ],
);

export const executions = sqliteTable(
  'executions',
  {
    id: text('id').primaryKey(),
    missionId: text('mission_id')
      .notNull()
      .references(() => missions.id, { onDelete: 'cascade' }),
    attempt: integer('attempt').notNull(),
    /** Tarefa que a tentativa executa; vazio quando ela roda a missão inteira. Sem chave estrangeira: `replaceSteps` recria as tarefas. */
    stepId: text('step_id'),
    status: text('status', { enum: EXECUTION_STATUSES }).notNull(),
    agentSessionId: text('agent_session_id'),
    /** Última saída do agente aplicada. Opaca: o adaptador a interpreta, para retomar de onde parou. */
    agentCursor: text('agent_cursor'),
    exitReason: text('exit_reason', { enum: EXIT_REASONS }),
    usage: text('usage', { mode: 'json' }).$type<UsageSummary>(),
    /** Modelo e contexto da resposta principal mais recente. À parte do gasto: sobe e desce, e não entra nas somas. */
    context: text('context', { mode: 'json' }).$type<ContextUsage>(),
    startedAt: text('started_at'),
    finishedAt: text('finished_at'),
  },
  (table) => [
    uniqueIndex('executions_attempt_unique').on(table.missionId, table.attempt),
    check('executions_status_check', sql`${table.status} IN (${oneOf(EXECUTION_STATUSES)})`),
    check(
      'executions_exit_reason_check',
      sql`${table.exitReason} IS NULL OR ${table.exitReason} IN (${oneOf(EXIT_REASONS)})`,
    ),
  ],
);

export const approvalRequests = sqliteTable(
  'approval_requests',
  {
    id: text('id').primaryKey(),
    missionId: text('mission_id')
      .notNull()
      .references(() => missions.id, { onDelete: 'cascade' }),
    executionId: text('execution_id')
      .notNull()
      .references(() => executions.id, { onDelete: 'cascade' }),
    actionType: text('action_type', { enum: PROTECTED_ACTIONS }).notNull(),
    title: text('title').notNull(),
    rationale: text('rationale').notNull(),
    commandPreview: text('command_preview'),
    affectedResources: text('affected_resources', { mode: 'json' }).$type<string[]>().notNull(),
    status: text('status', { enum: APPROVAL_STATUSES }).notNull(),
    requestedAt: text('requested_at').notNull(),
    decidedAt: text('decided_at'),
    decisionNote: text('decision_note'),
  },
  (table) => [
    index('approval_requests_status_requested_idx').on(table.status, table.requestedAt),
    index('approval_requests_execution_status_idx').on(table.executionId, table.status),
    check('approval_requests_status_check', sql`${table.status} IN (${oneOf(APPROVAL_STATUSES)})`),
    check(
      'approval_requests_action_type_check',
      sql`${table.actionType} IN (${oneOf(PROTECTED_ACTIONS)})`,
    ),
  ],
);

/** Auditoria (seção 9.1). `sequence` é único dentro de cada `aggregate_id`: a ordem não se repete. */
export const auditEvents = sqliteTable(
  'audit_events',
  {
    id: text('id').primaryKey(),
    aggregateType: text('aggregate_type', { enum: AUDIT_AGGREGATE_TYPES }).notNull(),
    aggregateId: text('aggregate_id').notNull(),
    eventType: text('event_type').notNull(),
    severity: text('severity', { enum: AUDIT_SEVERITIES }).notNull(),
    actor: text('actor', { enum: AUDIT_ACTORS }).notNull(),
    payload: text('payload', { mode: 'json' }).$type<Record<string, unknown>>().notNull(),
    sequence: integer('sequence').notNull(),
    createdAt: text('created_at').notNull(),
  },
  (table) => [
    uniqueIndex('audit_events_aggregate_sequence_unique').on(table.aggregateId, table.sequence),
    check(
      'audit_events_aggregate_type_check',
      sql`${table.aggregateType} IN (${oneOf(AUDIT_AGGREGATE_TYPES)})`,
    ),
    check('audit_events_severity_check', sql`${table.severity} IN (${oneOf(AUDIT_SEVERITIES)})`),
    check('audit_events_actor_check', sql`${table.actor} IN (${oneOf(AUDIT_ACTORS)})`),
  ],
);

/** Um workspace por projeto. O layout é um JSON opaco para o banco: quem valida é a camada acima. */
export const workspaces = sqliteTable('workspaces', {
  id: text('id').primaryKey(),
  projectId: text('project_id')
    .notNull()
    .unique()
    .references(() => projects.id),
  layout: text('layout').notNull(),
  isOpen: integer('is_open', { mode: 'boolean' })
    .notNull()
    .default(sql`0`),
  position: integer('position').notNull().default(0),
  lastActiveAt: text('last_active_at').notNull(),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
});

/** Sessões de terminal abertas por painel, para reconhecer os processos vivos ao reabrir o app. */
export const terminalSessions = sqliteTable('terminal_sessions', {
  id: text('id').primaryKey(),
  projectId: text('project_id')
    .notNull()
    .references(() => projects.id),
  provider: text('provider').notNull(),
  title: text('title').notNull(),
  createdAt: text('created_at').notNull(),
  closedAt: text('closed_at'),
});

/** Configurações do app, em pares chave e texto (seção 9.4). Hoje guarda só o nome da saudação do perfil local. */
export const appSettings = sqliteTable('app_settings', {
  key: text('key').primaryKey(),
  value: text('value').notNull(),
  updatedAt: text('updated_at').notNull(),
});

/**
 * Abas de página do navegador interno, por projeto. Guarda só o que volta ao reabrir o app: endereço, título, ordem
 * e qual é a ativa. O histórico de voltar e avançar não é guardado.
 */
export const browserTabs = sqliteTable(
  'browser_tabs',
  {
    id: text('id').primaryKey(),
    projectId: text('project_id')
      .notNull()
      .references(() => projects.id),
    url: text('url').notNull(),
    title: text('title').notNull(),
    position: integer('position').notNull(),
    isActive: integer('is_active', { mode: 'boolean' }).notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  (table) => [index('browser_tabs_project_idx').on(table.projectId)],
);

export const schema = {
  projects,
  missions,
  missionAcceptanceCriteria,
  missionSteps,
  executions,
  approvalRequests,
  auditEvents,
  workspaces,
  terminalSessions,
  appSettings,
  browserTabs,
};
