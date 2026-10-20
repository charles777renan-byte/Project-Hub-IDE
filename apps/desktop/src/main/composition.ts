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
