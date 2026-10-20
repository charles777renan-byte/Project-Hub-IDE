import { randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import {
  createOrchestrator,
  recoverInterruptedExecutions,
  type AddProjectDeps,
  type CreateMissionDeps,
  type MissionQueryDeps,
  type Orchestrator,
  type Platform,
} from '@project-hub/application';
import {
  createMissionRepository,
  createProjectRepository,
  migrateDatabase,
  openDatabase,
} from '@project-hub/database';
import {
  buildWorktreeNames,
  createGitDetector,
  createWorktree,
  removeWorktree,
} from '@project-hub/git-adapter';
import { createDemoAgent } from './demo-agent';
import { createIsDirectory } from './filesystem';
import { withMissionEvents, type MissionEventPublisher } from './mission-events';

/** Serviços de missões: o orquestrador e as duas consultas que o IPC usa. */
export type MissionServices = {
  orchestrator: Orchestrator;
  createDeps: CreateMissionDeps;
  queryDeps: MissionQueryDeps;
};

/** Serviços do processo principal, com `close` para fechar o banco ao sair do aplicativo. */
export type AppServices = AddProjectDeps & { missions: MissionServices; close(): void };

export type AppServicesOptions = {
  dbFile: string;
  platform: Platform;
  /** Pasta absoluta onde os worktrees das missões ficam (seção 16.2). */
  worktreesRoot: string;
  publishMissionEvent: MissionEventPublisher;
};

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

  const orchestrator = createOrchestrator({
    repo,
    projects,
    worktrees: { create: createWorktree, remove: removeWorktree },
    worktreeNames: ({ missionId, title, projectName }) =>
      buildWorktreeNames({ missionId, title, projectSlug: projectName }),
    worktreesRoot: options.worktreesRoot,
    agent: createDemoAgent(),
    now,
    newId,
  });
  recoverInterruptedExecutions(repo, now);

  return {
    repo: projects,
    git: createGitDetector(),
    fs: { isDirectory: createIsDirectory() },
    platform: options.platform,
    now,
    newId,
    missions: {
      orchestrator,
      createDeps: { repo, projects, now, newId },
      queryDeps: { repo, projects },
    },
    close: () => {
      db.$client.close();
    },
  };
}
