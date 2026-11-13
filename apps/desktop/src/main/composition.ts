import { randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { codexHomeOf } from '@project-hub/agent-adapters';
import {
  createOrchestrator,
  type MissionRepository,
  type OrchestratorDeps,
  type ProjectRepository,
  type AddProjectDeps,
  type CreateMissionDeps,
  type GitPanelDeps,
  type GithubPanelDeps,
  type DeleteMissionDeps,
  type ListWorktreesDeps,
  type MissionDiffDeps,
  type MissionQueryDeps,
  type Orchestrator,
  type Planner,
  type Platform,
  type ProfileDeps,
  type ProjectLifecycleDeps,
  type RemoveWorktreeDeps,
  type RepositoryInitializer,
} from '@project-hub/application';
import {
  createAppSettingsRepository,
  createMissionRepository,
  createProjectRepository,
  createTerminalSessionRepository,
  createBrowserTabRepository,
  createWorkspaceRepository,
  listExecutionTokens,
  migrateDatabase,
  openDatabase,
  type TerminalSessionRepository,
  type BrowserTabRepository,
  type WorkspaceRepository,
} from '@project-hub/database';
import type { AppTerminal, MissionTokens } from '@project-hub/domain';
import {
  buildWorktreeNames,
  createGitDetector,
  createGitPanelPort,
  createRepositoryInitializer,
  createWorktree,
  getWorktreeDiff,
  removeWorktree,
} from '@project-hub/git-adapter';
import { createDemoAgent } from './demo-agent';
import type { ProjectFilesDeps } from './files/project-files';
import { createIsDirectory, createIsInsideProject } from './filesystem';
import { createGithubPanelPort } from './github-panel-port';
import {
  withMissionEvents,
  type MissionEventPublisher,
  type MissionUsagePublisher,
} from './mission-events';

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
  /** Cria o repositório Git de uma pasta sem Git: prévia e primeiro commit, com a confirmação da pessoa (ADR 0009). */
  initializer: RepositoryInitializer;
  /** Repositórios que o serviço de terminais lê: as execuções em andamento, os projetos e as sessões de terminal. */
  terminalDeps: {
    repo: MissionRepository;
    projects: ProjectRepository;
    sessions: TerminalSessionRepository;
  };
  /** Repositórios do serviço de workspaces: os workspaces e os projetos. */
  workspaceDeps: { repo: WorkspaceRepository; projects: ProjectRepository };
  /** As abas do navegador de cada projeto, guardadas no banco. */
  browserTabs: BrowserTabRepository;
  /** Atividade por agente do Início: os terminais do app (com a pasta do projeto) e os tokens das missões. Só leitura. */
  agentActivityDeps: { terminals(): AppTerminal[]; missions(): MissionTokens[] };
  /** Perfil local: o nome da saudação, guardado nas configurações do banco. */
  profileDeps: ProfileDeps;
  /** Arquivos do projeto (painel direito): a pasta de cada projeto pelo id e a checagem de que ela existe. */
  fileDeps: ProjectFilesDeps;
  /** Painel de código-fonte (ADR 0010): o repositório de projetos, a porta de Git e a checagem de caminhos. */
  gitPanelDeps: GitPanelDeps;
  /** Aba Checks (ADR 0011): as dependências do painel de código-fonte mais a porta do `gh`. */
  githubPanelDeps: GithubPanelDeps;
  close(): void;
};

export type AppServicesOptions = {
  dbFile: string;
  platform: Platform;
  /** Pasta absoluta onde os worktrees das missões ficam (seção 16.2). */
  worktreesRoot: string;
  publishMissionEvent: MissionEventPublisher;
  /** Gasto de tokens das tentativas, pelo canal próprio. Sem ele, a tela só vê o gasto ao recarregar. */
  publishMissionUsage?: MissionUsagePublisher | undefined;
  /** Missões com agente vivo ao mesmo tempo. Sem valor, o orquestrador usa o padrão (seção 15.6). */
  maxRunningMissions?: number | undefined;
  /** Agente das missões. Sem ele, vale o agente simulado. */
  agent?: OrchestratorDeps['agent'] | undefined;
  /** Planejador das tarefas do plano. Sem ele, o plano sai com um passo por critério de aceite. */
  planner?: Planner | undefined;
  /**
   * Libera o `gh` falso dos testes (`PROJECT_HUB_GH_BIN`) no painel Checks. Sem valor, vale `false`. O
   * `index.ts` passa `!app.isPackaged`.
   */
  allowGhTestOverrides?: boolean | undefined;
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
 * Os testes de ponta a ponta podem rodar com a janela invisível (`PROJECT_HUB_E2E_HIDDEN=1`, junto com
 * `PROJECT_HUB_ENV=test`), para não abrir janelas na frente de quem os roda. Recebe o ambiente de
 * `applicationEnvironment`: no aplicativo empacotado as duas variáveis não existem, e a janela aparece.
 */
export function startsHidden(env: NodeJS.ProcessEnv): boolean {
  return env['PROJECT_HUB_ENV'] === 'test' && env['PROJECT_HUB_E2E_HIDDEN'] === '1';
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

/** Como o planejador é executado: o executável, o que vai antes dos argumentos fixos e o ambiente extra. */
export type PlannerCommand = {
  command: string;
  /** Argumentos antes dos fixos do planejador (o script do CLI falso). Vazio fora dos testes. */
  commandPrefix: string[];
  /** Variáveis somadas ao ambiente do processo (`ELECTRON_RUN_AS_NODE` do CLI falso). Vazio fora dos testes. */
  extraEnv: Record<string, string>;
  /** Verdadeiro quando um comando de teste tomou o lugar do `claude`: liga o planejador sem `APP_AGENT_ADAPTER`. */
  overridden: boolean;
};

/**
 * Comando do planejador. Só com `PROJECT_HUB_ENV=test` os ganchos de teste valem; em qualquer outro caso
 * são ignorados e vale `defaultCommand`. `APP_PLANNER_SCRIPT` (um `.mjs`) roda o próprio executável
 * (`execPath`, o Electron) como Node, com o script na frente dos argumentos fixos: o Windows não executa um
 * `.cmd` direto, e assim o CLI falso é um script portátil. `APP_PLANNER_COMMAND` troca só o executável.
 * O script vence o comando. Empacotado, as variáveis já foram retiradas por `applicationEnvironment`.
 */
export function resolvePlannerCommand(
  env: NodeJS.ProcessEnv,
  defaultCommand: string,
  execPath: string = process.execPath,
): PlannerCommand {
  const isTest = env['PROJECT_HUB_ENV'] === 'test';
  const script = isTest ? env['APP_PLANNER_SCRIPT'] : undefined;
  if (script !== undefined && script !== '') {
    return {
      command: execPath,
      commandPrefix: [script],
      extraEnv: { ELECTRON_RUN_AS_NODE: '1' },
      overridden: true,
    };
  }
  const testCommand = isTest ? env['APP_PLANNER_COMMAND'] : undefined;
  if (testCommand !== undefined && testCommand !== '') {
    return { command: testCommand, commandPrefix: [], extraEnv: {}, overridden: true };
  }
  return { command: defaultCommand, commandPrefix: [], extraEnv: {}, overridden: false };
}

/** Como o agente é executado: o executável, o que vai antes dos argumentos da sessão e o ambiente extra do terminal. */
export type AgentCommand = {
  command: string;
  /** Argumentos antes dos da sessão (o script do CLI falso). Vazio fora dos testes. */
  commandPrefix: string[];
  /** Variáveis somadas ao ambiente filtrado do terminal (`ELECTRON_RUN_AS_NODE` do CLI falso). Vazio fora dos testes. */
  extraEnv: Record<string, string>;
  /** Verdadeiro quando um comando de teste tomou o lugar do `claude`: liga o agente real sem `APP_AGENT_ADAPTER`. */
  overridden: boolean;
};

/**
 * Comando do agente das missões. Só com `PROJECT_HUB_ENV=test` o gancho `APP_AGENT_SCRIPT` vale; em qualquer
 * outro caso é ignorado e vale `defaultCommand`. O script (um `.mjs`) roda o próprio executável (`execPath`, o
 * Electron) como Node, com o script na frente dos argumentos da sessão, no mesmo padrão do planejador
 * (`resolvePlannerCommand`). O ambiente do terminal é filtrado e não deixa `ELECTRON_RUN_AS_NODE` passar, por
 * isso ele volta aqui, como variável extra. Empacotado, a variável já foi retirada por `applicationEnvironment`.
 */
export function resolveAgentCommand(
  env: NodeJS.ProcessEnv,
  defaultCommand: string,
  execPath: string = process.execPath,
): AgentCommand {
  const script = env['PROJECT_HUB_ENV'] === 'test' ? env['APP_AGENT_SCRIPT'] : undefined;
  if (script !== undefined && script !== '') {
    return {
      command: execPath,
      commandPrefix: [script],
      extraEnv: { ELECTRON_RUN_AS_NODE: '1' },
      overridden: true,
    };
  }
  return { command: defaultCommand, commandPrefix: [], extraEnv: {}, overridden: false };
}

/**
 * Script que faz o papel do `claude` do painel de terminal nos testes de ponta a ponta. Só com `PROJECT_HUB_ENV=test`
 * o gancho `APP_PANEL_CLAUDE_SCRIPT` vale; empacotado, as variáveis já foram retiradas por `applicationEnvironment`.
 */
export function resolvePanelClaudeScript(env: NodeJS.ProcessEnv): string | undefined {
  const script = env['PROJECT_HUB_ENV'] === 'test' ? env['APP_PANEL_CLAUDE_SCRIPT'] : undefined;
  return script === undefined || script === '' ? undefined : script;
}

/** Como a leitura dos limites da assinatura é executada: o executável, o que vai antes dos argumentos e o ambiente extra. */
export type LimitsCommand = {
  command: string;
  /** Argumentos antes dos fixos da sonda (o script do CLI falso). Vazio fora dos testes. */
  commandPrefix: string[];
  /** Variáveis somadas ao ambiente filtrado (`ELECTRON_RUN_AS_NODE` do CLI falso). Vazio fora dos testes. */
  extraEnv: Record<string, string>;
  /**
   * A leitura pode rodar. Falso só em teste (`PROJECT_HUB_ENV=test`) sem o gancho: cada leitura gasta cota
   * real da assinatura, e a suíte de ponta a ponta abre o app dezenas de vezes. Nesse caso o serviço fica
   * inerte e nunca lança o `claude`.
   */
  enabled: boolean;
};

/**
 * Comando da leitura dos limites. Fora de teste, vale `defaultCommand` e a leitura está ligada. Com
 * `PROJECT_HUB_ENV=test`, a leitura fica desligada, a menos que `APP_LIMITS_SCRIPT` (um `.mjs`) tome o lugar do
 * `claude`: o script roda o próprio executável (`execPath`, o Electron) como Node, com o script na frente dos
 * argumentos fixos, no mesmo padrão do planejador (`resolvePlannerCommand`). Empacotado, a variável some junto
 * com `PROJECT_HUB_ENV` em `applicationEnvironment`, e a leitura é a real.
 */
export function resolveLimitsCommand(
  env: NodeJS.ProcessEnv,
  defaultCommand: string,
  execPath: string = process.execPath,
): LimitsCommand {
  if (env['PROJECT_HUB_ENV'] !== 'test') {
    return { command: defaultCommand, commandPrefix: [], extraEnv: {}, enabled: true };
  }
  const script = env['APP_LIMITS_SCRIPT'];
  if (script !== undefined && script !== '') {
    return {
      command: execPath,
      commandPrefix: [script],
      extraEnv: { ELECTRON_RUN_AS_NODE: '1' },
      enabled: true,
    };
  }
  return { command: defaultCommand, commandPrefix: [], extraEnv: {}, enabled: false };
}

/**
 * Pasta do Codex de onde os limites são lidos. Fora de teste, `CODEX_HOME` do ambiente do processo (é um
 * caminho, não um segredo; o filtro dos terminais o descarta), ou `~/.codex`. Com `PROJECT_HUB_ENV=test`, só `PROJECT_HUB_CODEX_HOME`
 * (não vazia) vale; sem ela devolve `undefined` e o serviço do Codex fica inerte, para a suíte nunca ler a pasta
 * real da pessoa. `env` é o de `applicationEnvironment` (empacotado, `PROJECT_HUB_*` já não existe);
 * `processEnv` é o do processo.
 */
export function resolveCodexLimitsHome(
  env: NodeJS.ProcessEnv,
  processEnv: NodeJS.ProcessEnv,
): string | undefined {
  if (env['PROJECT_HUB_ENV'] === 'test') {
    const home = env['PROJECT_HUB_CODEX_HOME'];
    return home !== undefined && home !== '' ? home : undefined;
  }
  return codexHomeOf(processEnv);
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
  const terminalSessions = createTerminalSessionRepository(db);
  const repo = withMissionEvents(
    createMissionRepository(db),
    options.publishMissionEvent,
    options.publishMissionUsage,
  );
  const now = () => new Date().toISOString();
  const newId = () => randomUUID();

  const diff = { diff: (worktreePath: string) => getWorktreeDiff(worktreePath) };
  const fs = { isDirectory: createIsDirectory(), isInsideProject: createIsInsideProject() };
  const gitPanelPort = createGitPanelPort();
  const gitPanelDeps: GitPanelDeps = { repo: projects, git: gitPanelPort, fs };
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
    fs,
    ...(options.planner === undefined ? {} : { planner: options.planner }),
    now,
    newId,
  });
  // A recuperação das execuções abertas roda dentro do orquestrador (reanexa ou fecha, e anda com a fila).
  return {
    repo: projects,
    git: createGitDetector(),
    initializer: createRepositoryInitializer(),
    fs,
    gitPanelDeps,
    githubPanelDeps: {
      ...gitPanelDeps,
      github: createGithubPanelPort(gitPanelPort.originUrl, options.allowGhTestOverrides === true),
    },
    platform: options.platform,
    now,
    newId,
    lifecycle: { repo: projects, missions: repo, fs, now },
    terminalDeps: { repo, projects, sessions: terminalSessions },
    workspaceDeps: { repo: createWorkspaceRepository(db), projects },
    browserTabs: createBrowserTabRepository(db),
    agentActivityDeps: {
      terminals: () =>
        terminalSessions.listAll().flatMap((session) => {
          const project = projects.get(session.projectId);
          if (project === undefined) return [];
          const terminal: AppTerminal = {
            provider: session.provider,
            folder: project.path,
            createdAt: session.createdAt,
          };
          // Com exactOptionalPropertyTypes, terminal aberto fica sem a chave.
          if (session.closedAt !== undefined) terminal.closedAt = session.closedAt;
          return [terminal];
        }),
      missions: () => listExecutionTokens(db),
    },
    profileDeps: { settings: createAppSettingsRepository(db), now },
    fileDeps: {
      // Projeto removido conta como desconhecido; o arquivado segue com os arquivos acessíveis.
      rootOf: (projectId) => {
        const project = projects.get(projectId);
        return project === undefined || project.removedAt !== undefined ? undefined : project.path;
      },
      isDirectory: fs.isDirectory,
    },
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
      // Antes do banco: aborta o planejador que estiver rodando, para o processo `claude` não sobreviver ao app.
      orchestrator.dispose();
      db.$client.close();
    },
  };
}
