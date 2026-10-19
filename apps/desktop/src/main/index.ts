import { join } from 'node:path';
import { CHANNELS, type AppResult } from '@project-hub/contracts';
import { app, BrowserWindow, dialog, ipcMain, session, shell } from 'electron';
import {
  applyContentSecurityPolicy,
  denyAllPermissions,
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

function createMainWindow(): void {
  const mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    show: false,
    webPreferences: buildWebPreferences(preloadPath),
  });
  restrictNavigation(mainWindow.webContents, appOrigin, {
    confirmExternal: (url) => confirmExternal(mainWindow, url),
    openExternal: (url) => shell.openExternal(url),
  });
  mainWindow.once('ready-to-show', () => mainWindow.show());

  const loading =
    devServerUrl === undefined
      ? mainWindow.loadFile(join(rendererDirectory, 'index.html'))
      : mainWindow.loadURL(devServerUrl);
  loading.catch((error: unknown) => {
    console.error('Falha ao carregar o renderer:', error);
  });
}

app
  .whenReady()
  .then(() => {
    applyContentSecurityPolicy(session.defaultSession);
    restrictFileRequests(session.defaultSession, rendererDirectory);
    denyAllPermissions(session.defaultSession);
    ipcMain.handle(CHANNELS.appPing, (): AppResult<string> => ({ ok: true, data: 'pong' }));
    createMainWindow();

    // macOS: reabre a janela quando o ícone do Dock é clicado sem janela aberta.
    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) {
        createMainWindow();
      }
    });
  })
  .catch((error: unknown) => {
    console.error('Falha ao iniciar o aplicativo:', error);
  });

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
