import { BROWSER_ERROR_MESSAGES, type BrowserLoadErrorCode } from '@project-hub/contracts';
import { session, WebContentsView, type BrowserWindow } from 'electron';
import {
  browserPartition,
  browserUserAgent,
  configureBrowserSession,
  guardBrowserContents,
  type ExternalLinks,
} from '../security';
import type { PageFactory, PageHandle } from './browser-service';
import { loadErrorOf, shortcutOf } from './page-events';

export type BrowserViewsDeps = {
  /** A janela do app, onde as páginas aparecem. Sem janela, a página existe mas não é mostrada. */
  window(): BrowserWindow | undefined;
  external: ExternalLinks;
  /** Nome do app, para tirar o trecho dele do agente de usuário. */
  appName: string;
};

function errorOf(code: BrowserLoadErrorCode): { code: BrowserLoadErrorCode; message: string } {
  return { code, message: BROWSER_ERROR_MESSAGES[code] };
}

/**
 * Cria as páginas de verdade do navegador: uma `WebContentsView` por aba, na sessão do projeto, sem preload e sem
 * nenhum canal com o app. A página é de outro mundo: sandbox, isolamento de contexto e sem Node. O que ela pode
 * carregar e para onde pode navegar está em security.ts (`configureBrowserSession` e `guardBrowserContents`).
 */
export function createPageFactory(deps: BrowserViewsDeps): PageFactory {
  /** Partições cuja sessão já foi configurada: os listeners de `webRequest` são um por sessão. */
  const configured = new Set<string>();

  return (projectId, events) => {
    const partition = browserPartition(projectId);
    const view = new WebContentsView({
      webPreferences: {
        partition,
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: true,
        webSecurity: true,
      },
    });
    const contents = view.webContents;
    if (!configured.has(partition)) {
      configured.add(partition);
      configureBrowserSession(
        contents.session,
        browserUserAgent(contents.session.getUserAgent(), deps.appName),
      );
    }
    guardBrowserContents(contents, { external: deps.external, openTab: events.onOpenTab });

    /** O endereço cuja carga falhou. Enquanto existir, "recarregar" tenta esse endereço de novo. */
    let failedUrl: string | null = null;
    /** A janela em que a view está agora. Uma janela nova (macOS, depois de fechar a anterior) recebe a view de novo. */
    let attachedTo: BrowserWindow | null = null;

    /** O que a página mostra agora. Sem endereço confirmado (carga que ainda não chegou), o endereço não muda. */
    const snapshot = () => {
      const url = contents.getURL();
      return {
        ...(url === '' ? {} : { url }),
        title: contents.getTitle(),
        canGoBack: contents.navigationHistory.canGoBack(),
        canGoForward: contents.navigationHistory.canGoForward(),
      };
    };

    contents.on('did-start-loading', () => {
      events.onChange({ loading: true, error: null });
    });
    contents.on('did-stop-loading', () => {
      // Depois de uma falha, o título e o endereço da página são os da tentativa anterior: fica o que a falha disse.
      events.onChange(failedUrl === null ? { ...snapshot(), loading: false } : { loading: false });
    });
    contents.on('did-navigate', () => {
      failedUrl = null;
      events.onChange({ ...snapshot(), error: null });
    });
    contents.on('did-navigate-in-page', (_event, _url, isMainFrame) => {
      if (isMainFrame) events.onChange(snapshot());
    });
    contents.on('page-title-updated', () => {
      if (failedUrl === null) events.onChange({ title: contents.getTitle() });
    });
    contents.on('did-fail-load', (_event, errorCode, _description, validatedURL, isMainFrame) => {
      if (!isMainFrame) return;
      const code = loadErrorOf(errorCode);
      if (code === null) return;
      failedUrl = validatedURL;
      events.onChange({
        ...(validatedURL === '' ? {} : { url: validatedURL }),
        title: '',
        error: errorOf(code),
        loading: false,
      });
    });
    contents.on('render-process-gone', (_event, details) => {
      if (details.reason === 'clean-exit') return;
      events.onChange({ error: errorOf('CRASHED'), loading: false });
    });
    contents.on('before-input-event', (event, input) => {
      const action = shortcutOf(input);
      if (action === undefined) return;
      event.preventDefault();
      events.onShortcut(action);
    });

    const detach = (): void => {
      const win = attachedTo;
      attachedTo = null;
      if (win === null || win.isDestroyed()) return;
      // A página que sai de vista com o foco dentro dela o devolve ao app: sem isso, o teclado ficaria falando com
      // uma página que ninguém vê.
      const hadFocus = !contents.isDestroyed() && contents.isFocused();
      win.contentView.removeChildView(view);
      if (hadFocus) win.webContents.focus();
    };

    const live = (run: () => void): void => {
      if (!contents.isDestroyed()) run();
    };

    const load = (url: string): void => {
      failedUrl = null;
      // A falha chega pelo `did-fail-load`; a promessa rejeitada é a mesma notícia.
      contents.loadURL(url).catch(() => undefined);
    };

    const handle: PageHandle = {
      load: (url) => live(() => load(url)),
      back: () => live(() => contents.navigationHistory.goBack()),
      forward: () => live(() => contents.navigationHistory.goForward()),
      reload: () =>
        live(() => {
          if (failedUrl !== null && failedUrl !== '') load(failedUrl);
          else contents.reload();
        }),
      stop: () => live(() => contents.stop()),
      setBounds: (bounds) => view.setBounds(bounds),
      setVisible(visible) {
        if (!visible) {
          detach();
          return;
        }
        const win = deps.window();
        if (win === undefined || win.isDestroyed()) return;
        if (attachedTo === win) return;
        detach();
        win.contentView.addChildView(view);
        attachedTo = win;
      },
      setMuted: (muted) => live(() => contents.setAudioMuted(muted)),
      async capture() {
        if (contents.isDestroyed()) return null;
        try {
          const image = await contents.capturePage();
          return image.isEmpty() ? null : image.toDataURL();
        } catch {
          return null;
        }
      },
      focus: () => live(() => contents.focus()),
      openDevTools: () => live(() => contents.openDevTools({ mode: 'detach' })),
      destroy() {
        detach();
        live(() => contents.close());
      },
    };
    return handle;
  };
}

/** Apaga cookies, armazenamento, cache e senhas de autenticação HTTP da sessão do projeto. */
export async function clearBrowserSession(projectId: string): Promise<void> {
  const target = session.fromPartition(browserPartition(projectId));
  await target.clearStorageData();
  await target.clearCache();
  await target.clearAuthCache();
}
