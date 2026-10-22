import { randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import {
  createOrchestrator,
  type MissionRepository,
  type OrchestratorDeps,
  type ProjectRepository,
  type AddProjectDeps,
  type CreateMissionDeps,
  type DeleteMissionDeps,
  type ListWorktreesDeps,
  type MissionDiffDeps,
  type MissionQueryDeps,
  type Orchestrator,
  type Platform,
  type ProjectLifecycleDeps,
  type RemoveWorktreeDeps,
} from '@project-hub/application';
import {
  createMissionRepository,
  createProjectRepository,
  createTerminalSessionRepository,
  createWorkspaceRepository,
  migrateDatabase,
  openDatabase,
  type TerminalSessionRepository,
  type WorkspaceRepository,
} from '@project-hub/database';
import {
  buildWorktreeNames,
  createGitDetector,
  createWorktree,
  getWorktreeDiff,
  removeWorktree,
} from '@project-hub/git-adapter';
import { createDemoAgent } from './demo-agent';
import { createIsDirectory } from './filesystem';
import { withMissionEvents, type MissionEventPublisher } from './mission-events';

/** Serviços de missões: o orquestrador e as consultas que o IPC usa (visão, alterações e exclusão). */
export type MissionServices = {
  orchestrator: Orchestrator;
  createDeps: CreateMissionDeps;
  queryDeps: MissionQueryDeps;
  diffDeps: MissionDiffDeps;
  deleteDeps: DeleteMissionDeps;
  /** Aba Worktrees: a lista derivada das missões e a remoção protegida. */
  worktreeDeps: { list: ListWorktreesDeps; remove: RemoveWorktreeDeps };
};

/**
 * Serviços do processo principal, com `close` para fechar o banco ao sair do aplicativo. `lifecycle`
 * é o que arquivar, desarquivar e remover projetos precisa.
 */
export type AppServices = AddProjectDeps & {
  missions: MissionServices;
  lifecycle: ProjectLifecycleDeps;
  /** Repositórios que o serviço de terminais lê: as execuções em andamento, os projetos e as sessões de terminal. */
  terminalDeps: {
    repo: MissionRepository;
    projects: ProjectRepository;
    sessions: TerminalSessionRepository;
  };
  /** Repositórios do serviço de workspaces: os workspaces e os projetos. */
  workspaceDeps: { repo: WorkspaceRepository; projects: ProjectRepository };
  close(): void;
};

export type AppServicesOptions = {
  dbFile: string;
  platform: Platform;
  /** Pasta absoluta onde os worktrees das missões ficam (seção 16.2). */
  worktreesRoot: string;
  publishMissionEvent: MissionEventPublisher;
  /** Missões com agente vivo ao mesmo tempo. Sem valor, o orquestrador usa o padrão (seção 15.6). */
  maxRunningMissions?: number | undefined;
  /** Agente das missões. Sem ele, vale o agente simulado. */
  agent?: OrchestratorDeps['agent'] | undefined;
};

/**
 * Limite de missões com agente vivo, lido de `APP_MAX_RUNNING_MISSIONS`. Valor que não é inteiro positivo
 * é ignorado, e vale o padrão.
 */
export function resolveMaxRunning(env: NodeJS.ProcessEnv): number | undefined {
  const raw = env['APP_MAX_RUNNING_MISSIONS'];
  if (raw === undefined || raw === '') return undefined;
  const value = Number(raw);
  return Number.isInteger(value) && value > 0 ? value : undefined;
}

/** Plataforma do Node para o tipo que os casos de uso usam. Plataforma fora da lista conta como Linux. */
export function platformOf(value: NodeJS.Platform): Platform {
  return value === 'win32' || value === 'darwin' ? value : 'linux';
}

/**
 * Ambiente que a composição consulta para trocar pastas e o seletor de pasta (R193). Fora do
 * aplicativo empacotado, é o ambiente do processo. Empacotado, `PROJECT_HUB_DATA_DIR`,
 * `PROJECT_HUB_ENV` e `PROJECT_HUB_TEST_DIALOG_PATH` não valem: variáveis de teste não redirecionam
 * o banco nem o seletor de uma instalação. `APP_WORKTREES_ROOT` não é variável de teste, é a
 * configuração da raiz dos worktrees (R166), e continua valendo.
 */
export function applicationEnvironment(
  env: NodeJS.ProcessEnv,
  isPackaged: boolean,
): NodeJS.ProcessEnv {
  if (!isPackaged) return env;
  const worktreesRoot = env['APP_WORKTREES_ROOT'];
  return worktreesRoot === undefined ? {} : { APP_WORKTREES_ROOT: worktreesRoot };
}

/**
 * Raiz dos worktrees (R166). `APP_WORKTREES_ROOT` vence. Sem ela, `PROJECT_HUB_DATA_DIR/worktrees`
 * quando a variável de dados existe, e `<home>/ProjectHub/worktrees` nos outros casos.
 */
export function resolveWorktreesRoot(env: NodeJS.ProcessEnv, homeDir: string): string {
  const override = env['APP_WORKTREES_ROOT'];
  if (override !== undefined && override !== '') return override;
  const dataDir = env['PROJECT_HUB_DATA_DIR'];
  if (dataDir !== undefined && dataDir !== '') return join(dataDir, 'worktrees');
  return join(homeDir, 'ProjectHub', 'worktrees');
}

/**
 * Arquivo do banco (R189). `PROJECT_HUB_DATA_DIR` aponta a pasta de dados, a mesma de onde sai a
 * raiz dos worktrees: os testes de ponta a ponta usam uma pasta descartável por teste. Sem a
 * variável, o banco fica na pasta `userData` do Electron.
 */
export function resolveDatabaseFile(env: NodeJS.ProcessEnv, userDataDir: string): string {
  const dataDir = env['PROJECT_HUB_DATA_DIR'];
  const base = dataDir !== undefined && dataDir !== '' ? dataDir : userDataDir;
  return join(base, 'database', 'project-hub.sqlite');
}

/** Seletor de pasta: devolve o caminho escolhido, ou null quando a pessoa cancela. */
export type DirectoryChooser<Args extends unknown[]> = (...args: Args) => Promise<string | null>;

/**
 * Seletor de pasta dos testes de ponta a ponta (R189). Só com `PROJECT_HUB_ENV=test` e
 * `PROJECT_HUB_TEST_DIALOG_PATH` preenchida, o seletor devolve esse caminho sem abrir o diálogo
 * nativo, que o Playwright não alcança. Em qualquer outro caso, a variável do caminho é ignorada e
 * vale o seletor real. Só o seletor de pasta é trocado: nenhuma outra porta lê essas variáveis.
 */
export function resolveDirectoryChooser<Args extends unknown[]>(
  env: NodeJS.ProcessEnv,
  native: DirectoryChooser<Args>,
): DirectoryChooser<Args> {
  const testPath =
    env['PROJECT_HUB_ENV'] === 'test' ? env['PROJECT_HUB_TEST_DIALOG_PATH'] : undefined;
  if (testPath === undefined || testPath === '') return native;
  return () => Promise.resolve(testPath);
}

/**
 * Liga as portas dos casos de uso às implementações reais (composição do processo principal). Abre
 * o banco, aplica as migrações e trata as execuções que ficaram abertas antes de devolver os
 * serviços (seção 15.7). Se a migração falha, o banco é fechado antes do erro subir: no Windows, o
 * arquivo aberto não pode ser apagado nem trocado.
 */
export function createAppServices(options: AppServicesOptions): AppServices {
  mkdirSync(dirname(options.dbFile), { recursive: true });
  const db = openDatabase(options.dbFile);
  try {
    migrateDatabase(db, { filePath: options.dbFile });
  } catch (error) {
    db.$client.close();
    throw error;
  }

  const projects = createProjectRepository(db);
  const repo = withMissionEvents(createMissionRepository(db), options.publishMissionEvent);
  const now = () => new Date().toISOString();
  const newId = () => randomUUID();

  const diff = { diff: (worktreePath: string) => getWorktreeDiff(worktreePath) };
  const orchestrator = createOrchestrator({
    repo,
    projects,
    worktrees: { create: createWorktree, remove: removeWorktree },
    worktreeNames: ({ missionId, title, projectName }) =>
      buildWorktreeNames({ missionId, title, projectSlug: projectName }),
    worktreesRoot: options.worktreesRoot,
    agent: options.agent ?? createDemoAgent(),
    ...(options.maxRunningMissions === undefined ? {} : { maxRunning: options.maxRunningMissions }),
    diff,
    now,
    newId,
  });
  // A recuperação das execuções abertas roda dentro do orquestrador (reanexa ou fecha, e anda com a fila).
  const fs = { isDirectory: createIsDirectory() };
  return {
    repo: projects,
    git: createGitDetector(),
    fs,
    platform: options.platform,
    now,
    newId,
    lifecycle: { repo: projects, missions: repo, fs, now },
    terminalDeps: { repo, projects, sessions: createTerminalSessionRepository(db) },
    workspaceDeps: { repo: createWorkspaceRepository(db), projects },
    missions: {
      orchestrator,
      createDeps: { repo, projects, now, newId },
      queryDeps: { repo, projects },
      diffDeps: { repo, diff },
      deleteDeps: { repo, projects, worktrees: { remove: removeWorktree }, fs },
      worktreeDeps: {
        list: { repo, projects, fs },
        remove: { repo, projects, worktrees: { remove: removeWorktree }, fs, diff, now },
      },
    },
    close: () => {
      db.$client.close();
    },
  };
}
