import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import {
  CHANNELS,
  type LimitsDto,
  type MissionEventDto,
  type MissionUsageEventDto,
  type TerminalEvent,
} from '@project-hub/contracts';
import { getStatus } from '@project-hub/git-adapter';
import { createHash, randomUUID } from 'node:crypto';
import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  Menu,
  session,
  shell,
  type IpcMainInvokeEvent,
} from 'electron';
import {
  applicationEnvironment,
  startsHidden,
  createAppServices,
  platformOf,
  resolveAgentCommand,
  resolveDatabaseFile,
  resolveDirectoryChooser,
  resolveLimitsCommand,
  resolveMaxRunning,
  resolvePlannerCommand,
  resolveWorktreesRoot,
} from './composition';
import { createClaudeAgent, createTerminalBackend, resolveExecutable } from './claude-agent';
import { createClaudeLimitsProbe } from './claude-limits';
import { createClaudePlanner } from './claude-planner';
import { quotaExhaustedMessage } from './quota-message';
import { registerLimitsHandlers } from './ipc/limits';
import { registerAgentActivityHandlers } from './ipc/agent-activity';
import { registerFilesHandlers } from './ipc/files';
import { registerSaveAllResultHandler } from './ipc/save-all';
import { createProjectFiles } from './files/project-files';
import {
  agentActivityAgents,
  createAgentActivityService,
  createSessionReader,
  sessionSourcesOf,
} from './agent-activity';
import { registerProfileHandlers } from './ipc/profile';
import { createLimitsService } from './limits';
import { createLimitsStore } from './limits-store';
import { registerSystemHandlers } from './ipc/system';
import { createSystemUsageSampler } from './system-usage';
import { buildTerminalEnv } from '../terminal-host/env';
import { registerTerminalHandlers } from './ipc/terminals';
import { registerWorkspaceHandlers } from './ipc/workspaces';
import { createProviderRegistry } from './providers';
import { createTerminalService } from './terminals';
import { createWorkspaceService } from './workspaces';
import { chooseProjectDirectory } from './dialogs';
import { registerApprovalHandlers } from './ipc/approvals';
import { registerMissionHandlers } from './ipc/missions';
import { registerProjectHandlers } from './ipc/projects';
import { registerTrustedHandler } from './ipc/trusted-handler';
import { registerWorktreeHandlers } from './ipc/worktrees';
import { handleWindowLoadFailure } from './startup-failure';
import { createSaveBeforeClose } from './save-before-close';
import { registerUnsavedGuard, unsavedChoiceOf, type UnsavedChoice } from './unsaved-guard';
import {
  applyContentSecurityPolicy,
  confirmUnlessClosing,
  denyAllPermissions,
  isTrustedSenderUrl,
  restrictFileRequests,
  restrictNavigation,
} from './security';
import { buildWebPreferences, TITLE_BAR_OVERLAY } from './window';

// Sandbox em todo renderer, mesmo que uma janela futura esqueça a opção. Precisa vir antes do ready.
app.enableSandbox();

/**
 * Testes de ponta a ponta com a janela invisível: o Chromium reduz o ritmo de uma janela que ninguém vê
 * (temporizadores, quadros e animações), e os testes esperariam por coisas que nunca andam. Estas opções
 * mantêm o ritmo normal. Precisam vir antes do ready.
 */
const hiddenForTests = startsHidden(applicationEnvironment(process.env, app.isPackaged));
if (hiddenForTests) {
  app.commandLine.appendSwitch('disable-renderer-backgrounding');
  app.commandLine.appendSwitch('disable-backgrounding-occluded-windows');
  app.commandLine.appendSwitch('disable-features', 'CalculateNativeWinOcclusion');
}

const rendererDirectory = join(import.meta.dirname, '../renderer');
const preloadPath = join(import.meta.dirname, '../preload/index.cjs');

// Em desenvolvimento, o electron-vite serve o renderer e informa o endereço nesta variável.
// O aplicativo empacotado ignora a variável e sempre carrega os arquivos locais.
const devServerUrl = app.isPackaged ? undefined : process.env['ELECTRON_RENDERER_URL'];
const appOrigin = devServerUrl === undefined ? 'file://' : new URL(devServerUrl).origin;

/**
 * O aplicativo foi mandado sair (`before-quit`). Fica ligado até o fim do processo, e vale também
 * para uma saída pedida antes do `ready`.
 */
let quitting = false;
app.once('before-quit', () => {
  quitting = true;
});

/**
 * Fechando = saída do aplicativo em andamento, janela já em fechamento (`windowClosing`) ou
 * destruída. É o estado, e não o código do erro, que separa o fechamento de uma falha real: ao
 * fechar durante o carregamento, o Chromium rejeita com ERR_FAILED, igual a uma falha de verdade.
 */
function isClosing(win: BrowserWindow, windowClosing: boolean): boolean {
  return quitting || windowClosing || win.isDestroyed();
}

/**
 * Confirmação nativa antes de abrir um endereço fora do aplicativo (seção 17.2). Mostra o endereço
 * normalizado. Cancelar é o botão padrão e também a resposta do Esc.
 */
function confirmExternal(
  owner: BrowserWindow,
  url: string,
  closing: () => boolean,
): Promise<boolean> {
  // Um diálogo nativo aberto durante a saída seguraria o encerramento do processo.
  return confirmUnlessClosing(closing, async () => {
    const { response } = await dialog.showMessageBox(owner, {
      type: 'question',
      title: 'Project Hub',
      message: 'Abrir este endereço fora do Project Hub?',
      detail: url,
      buttons: ['Abrir', 'Cancelar'],
      defaultId: 1,
      cancelId: 1,
      noLink: true,
    });
    return response === 0;
  });
}

/**
 * Falha de inicialização, vinda do `whenReady` ou do carregamento da janela. Sem janela, a caixa
 * nativa é a única forma de mostrar o erro, e o processo encerra com código 1. Se o aplicativo já
 * está fechando, só registra (`logIgnored`): a saída em andamento termina sozinha.
 */
const startupFailure = {
  log: (cause: unknown) => console.error('Falha ao iniciar o aplicativo:', cause),
  logIgnored: (message: string) => console.warn(message),
  showError: (message: string) => dialog.showErrorBox('Project Hub', message),
  exit: (code: number) => app.exit(code),
};

/**
 * Fechar a janela com arquivo não salvo (o `beforeunload` do renderer só está ativo nesse caso). A caixa é nativa e
 * síncrona: o evento `will-prevent-unload` espera a resposta. As três respostas são as de fechar uma aba: Salvar
 * (grava tudo e só então fecha), Descartar (fecha sem gravar) e Voltar. "Voltar" é o botão padrão e também a
 * resposta do Esc e do X da caixa: só "Descartar" libera o fechamento sem gravar.
 */
function askAboutUnsavedFiles(owner: BrowserWindow): UnsavedChoice {
  const response = dialog.showMessageBoxSync(owner, {
    type: 'warning',
    title: 'Project Hub',
    message: 'Há arquivos com alterações não salvas.',
    detail: 'Salvar grava todos e fecha a janela. Descartar fecha sem gravar.',
    buttons: ['Salvar', 'Descartar', 'Voltar'],
    defaultId: 2,
    cancelId: 2,
    noLink: true,
  });
  return unsavedChoiceOf(response);
}

/**
 * "Salvar" ao fechar que não gravou tudo: a janela continua aberta e a caixa nativa avisa, porque o arquivo que
 * falhou pode estar em outra aba ou outro projeto. Sem nome de arquivo nem caminho no texto. Não bloqueia nada.
 */
function notifySaveFailed(owner: BrowserWindow): Promise<unknown> {
  return dialog
    .showMessageBox(owner, {
      type: 'warning',
      title: 'Project Hub',
      message: 'Não foi possível salvar todos os arquivos.',
      detail: 'A janela continua aberta; veja a aba com o aviso.',
      buttons: ['OK'],
      defaultId: 0,
      cancelId: 0,
      noLink: true,
    })
    .catch(() => undefined);
}

/** O "Salvar" ao fechar a janela, da janela principal que existe agora (o resultado chega por `files:save-all-result:v1`). */
let saveBeforeClose: ReturnType<typeof createSaveBeforeClose> | undefined;

/** Janela principal enquanto ela existe: é a única que recebe os eventos das missões. */
let mainWindow: BrowserWindow | undefined;

/** Entrega um evento de missão ao quadro principal. Sem janela, o evento não tem para onde ir. */
function publishMissionEvent(event: MissionEventDto): void {
  const target = mainWindow;
  if (target === undefined || target.isDestroyed()) return;
  target.webContents.send(CHANNELS.missionsEvent, event);
}

/** Entrega o gasto de tokens de uma tentativa ao quadro principal. */
function publishMissionUsage(event: MissionUsageEventDto): void {
  const target = mainWindow;
  if (target === undefined || target.isDestroyed()) return;
  target.webContents.send(CHANNELS.missionsUsage, event);
}

/** Entrega o estado dos limites da assinatura ao quadro principal. */
function publishLimitsEvent(limits: LimitsDto): void {
  const target = mainWindow;
  if (target === undefined || target.isDestroyed()) return;
  target.webContents.send(CHANNELS.limitsEvent, limits);
}

/** Entrega um evento de terminal ao quadro principal. */
function publishTerminalEvent(event: TerminalEvent): void {
  const target = mainWindow;
  if (target === undefined || target.isDestroyed()) return;
  target.webContents.send(CHANNELS.terminalsEvent, event);
}

function createMainWindow(): void {
  const win = new BrowserWindow({
    width: 1200,
    height: 800,
    show: false,
    // Nos testes de ponta a ponta, a janela é transparente e fora da barra de tarefas.
    ...(hiddenForTests ? { opacity: 0, skipTaskbar: true } : {}),
    titleBarStyle: 'hidden',
    titleBarOverlay: TITLE_BAR_OVERLAY,
    icon: join(app.getAppPath(), 'build', 'icon.ico'),
    webPreferences: {
      ...buildWebPreferences(preloadPath),
      ...(hiddenForTests ? { backgroundThrottling: false } : {}),
    },
  });
  mainWindow = win;
  // A janela começa a fechar antes de ser destruída; o carregamento pendente rejeita nesse intervalo.
  let windowClosing = false;
  const closing = (): boolean => isClosing(win, windowClosing);
  // `on`, e não `once`: se a pessoa voltar da pergunta de arquivo não salvo, o próximo fechamento marca de novo.
  win.on('close', () => {
    windowClosing = true;
  });
  win.once('closed', () => {
    if (mainWindow === win) mainWindow = undefined;
  });
  // "Salvar": o renderer grava os arquivos sujos e responde; a janela só fecha se tudo foi gravado e nada ficou sujo.
  const saving = createSaveBeforeClose({
    requestSave: (requestId) => {
      if (!win.isDestroyed()) win.webContents.send(CHANNELS.filesSaveAllRequest, { requestId });
    },
    closeWindow: () => {
      if (!win.isDestroyed()) win.close();
    },
    // A falha pode ser de um arquivo que não está à vista: a janela fica aberta, e a caixa avisa sem bloquear nada.
    notifyFailure: () => {
      if (closing()) return;
      void notifySaveFailed(win);
    },
  });
  saveBeforeClose = saving;
  registerUnsavedGuard(win.webContents, () => askAboutUnsavedFiles(win), {
    // "Voltar" e "Salvar" cancelam o fechamento: sem desfazer a marca, os links externos seriam recusados em silêncio.
    onStay: () => {
      windowClosing = false;
    },
    onSave: () => saving.start(),
    // Um Voltar ou Descartar depois de um Salvar lento vale mais que o resultado dele: a janela não fecha por ele.
    onCancelSave: () => saving.cancel(),
  });
  restrictNavigation(win.webContents, appOrigin, {
    confirmExternal: (url) => confirmExternal(win, url, closing),
    openExternal: (url) => shell.openExternal(url),
  });
  // Nos testes de ponta a ponta, a janela é mostrada sem tomar o foco, transparente e sem receber o mouse:
  // ela renderiza e anima de verdade (uma janela escondida não recebe quadros, e as transições nunca andariam)
  // e tem o tamanho de uma janela comum, mas ninguém a vê nem esbarra nela. O Playwright age pelo protocolo
  // do navegador, não pelo mouse do sistema.
  win.once('ready-to-show', () => {
    if (!hiddenForTests) {
      win.show();
      return;
    }
    win.setIgnoreMouseEvents(true);
    win.showInactive();
  });

  const loading =
    devServerUrl === undefined
      ? win.loadFile(join(rendererDirectory, 'index.html'))
      : win.loadURL(devServerUrl);
  loading.catch((error: unknown) => {
    handleWindowLoadFailure(error, { closing: closing() }, startupFailure);
  });
}

/** Todo canal IPC confere o remetente antes de responder: só o quadro do aplicativo passa. */
const isTrustedSender = (event: IpcMainInvokeEvent): boolean =>
  isTrustedSenderUrl(event.senderFrame?.url ?? '', appOrigin, rendererDirectory);

app
  .whenReady()
  .then(() => {
    applyContentSecurityPolicy(session.defaultSession);
    restrictFileRequests(session.defaultSession, rendererDirectory);
    denyAllPermissions(session.defaultSession);
    // Sem o menu padrão do Electron (File, Edit, View, Window): a janela mostra só o quadro do app.
    Menu.setApplicationMenu(null);

    // Empacotado, o ambiente do processo não troca a pasta de dados nem o seletor (R193).
    const env = applicationEnvironment(process.env, app.isPackaged);
    const testDataDir = env['PROJECT_HUB_ENV'] === 'test' ? env['PROJECT_HUB_DATA_DIR'] : undefined;
    const terminalOptions = {
      dataDir: testDataDir ?? app.getPath('userData'),
      // Em teste, cada pasta de dados tem o seu pipe e o processo de terminais encerra logo ao ficar ocioso.
      ...(testDataDir === undefined
        ? {}
        : {
            pipeName: 'teste-' + createHash('sha1').update(testDataDir).digest('hex').slice(0, 12),
            idleTimeoutMs: 3_000,
          }),
      hostEntry: join(import.meta.dirname, 'terminal-host.js'),
      execPath: process.execPath,
      env: process.env,
    };
    const terminalBackend = createTerminalBackend(terminalOptions);
    // Planejador do Claude Code: o PATH e o ambiente filtrado são os do agente (process.env, como em
    // `terminalOptions`), e não o `env` da aplicação, que empacotado vem sem o PATH. Em teste, um CLI falso
    // (`APP_PLANNER_COMMAND` ou `APP_PLANNER_SCRIPT`) liga o planejador mesmo sem `APP_AGENT_ADAPTER`.
    const plannerCommand = resolvePlannerCommand(env, resolveExecutable('claude', process.env));
    const planner =
      process.env['APP_AGENT_ADAPTER'] === 'claude-code' || plannerCommand.overridden
        ? createClaudePlanner({
            command: plannerCommand.command,
            commandPrefix: plannerCommand.commandPrefix,
            env: buildTerminalEnv(process.env),
            extraEnv: plannerCommand.extraEnv,
            // Cota esgotada: a falha do planejador diz a hora da renovação, lida do último estado dos limites.
            quotaMessage: () => quotaExhaustedMessage(limits.get(), new Date()),
          })
        : undefined;
    // Agente das missões: o Claude Code real com `APP_AGENT_ADAPTER=claude-code`. Em teste, um CLI falso
    // (`APP_AGENT_SCRIPT`) toma o lugar do `claude` e liga o agente real mesmo sem a variável; o planejador
    // não segue essa ligação, só os ganchos dele (`APP_PLANNER_*`).
    const agentCommand = resolveAgentCommand(env, resolveExecutable('claude', process.env));
    const services = createAppServices({
      dbFile: resolveDatabaseFile(env, app.getPath('userData')),
      platform: platformOf(process.platform),
      worktreesRoot: resolveWorktreesRoot(env, homedir()),
      publishMissionEvent,
      publishMissionUsage,
      maxRunningMissions: resolveMaxRunning(env),
      ...(process.env['APP_AGENT_ADAPTER'] === 'claude-code' || agentCommand.overridden
        ? {
            agent: createClaudeAgent(
              {
                ...terminalOptions,
                command: agentCommand.command,
                commandPrefix: agentCommand.commandPrefix,
                extraEnv: agentCommand.extraEnv,
              },
              terminalBackend,
            ),
          }
        : {}),
      planner,
    });
    app.once('will-quit', () => {
      services.close();
    });

    // Limites da assinatura: lidos rodando o próprio `claude` do usuário, com o ambiente filtrado dos terminais
    // (que passa o login). Em teste, sem o gancho `APP_LIMITS_SCRIPT`, a sonda nem é criada: cada leitura gasta
    // cota real, e o serviço fica inerte. A leitura automática só roda com a janela principal à vista.
    const limitsDir = testDataDir ?? app.getPath('userData');
    const limitsCommand = resolveLimitsCommand(env, resolveExecutable('claude', process.env));
    const limits = createLimitsService({
      probe: limitsCommand.enabled
        ? createClaudeLimitsProbe({
            command: limitsCommand.command,
            commandPrefix: limitsCommand.commandPrefix,
            env: buildTerminalEnv(process.env),
            extraEnv: limitsCommand.extraEnv,
            cwd: join(limitsDir, 'limits-probe'),
          })
        : undefined,
      store: createLimitsStore(join(limitsDir, 'limits.json')),
      publish: publishLimitsEvent,
      isActive: () =>
        mainWindow !== undefined && !mainWindow.isDestroyed() && !mainWindow.isMinimized(),
    });
    // Para o timer e mata a leitura em andamento, para o `claude` filho não sobreviver ao app.
    app.once('will-quit', () => {
      limits.dispose();
    });

    registerTrustedHandler(ipcMain, CHANNELS.appPing, isTrustedSender, () =>
      Promise.resolve({ ok: true, data: 'pong' }),
    );
    registerProjectHandlers(ipcMain, isTrustedSender, {
      services,
      lifecycle: services.lifecycle,
      chooseDirectory: resolveDirectoryChooser(env, chooseProjectDirectory),
      openFolder: (path) => shell.openPath(path),
    });
    registerMissionHandlers(ipcMain, isTrustedSender, services.missions);
    registerApprovalHandlers(ipcMain, isTrustedSender, services.missions.orchestrator);
    registerWorktreeHandlers(ipcMain, isTrustedSender, services.missions.worktreeDeps);
    registerFilesHandlers(ipcMain, isTrustedSender, {
      files: createProjectFiles(services.fileDeps),
      openPath: (path) => shell.openPath(path),
    });
    registerSaveAllResultHandler(ipcMain, isTrustedSender, (requestId, saved) =>
      saveBeforeClose?.finish(requestId, saved),
    );
    registerProfileHandlers(ipcMain, isTrustedSender, services.profileDeps);
    registerSystemHandlers(ipcMain, isTrustedSender, createSystemUsageSampler());
    registerLimitsHandlers(ipcMain, isTrustedSender, limits);
    const providers = createProviderRegistry({
      env: process.env,
      platform: process.platform,
      exists: existsSync,
    });
    // Início "Visão geral": uso por agente, só do que o app abriu. Lê as sessões dos CLIs com o mesmo ambiente
    // filtrado que os terminais recebem, fora do evento do IPC, e guarda o resultado por 60 s.
    registerAgentActivityHandlers(
      ipcMain,
      isTrustedSender,
      createAgentActivityService({
        terminals: services.agentActivityDeps.terminals,
        missions: services.agentActivityDeps.missions,
        readSessions: createSessionReader({
          terminals: services.agentActivityDeps.terminals,
          ...sessionSourcesOf(process.env),
        }),
        agents: agentActivityAgents(providers.list()),
        now: () => new Date().toISOString(),
        caseInsensitive: process.platform === 'win32',
      }),
    );
    const terminalService = createTerminalService({
      port: terminalBackend.port,
      repo: services.terminalDeps.repo,
      projects: services.terminalDeps.projects,
      sessions: services.terminalDeps.sessions,
      providers,
      publish: publishTerminalEvent,
      countChanges: (folder) =>
        getStatus(folder).then(
          (status) => status.changedFiles,
          () => undefined,
        ),
      env: process.env,
      newId: randomUUID,
      now: () => new Date().toISOString(),
      // Os painéis do Claude Code usam o mesmo receptor e a mesma pasta de configuração da missão.
      hooks: terminalBackend.hooks,
      settingsDir: join(terminalOptions.dataDir, 'terminal-host', 'settings'),
    });
    registerTerminalHandlers(ipcMain, isTrustedSender, terminalService);
    registerWorkspaceHandlers(
      ipcMain,
      isTrustedSender,
      createWorkspaceService({
        repo: services.workspaceDeps.repo,
        projects: services.workspaceDeps.projects,
        terminals: terminalService,
        now: () => new Date().toISOString(),
        newId: randomUUID,
      }),
      providers,
    );
    createMainWindow();
    limits.start();

    // macOS: reabre a janela quando o ícone do Dock é clicado sem janela aberta.
    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) {
        createMainWindow();
        limits.start();
      }
    });
  })
  .catch((error: unknown) => {
    handleWindowLoadFailure(error, { closing: quitting }, startupFailure);
  });

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
