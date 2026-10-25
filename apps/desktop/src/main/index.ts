import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { CHANNELS, type MissionEventDto, type TerminalEvent } from '@project-hub/contracts';
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
  createAppServices,
  platformOf,
  resolveDatabaseFile,
  resolveDirectoryChooser,
  resolveMaxRunning,
  resolveWorktreesRoot,
} from './composition';
import { createClaudeAgent, createTerminalBackend } from './claude-agent';
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

/** Janela principal enquanto ela existe: é a única que recebe os eventos das missões. */
let mainWindow: BrowserWindow | undefined;

/** Entrega um evento de missão ao quadro principal. Sem janela, o evento não tem para onde ir. */
function publishMissionEvent(event: MissionEventDto): void {
  const target = mainWindow;
  if (target === undefined || target.isDestroyed()) return;
  target.webContents.send(CHANNELS.missionsEvent, event);
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
    titleBarStyle: 'hidden',
    titleBarOverlay: TITLE_BAR_OVERLAY,
    icon: join(app.getAppPath(), 'build', 'icon.ico'),
    webPreferences: buildWebPreferences(preloadPath),
  });
  mainWindow = win;
  // A janela começa a fechar antes de ser destruída; o carregamento pendente rejeita nesse intervalo.
  let windowClosing = false;
  const closing = (): boolean => isClosing(win, windowClosing);
  win.once('close', () => {
    windowClosing = true;
  });
  win.once('closed', () => {
    if (mainWindow === win) mainWindow = undefined;
  });
  restrictNavigation(win.webContents, appOrigin, {
    confirmExternal: (url) => confirmExternal(win, url, closing),
    openExternal: (url) => shell.openExternal(url),
  });
  win.once('ready-to-show', () => win.show());

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
    const services = createAppServices({
      dbFile: resolveDatabaseFile(env, app.getPath('userData')),
      platform: platformOf(process.platform),
      worktreesRoot: resolveWorktreesRoot(env, homedir()),
      publishMissionEvent,
      maxRunningMissions: resolveMaxRunning(env),
      ...(process.env['APP_AGENT_ADAPTER'] === 'claude-code'
        ? { agent: createClaudeAgent(terminalOptions, terminalBackend) }
        : {}),
    });
    app.once('will-quit', () => {
      services.close();
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
    const providers = createProviderRegistry({
      env: process.env,
      platform: process.platform,
      exists: existsSync,
    });
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

    // macOS: reabre a janela quando o ícone do Dock é clicado sem janela aberta.
    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) {
        createMainWindow();
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
