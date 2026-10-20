import type {
  ApprovalRequest,
  AuditEvent,
  Execution,
  Mission,
  MissionStep,
} from '@project-hub/domain';
import type { MissionRepository, WorktreePort } from '../src/ports';

type State = {
  missions: Map<string, Mission>;
  steps: MissionStep[];
  executions: Map<string, Execution>;
  approvals: Map<string, ApprovalRequest>;
  audit: AuditEvent[];
  ids: number;
};

export type FakeMissionRepository = MissionRepository & {
  audit(): AuditEvent[];
  steps(): MissionStep[];
  approvals(): ApprovalRequest[];
};

/**
 * Repositório de missões em memória, com o contrato do banco: `appendAudit` dá o `sequence` por
 * agregado, e `transaction` desfaz o estado inteiro quando o trabalho lança erro. Leituras devolvem
 * cópias, para que uma mutação do chamador não altere o repositório sem uma gravação.
 */
export function fakeMissionRepository(): FakeMissionRepository {
  let state: State = {
    missions: new Map(),
    steps: [],
    executions: new Map(),
    approvals: new Map(),
    audit: [],
    ids: 0,
  };
  const copy = <T>(value: T): T => structuredClone(value);

  return {
    insertMission(mission) {
      state.missions.set(mission.id, copy(mission));
    },
    getMission: (id) => copy(state.missions.get(id)),
    updateMission(id, changes) {
      const current = state.missions.get(id);
      if (current === undefined) throw new Error(`missão ausente: ${id}`);
      state.missions.set(id, { ...current, ...changes });
    },
    insertSteps(steps) {
      state.steps.push(...copy(steps));
    },
    insertExecution(execution) {
      state.executions.set(execution.id, copy(execution));
    },
    updateExecution(id, changes) {
      const current = state.executions.get(id);
      if (current === undefined) throw new Error(`execução ausente: ${id}`);
      state.executions.set(id, { ...current, ...changes });
    },
    getExecution: (id) => copy(state.executions.get(id)),
    listExecutions: (missionId) =>
      [...state.executions.values()]
        .filter((execution) => execution.missionId === missionId)
        .sort((a, b) => a.attempt - b.attempt)
        .map(copy),
    findExecutionsByStatus: (status) =>
      [...state.executions.values()].filter((e) => e.status === status).map(copy),
    insertApproval(approval) {
      state.approvals.set(approval.id, copy(approval));
    },
    getApproval: (id) => copy(state.approvals.get(id)),
    updateApproval(id, changes) {
      const current = state.approvals.get(id);
      if (current === undefined) throw new Error(`aprovação ausente: ${id}`);
      state.approvals.set(id, { ...current, ...changes });
    },
    listPendingApprovals: (executionId) =>
      [...state.approvals.values()]
        .filter((a) => a.executionId === executionId && a.status === 'pending')
        .map(copy),
    appendAudit(event) {
      const sequence = state.audit.filter((a) => a.aggregateId === event.aggregateId).length + 1;
      state.ids += 1;
      const record: AuditEvent = { ...event, id: `audit-${state.ids}`, sequence };
      state.audit.push(record);
      return copy(record);
    },
    transaction<T>(work: () => T): T {
      const snapshot = copy(state);
      try {
        return work();
      } catch (error) {
        state = snapshot;
        throw error;
      }
    },
    audit: () => copy(state.audit),
    steps: () => copy(state.steps),
    approvals: () => [...state.approvals.values()].map(copy),
  };
}

export type FakeWorktrees = WorktreePort & {
  readonly created: Parameters<WorktreePort['create']>[0][];
  readonly removed: Parameters<WorktreePort['remove']>[0][];
};

/** Porta de worktree em memória. Com `failWith`, `create` rejeita com o código dado, como o GitError. */
export function fakeWorktrees(failWith?: { code: string; message: string }): FakeWorktrees {
  const created: Parameters<WorktreePort['create']>[0][] = [];
  const removed: Parameters<WorktreePort['remove']>[0][] = [];
  return {
    created,
    removed,
    create(input) {
      if (failWith !== undefined) {
        return Promise.reject(Object.assign(new Error(failWith.message), { code: failWith.code }));
      }
      created.push(input);
      return Promise.resolve({
        path: `${input.worktreesRoot}/${input.names.relativeDir}`,
        branch: input.names.branch,
        baseCommit: 'a'.repeat(40),
      });
    },
    remove(input) {
      removed.push(input);
      return Promise.resolve();
    },
  };
}
