import { join } from 'node:path';
import { BrowserWindow } from 'electron';
import type { VaultPromptMode } from './vault-prompt-channels';
import type { PromptWindowHandle } from './vault-window';
import { buildWebPreferences } from './window';

/** Altura do conteúdo em cada modo: um, dois ou três campos. */
const CONTENT_HEIGHT: Record<VaultPromptMode, number> = { unlock: 260, create: 400, change: 410 };
const CONTENT_WIDTH = 440;

export type VaultPromptWindowOptions = {
  parent: BrowserWindow | undefined;
  /** `out/preload/vault-prompt.cjs`. */
  preloadPath: string;
  /** Pasta da página em produção (a do renderer); em desenvolvimento, o endereço do servidor do Vite. */
  rendererDirectory: string;
  devServerUrl: string | undefined;
  devTools: boolean;
};

/**
 * Abre a janela da senha: modal sobre a principal, com sandbox e contexto isolado, sem Node, sem menu, sem navegar
 * para lugar nenhum e sem abrir outras janelas. A captura de tela do sistema não a mostra. A CSP é a da sessão
 * padrão, a mesma da tela principal.
 */
export function openVaultPromptWindow(
  mode: VaultPromptMode,
  options: VaultPromptWindowOptions,
): PromptWindowHandle {
  const parent =
    options.parent !== undefined && !options.parent.isDestroyed() ? options.parent : undefined;
  const win = new BrowserWindow({
    ...(parent !== undefined ? { parent, modal: true } : {}),
    width: CONTENT_WIDTH,
    height: CONTENT_HEIGHT[mode],
    useContentSize: true,
    resizable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    show: false,
    title: 'Cofre de chaves',
    backgroundColor: '#080614',
    autoHideMenuBar: true,
    webPreferences: { ...buildWebPreferences(options.preloadPath), devTools: options.devTools },
  });
  win.removeMenu();
  win.setContentProtection(true);
  win.webContents.on('will-navigate', (event) => {
    event.preventDefault();
  });
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.once('ready-to-show', () => {
    win.show();
  });

  const listeners: (() => void)[] = [];
  win.once('closed', () => {
    for (const listener of listeners) listener();
  });

  const loading =
    options.devServerUrl === undefined
      ? win.loadFile(join(options.rendererDirectory, 'vault-prompt.html'))
      : win.loadURL(new URL('vault-prompt.html', options.devServerUrl).href);
  loading.catch(() => {
    // Página que não carrega: a janela fecha, e quem pediu recebe "cancelado".
    if (!win.isDestroyed()) win.close();
  });

  return {
    webContentsId: win.webContents.id,
    close: () => {
      if (!win.isDestroyed()) win.close();
    },
    onClosed: (listener) => {
      listeners.push(listener);
    },
  };
}
