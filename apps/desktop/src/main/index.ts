import { homedir } from 'node:os';
import { join } from 'node:path';
import { CHANNELS, type MissionEventDto } from '@project-hub/contracts';
import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  session,
  shell,
  type IpcMainInvokeEvent,
} from 'electron';
import { createAppServices, platformOf, resolveWorktreesRoot } from './composition';
import { chooseProjectDirectory } from './dialogs';
import { registerApprovalHandlers } from './ipc/approvals';
import { registerMissionHandlers } from './ipc/missions';
import { registerProjectHandlers } from './ipc/projects';
import { registerTrustedHandler } from './ipc/trusted-handler';
import { handleStartupFailure } from './startup-failure';
import {
  applyContentSecurityPolicy,
  denyAllPermissions,
  isTrustedSenderUrl,
  restrictFileRequests,
  restrictNavigation,
} from './security';
import { buildWebPreferences } from './window';

// Sandbox em todo renderer, mesmo que uma janela futura esqueça a opção. Precisa vir antes do ready.
app.enableSandbox();

const rendererDirectory = join(import.meta.dirname, '../renderer');
const preloadPath = join(import.meta.dirname, '../preload/index.cjs');

// Em desenvolvimento, o electron-vite serve o renderer e informa o endereço nesta variável.
// O aplicativo empacotado ignora a variável e sempre carrega os arquivos locais.
const devServerUrl = app.isPackaged ? undefined : process.env['ELECTRON_RENDERER_URL'];
const appOrigin = devServerUrl === undefined ? 'file://' : new URL(devServerUrl).origin;

/**
 * Confirmação nativa antes de abrir um endereço fora do aplicativo (seção 17.2). Mostra o endereço
 * normalizado. Cancelar é o botão padrão e também a resposta do Esc.
 */
async function confirmExternal(owner: BrowserWindow, url: string): Promise<boolean> {
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
}

/**
 * Falha de inicialização, vinda do `whenReady` ou do carregamento da janela. Sem janela, a caixa
 * nativa é a única forma de mostrar o erro, e o processo encerra com código 1.
 */
const startupFailure = {
  log: (cause: unknown) => console.error('Falha ao iniciar o aplicativo:', cause),
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

function createMainWindow(): void {
  const win = new BrowserWindow({
    width: 1200,
    height: 800,
    show: false,
    webPreferences: buildWebPreferences(preloadPath),
  });
  mainWindow = win;
  win.once('closed', () => {
    if (mainWindow === win) mainWindow = undefined;
  });
  restrictNavigation(win.webContents, appOrigin, {
    confirmExternal: (url) => confirmExternal(win, url),
    openExternal: (url) => shell.openExternal(url),
  });
  win.once('ready-to-show', () => win.show());

  const loading =
    devServerUrl === undefined
      ? win.loadFile(join(rendererDirectory, 'index.html'))
      : win.loadURL(devServerUrl);
  loading.catch((error: unknown) => {
    handleStartupFailure(error, startupFailure);
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

    const services = createAppServices({
      dbFile: join(app.getPath('userData'), 'database', 'project-hub.sqlite'),
      platform: platformOf(process.platform),
      worktreesRoot: resolveWorktreesRoot(process.env, homedir()),
      publishMissionEvent,
    });
    app.once('will-quit', () => {
      services.close();
    });

    registerTrustedHandler(ipcMain, CHANNELS.appPing, isTrustedSender, () =>
      Promise.resolve({ ok: true, data: 'pong' }),
    );
    registerProjectHandlers(ipcMain, isTrustedSender, {
      services,
      chooseDirectory: chooseProjectDirectory,
    });
    registerMissionHandlers(ipcMain, isTrustedSender, services.missions);
    registerApprovalHandlers(ipcMain, isTrustedSender, services.missions.orchestrator);
    createMainWindow();

    // macOS: reabre a janela quando o ícone do Dock é clicado sem janela aberta.
    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) {
        createMainWindow();
      }
    });
  })
  .catch((error: unknown) => {
    handleStartupFailure(error, startupFailure);
  });

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
