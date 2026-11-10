import { and, asc, desc, eq, isNotNull } from 'drizzle-orm';
import type {
  ApprovalRequest,
  AuditEvent,
  Execution,
  ExecutionStatus,
  Mission,
  MissionStep,
  NewAuditEvent,
} from '@project-hub/domain';
import type { AppDatabase } from '../client';
import { appendAuditEvent } from './audit-repository';
import {
  approvalRequests,
  auditEvents,
  executions,
  missionAcceptanceCriteria,
  missions,
  missionSteps,
} from '../schema';

/** Campos de uma missão, de uma execução e de uma aprovação que a aplicação altera depois. */
type MissionChanges = Partial<
  Pick<Mission, 'status' | 'startedAt' | 'finishedAt' | 'worktreeId' | 'worktreePath' | 'updatedAt'>
>;
type ExecutionChanges = Partial<
  Pick<
    Execution,
    | 'status'
    | 'stepId'
    | 'agentSessionId'
    | 'agentCursor'
    | 'startedAt'
    | 'exitReason'
    | 'usage'
    | 'finishedAt'
  >
>;
type StepChanges = Partial<Pick<MissionStep, 'status' | 'startedAt' | 'finishedAt'>>;
type ApprovalChanges = Partial<Pick<ApprovalRequest, 'status' | 'decidedAt' | 'decisionNote'>>;

/**
 * Repositório de missões, execuções, aprovações e auditoria. Tem o mesmo formato que a porta
 * `MissionRepository` de `packages/application`, e a composição o liga por tipagem estrutural.
 */
export interface MissionRepository {
  insertMission(mission: Mission): void;
  getMission(id: string): Mission | undefined;
  listMissions(projectId: string): Mission[];
  updateMission(id: string, changes: MissionChanges): void;
  insertSteps(steps: MissionStep[]): void;
  listSteps(missionId: string): MissionStep[];
  replaceSteps(missionId: string, steps: MissionStep[]): void;
  updateStep(id: string, changes: StepChanges): void;
  insertExecution(execution: Execution): void;
  updateExecution(id: string, changes: ExecutionChanges): void;
  getExecution(id: string): Execution | undefined;
  listExecutions(missionId: string): Execution[];
  findExecutionsByStatus(status: ExecutionStatus): Execution[];
  insertApproval(approval: ApprovalRequest): void;
  getApproval(id: string): ApprovalRequest | undefined;
  updateApproval(id: string, changes: ApprovalChanges): void;
  listPendingApprovals(executionId: string): ApprovalRequest[];
  appendAudit(event: NewAuditEvent): AuditEvent;
  listAudit(aggregateId: string): AuditEvent[];
  /**
   * Apaga a missão com as etapas, os critérios, as tentativas, as aprovações e a auditoria dela e das
   * tentativas. Tudo na mesma transação; quem chama confere antes que a missão está encerrada.
   */
  deleteMission(id: string): void;
  transaction<T>(work: () => T): T;
}

type MissionRow = typeof missions.$inferSelect;
type ExecutionRow = typeof executions.$inferSelect;
type ApprovalRow = typeof approvalRequests.$inferSelect;
type CriterionRow = typeof missionAcceptanceCriteria.$inferSelect;
type StepRow = typeof missionSteps.$inferSelect;
type AuditRow = typeof auditEvents.$inferSelect;

function toStep(row: StepRow): MissionStep {
  const step: MissionStep = {
    id: row.id,
    missionId: row.missionId,
    position: row.position,
    title: row.title,
    description: row.description,
    kind: row.kind,
    status: row.status,
    dependsOn: row.dependsOn,
    agent: row.agent,
  };
  if (row.role !== null) step.role = row.role;
  if (row.startedAt !== null) step.startedAt = row.startedAt;
  if (row.finishedAt !== null) step.finishedAt = row.finishedAt;
  return step;
}

function toAuditEvent(row: AuditRow): AuditEvent {
  return {
    id: row.id,
    aggregateType: row.aggregateType,
    aggregateId: row.aggregateId,
    eventType: row.eventType,
    severity: row.severity,
    actor: row.actor,
    payload: row.payload,
    sequence: row.sequence,
    createdAt: row.createdAt,
  };
}

/** Campos opcionais entram só quando têm valor: o JSON e o objeto lido ficam sem chaves vazias. */
function toMission(row: MissionRow, criteria: CriterionRow[]): Mission {
  const mission: Mission = {
    id: row.id,
    projectId: row.projectId,
    title: row.title,
    objective: row.objective,
    acceptanceCriteria: criteria.map((c) => ({ id: c.id, position: c.position, text: c.text })),
    status: row.status,
    priority: row.priority,
    agentProfileId: row.agentProfileId,
    executionProfileId: row.executionProfileId,
    altersCode: row.altersCode,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
  if (row.context !== null) mission.context = row.context;
  if (row.worktreeId !== null) mission.worktreeId = row.worktreeId;
  if (row.worktreePath !== null) mission.worktreePath = row.worktreePath;
  if (row.startedAt !== null) mission.startedAt = row.startedAt;
  if (row.finishedAt !== null) mission.finishedAt = row.finishedAt;
  return mission;
}

function toExecution(row: ExecutionRow): Execution {
  const execution: Execution = {
    id: row.id,
    missionId: row.missionId,
    attempt: row.attempt,
    status: row.status,
  };
  if (row.stepId !== null) execution.stepId = row.stepId;
  if (row.agentSessionId !== null) execution.agentSessionId = row.agentSessionId;
  if (row.agentCursor !== null) execution.agentCursor = row.agentCursor;
  if (row.exitReason !== null) execution.exitReason = row.exitReason;
  if (row.usage !== null) execution.usage = row.usage;
  if (row.context !== null) execution.context = row.context;
  if (row.startedAt !== null) execution.startedAt = row.startedAt;
  if (row.finishedAt !== null) execution.finishedAt = row.finishedAt;
  return execution;
}

function toApproval(row: ApprovalRow): ApprovalRequest {
  const approval: ApprovalRequest = {
    id: row.id,
    missionId: row.missionId,
    executionId: row.executionId,
    actionType: row.actionType,
    title: row.title,
    rationale: row.rationale,
    affectedResources: row.affectedResources,
    status: row.status,
    requestedAt: row.requestedAt,
  };
  if (row.commandPreview !== null) approval.commandPreview = row.commandPreview;
  if (row.decidedAt !== null) approval.decidedAt = row.decidedAt;
  if (row.decisionNote !== null) approval.decisionNote = row.decisionNote;
  return approval;
}

export function createMissionRepository(db: AppDatabase): MissionRepository {
  function insertStepRows(steps: MissionStep[]): void {
    if (steps.length === 0) return;
    db.insert(missionSteps)
      .values(
        steps.map((step) => ({
          id: step.id,
          missionId: step.missionId,
          position: step.position,
          title: step.title,
          description: step.description,
          kind: step.kind,
          status: step.status,
          dependsOn: step.dependsOn,
          agent: step.agent,
          role: step.role ?? null,
          startedAt: step.startedAt ?? null,
          finishedAt: step.finishedAt ?? null,
        })),
      )
      .run();
  }

  const criteriaOf = (missionId: string): CriterionRow[] =>
    db
      .select()
      .from(missionAcceptanceCriteria)
      .where(eq(missionAcceptanceCriteria.missionId, missionId))
      .orderBy(asc(missionAcceptanceCriteria.position))
      .all();

  return {
    insertMission(mission) {
      db.transaction(() => {
        db.insert(missions)
          .values({
            id: mission.id,
            projectId: mission.projectId,
            title: mission.title,
            objective: mission.objective,
            context: mission.context ?? null,
            status: mission.status,
            priority: mission.priority,
            agentProfileId: mission.agentProfileId,
            executionProfileId: mission.executionProfileId,
            altersCode: mission.altersCode,
            worktreeId: mission.worktreeId ?? null,
            worktreePath: mission.worktreePath ?? null,
            createdAt: mission.createdAt,
            updatedAt: mission.updatedAt,
            startedAt: mission.startedAt ?? null,
            finishedAt: mission.finishedAt ?? null,
          })
          .run();
        if (mission.acceptanceCriteria.length > 0) {
          db.insert(missionAcceptanceCriteria)
            .values(
              mission.acceptanceCriteria.map((c) => ({
                id: c.id,
                missionId: mission.id,
                position: c.position,
                text: c.text,
              })),
            )
            .run();
        }
      });
    },

    getMission(id) {
      const row = db.select().from(missions).where(eq(missions.id, id)).get();
      return row === undefined ? undefined : toMission(row, criteriaOf(id));
    },

    listMissions(projectId) {
      return db
        .select()
        .from(missions)
        .where(eq(missions.projectId, projectId))
        .orderBy(desc(missions.updatedAt), asc(missions.id))
        .all()
        .map((row) => toMission(row, criteriaOf(row.id)));
    },

    updateMission(id, changes) {
      db.update(missions)
        .set({
          status: changes.status,
          startedAt: changes.startedAt,
          finishedAt: changes.finishedAt,
          worktreeId: changes.worktreeId,
          worktreePath: changes.worktreePath,
          updatedAt: changes.updatedAt,
        })
        .where(eq(missions.id, id))
        .run();
    },

    insertSteps: insertStepRows,

    listSteps(missionId) {
      return db
        .select()
        .from(missionSteps)
        .where(eq(missionSteps.missionId, missionId))
        .orderBy(asc(missionSteps.position))
        .all()
        .map(toStep);
    },

    replaceSteps(missionId, steps) {
      db.delete(missionSteps).where(eq(missionSteps.missionId, missionId)).run();
      insertStepRows(steps);
    },

    updateStep(id, changes) {
      db.update(missionSteps)
        .set({
          status: changes.status,
          startedAt: changes.startedAt,
          finishedAt: changes.finishedAt,
        })
        .where(eq(missionSteps.id, id))
        .run();
    },

    insertExecution(execution) {
      db.insert(executions)
        .values({
          id: execution.id,
          missionId: execution.missionId,
          attempt: execution.attempt,
          stepId: execution.stepId ?? null,
          status: execution.status,
          agentSessionId: execution.agentSessionId ?? null,
          agentCursor: execution.agentCursor ?? null,
          exitReason: execution.exitReason ?? null,
          usage: execution.usage ?? null,
          context: execution.context ?? null,
          startedAt: execution.startedAt ?? null,
          finishedAt: execution.finishedAt ?? null,
        })
        .run();
    },

    updateExecution(id, changes) {
      db.update(executions)
        .set({
          status: changes.status,
          stepId: changes.stepId,
          agentSessionId: changes.agentSessionId,
          agentCursor: changes.agentCursor,
          startedAt: changes.startedAt,
          exitReason: changes.exitReason,
          usage: changes.usage,
          context: changes.context,
          finishedAt: changes.finishedAt,
        })
        .where(eq(executions.id, id))
        .run();
    },

    getExecution(id) {
      const row = db.select().from(executions).where(eq(executions.id, id)).get();
      return row === undefined ? undefined : toExecution(row);
    },

    listExecutions(missionId) {
      return db
        .select()
        .from(executions)
        .where(eq(executions.missionId, missionId))
        .orderBy(asc(executions.attempt))
        .all()
        .map(toExecution);
    },

    findExecutionsByStatus(status) {
      return db
        .select()
        .from(executions)
        .where(eq(executions.status, status))
        .orderBy(asc(executions.startedAt))
        .all()
        .map(toExecution);
    },

    insertApproval(approval) {
      db.insert(approvalRequests)
        .values({
          id: approval.id,
          missionId: approval.missionId,
          executionId: approval.executionId,
          actionType: approval.actionType,
          title: approval.title,
          rationale: approval.rationale,
          commandPreview: approval.commandPreview ?? null,
          affectedResources: approval.affectedResources,
          status: approval.status,
          requestedAt: approval.requestedAt,
          decidedAt: approval.decidedAt ?? null,
          decisionNote: approval.decisionNote ?? null,
        })
        .run();
    },

    getApproval(id) {
      const row = db.select().from(approvalRequests).where(eq(approvalRequests.id, id)).get();
      return row === undefined ? undefined : toApproval(row);
    },

    updateApproval(id, changes) {
      db.update(approvalRequests)
        .set({
          status: changes.status,
          decidedAt: changes.decidedAt,
          decisionNote: changes.decisionNote,
        })
        .where(eq(approvalRequests.id, id))
        .run();
    },

    listPendingApprovals(executionId) {
      return db
        .select()
        .from(approvalRequests)
        .where(
          and(
            eq(approvalRequests.executionId, executionId),
            eq(approvalRequests.status, 'pending'),
          ),
        )
        .orderBy(asc(approvalRequests.requestedAt))
        .all()
        .map(toApproval);
    },

    appendAudit(event) {
      return appendAuditEvent(db, event);
    },

    listAudit(aggregateId) {
      return db
        .select()
        .from(auditEvents)
        .where(eq(auditEvents.aggregateId, aggregateId))
        .orderBy(asc(auditEvents.sequence))
        .all()
        .map(toAuditEvent);
    },

    deleteMission(id) {
      db.transaction(() => {
        const attempts = db
          .select({ id: executions.id })
          .from(executions)
          .where(eq(executions.missionId, id))
          .all()
          .map((row) => row.id);
        // Sem `ON DELETE CASCADE` em auditoria, que não tem chave estrangeira: apaga-se pelo agregado.
        for (const aggregateId of [id, ...attempts]) {
          db.delete(auditEvents).where(eq(auditEvents.aggregateId, aggregateId)).run();
        }
        db.delete(approvalRequests).where(eq(approvalRequests.missionId, id)).run();
        db.delete(executions).where(eq(executions.missionId, id)).run();
        db.delete(missionSteps).where(eq(missionSteps.missionId, id)).run();
        db.delete(missionAcceptanceCriteria)
          .where(eq(missionAcceptanceCriteria.missionId, id))
          .run();
        db.delete(missions).where(eq(missions.id, id)).run();
      });
    },

    transaction(work) {
      return db.transaction(() => work());
    },
  };
}

/**
 * Tokens de cada execução que terminou com uso gravado: entrada nova mais saída, sem o cache (a mesma
 * conta da seção "Gasto de tokens"). Execução sem `usage` ou sem `finished_at` não entra. Só leitura.
 */
export function listExecutionTokens(
  db: AppDatabase,
): Array<{ finishedAt: string; tokens: number }> {
  return db
    .select({ usage: executions.usage, finishedAt: executions.finishedAt })
    .from(executions)
    .where(and(isNotNull(executions.usage), isNotNull(executions.finishedAt)))
    .orderBy(asc(executions.finishedAt), asc(executions.id))
    .all()
    .flatMap((row) =>
      row.usage === null || row.finishedAt === null
        ? []
        : [{ finishedAt: row.finishedAt, tokens: row.usage.inputTokens + row.usage.outputTokens }],
    );
}
