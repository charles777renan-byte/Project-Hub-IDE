import type { ErrorCode, MissionDiffDto } from '@project-hub/contracts';
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
  /** Lista os arquivados, sem os removidos. */
  listArchived(): ProjectRecord[];
  archive(id: string, archivedAt: string): void;
  unarchive(id: string, updatedAt: string): void;
  setGroup(id: string, groupName: string | null, updatedAt: string): void;
  setNickname(id: string, nickname: string | null, updatedAt: string): void;
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
  Pick<
    Execution,
    | 'status'
    | 'agentSessionId'
    | 'agentCursor'
    | 'startedAt'
    | 'exitReason'
    | 'usage'
    | 'finishedAt'
  >
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
  /** Apaga a missão com as etapas, os critérios, as tentativas, as aprovações e a auditoria dela. */
  deleteMission(id: string): void;
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

/** Códigos que a porta de terminais pode devolver. Todos são códigos do contrato. */
export type TerminalErrorCode = Extract<
  ErrorCode,
  | 'TERMINAL_NOT_FOUND'
  | 'TERMINAL_ALREADY_EXISTS'
  | 'TERMINAL_EXITED'
  | 'TERMINAL_HOST_UNAVAILABLE'
  | 'PROCESS_START_FAILED'
  | 'UNKNOWN'
>;

/** Erro da porta de terminais. `code` é o código do contrato; `message` é segura para exibir. */
export class TerminalPortError extends Error {
  readonly code: TerminalErrorCode;

  constructor(code: TerminalErrorCode, message: string) {
    super(message);
    this.name = 'TerminalPortError';
    this.code = code;
  }
}

export type TerminalOpenInput = {
  id: string;
  cwd: string;
  command: string;
  args: readonly string[];
  /** Já filtrado pela lista de variáveis permitidas do app. */
  env: Readonly<Record<string, string>>;
  cols?: number;
  rows?: number;
};

export type TerminalExit = { exitCode: number; signal?: number };

export type TerminalSnapshot = { alive: boolean; exit?: TerminalExit; outputBytes?: number };

/**
 * Quem assina um terminal recebe a saída e o aviso de fim. `onRestart` chega antes de uma nova leitura
 * da saída guardada, nas reconexões e nas assinaturas repetidas: o que já foi mostrado deve ser descartado.
 */
export type TerminalSubscriber = {
  onData(data: string): void;
  onExit(exit: TerminalExit): void;
  onRestart(): void;
};

/**
 * Porta dos terminais dos agentes e dos shells. A aplicação não conhece `node-pty` nem o pipe: quem
 * implementa é o cliente do processo de terminais, no app. `snapshot` devolve undefined quando o terminal
 * não existe. As outras operações rejeitam com `TerminalPortError`.
 */
export interface TerminalPort {
  open(input: TerminalOpenInput): Promise<void>;
  write(id: string, data: string): Promise<void>;
  resize(id: string, cols: number, rows: number): Promise<void>;
  kill(id: string): Promise<void>;
  snapshot(id: string): Promise<TerminalSnapshot | undefined>;
  /**
   * Entrega a saída guardada e depois a saída ao vivo. Uma assinatura nova no mesmo id substitui a
   * anterior. Devolve a função que cancela a assinatura.
   */
  subscribe(id: string, subscriber: TerminalSubscriber): Promise<() => void>;
}
