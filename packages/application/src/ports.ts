import type { MissionDiffDto } from '@project-hub/contracts';
import type {
  ApprovalRequest,
  AuditEvent,
  Execution,
  ExecutionStatus,
  Mission,
  MissionStep,
  NewAuditEvent,
  NewProject,
  ProjectRecord,
} from '@project-hub/domain';

/**
 * Porta do repositório de projetos. O repositório do banco a satisfaz por tipagem estrutural, e a
 * composição do processo principal liga os dois. Este pacote não importa `@project-hub/database`.
 */
export interface ProjectRepository {
  insert(project: NewProject): void;
  get(id: string): ProjectRecord | undefined;
  /** Exclui os projetos removidos. */
  list(): ProjectRecord[];
  /** Inclui os removidos: o caminho continua ocupado enquanto o registro existir. */
  findByNormalizedPath(normalizedPath: string): ProjectRecord | undefined;
  markRemoved(id: string, removedAt: string): void;
  /**
   * Desfaz a remoção: o mesmo registro volta à lista, sem inserir outro. A pasta pode ter ganhado ou
   * perdido o Git desde o cadastro antigo, então a detecção nova substitui o tipo e a branch padrão
   * guardados (sem `defaultBranch`, a branch antiga some).
   */
  restore(
    id: string,
    updatedAt: string,
    git: { repositoryKind: 'git' | 'none'; defaultBranch?: string },
  ): void;
}

/** Diz se a pasta é um repositório Git. A implementação real é `createGitDetector`, em `@project-hub/git-adapter`. */
export interface GitDetector {
  detect(path: string): Promise<{ kind: 'git' | 'none'; defaultBranch?: string }>;
}

/** Consultas ao sistema de arquivos que os casos de uso precisam. */
export interface FileSystemPort {
  isDirectory(path: string): Promise<boolean>;
}

/**
 * Alterações de um worktree em relação ao HEAD, no formato que a tela mostra. A implementação real é
 * `getWorktreeDiff`, em `@project-hub/git-adapter`, ligada pela composição. Falha do Git rejeita com
 * um erro que traz `code`, como o `GitError`.
 */
export interface DiffPort {
  diff(worktreePath: string): Promise<MissionDiffDto>;
}

/** Campos de uma missão que a aplicação altera depois de criada. */
export type MissionChanges = Partial<
  Pick<Mission, 'status' | 'startedAt' | 'finishedAt' | 'worktreeId' | 'worktreePath' | 'updatedAt'>
>;

export type ExecutionChanges = Partial<
  Pick<Execution, 'status' | 'agentSessionId' | 'exitReason' | 'usage' | 'finishedAt'>
>;

export type ApprovalChanges = Partial<
  Pick<ApprovalRequest, 'status' | 'decidedAt' | 'decisionNote'>
>;

/**
 * Porta do repositório de missões, com a auditoria. O banco a satisfaz (seção 9.4). `appendAudit`
 * dá o `id` e o `sequence` do evento, que cresce dentro de cada `aggregateId`. `transaction` roda o
 * trabalho de uma vez: se ele lançar erro, nenhuma gravação do trabalho fica.
 */
export interface MissionRepository {
  insertMission(mission: Mission): void;
  getMission(id: string): Mission | undefined;
  /** As missões do projeto, da atualizada mais recentemente para a mais antiga. */
  listMissions(projectId: string): Mission[];
  updateMission(id: string, changes: MissionChanges): void;
  insertSteps(steps: MissionStep[]): void;
  /** As etapas do plano da missão, na ordem. */
  listSteps(missionId: string): MissionStep[];
  /** Troca o plano: apaga as etapas da missão e grava as novas, na mesma transação do chamador. */
  replaceSteps(missionId: string, steps: MissionStep[]): void;
  insertExecution(execution: Execution): void;
  updateExecution(id: string, changes: ExecutionChanges): void;
  getExecution(id: string): Execution | undefined;
  /** As tentativas da missão, da primeira para a última. */
  listExecutions(missionId: string): Execution[];
  findExecutionsByStatus(status: ExecutionStatus): Execution[];
  insertApproval(approval: ApprovalRequest): void;
  getApproval(id: string): ApprovalRequest | undefined;
  updateApproval(id: string, changes: ApprovalChanges): void;
  listPendingApprovals(executionId: string): ApprovalRequest[];
  appendAudit(event: NewAuditEvent): AuditEvent;
  /** A auditoria de um agregado, em ordem de `sequence`. */
  listAudit(aggregateId: string): AuditEvent[];
  transaction<T>(work: () => T): T;
}

/** Nomes do worktree, com a mesma forma que o `WorktreeNames` do adaptador Git (Tarefa 8). */
export type WorktreeNames = {
  missionShortId: string;
  slug: string;
  /** `ph/<missionShortId>-<slug>` */
  branch: string;
  /** `<projectSlug>/<missionShortId>-<slug>` */
  relativeDir: string;
};

/**
 * Porta de worktrees, com as formas de `createWorktree` e `removeWorktree` (Tarefa 8). A ligação
 * real fica na composição. Quando a criação falha, a implementação rejeita com um erro que traz
 * `code`, um código do contrato, como o `GitError`.
 */
export interface WorktreePort {
  create(input: {
    repoPath: string;
    worktreesRoot: string;
    names: WorktreeNames;
    baseRef: string;
  }): Promise<{ path: string; branch: string; baseCommit: string }>;
  remove(input: { repoPath: string; worktreePath: string }): Promise<void>;
}
