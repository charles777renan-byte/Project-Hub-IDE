import {
  BROWSER_ERROR_MESSAGES,
  type BrowserBounds,
  type BrowserLoadErrorCode,
} from '@project-hub/contracts';
import { session, WebContentsView, type BrowserWindow } from 'electron';
import {
  agentBrowserPartition,
  browserUserAgent,
  configureAgentSession,
  guardAgentContents,
} from '../../security';
import { loadErrorOf, shortcutOf } from '../page-events';
import type {
  AgentClickTarget,
  AgentConsoleEntry,
  AgentKey,
  AgentNetworkEntry,
  AgentPageFactory,
  AgentPageHandle,
} from './agent-browser';
import { buildSnapshot, type AxNode } from './agent-snapshot';
import type { SupportWindow } from './agent-window';

export type AgentPagesDeps = {
  /** A janela do app, para onde a página vai enquanto a pessoa a olha. */
  window(): BrowserWindow | undefined;
  /** A janela de apoio, onde a página vive o resto do tempo. */
  support: SupportWindow;
  /** Nome do app, para tirar o trecho dele do agente de usuário. */
  appName: string;
};

/** Quanto uma navegação pode demorar antes de a ferramenta devolver o que há. */
const LOAD_TIMEOUT_MS = 15_000;
/** Quanto uma pergunta ao depurador pode demorar. Uma captura numa página que não está sendo desenhada não volta. */
const COMMAND_TIMEOUT_MS = 10_000;
/** Entradas guardadas de console e de rede, por aba. */
const BUFFER_MAX = 200;
/** Maior texto de uma entrada de console. */
const ENTRY_MAX = 2_000;

const NO_TAB = 'A aba não existe mais.';
const NO_REF = 'Essa referência não existe mais. Peça a estrutura de novo com browser_snapshot.';
const NO_CAPTURE = 'Não foi possível capturar a página agora.';

/** Nome que o Electron dá a cada tecla em `sendInputEvent`. */
const KEY_CODES: Record<AgentKey, string> = {
  Enter: 'Enter',
  Tab: 'Tab',
  Escape: 'Escape',
  Backspace: 'Backspace',
  ArrowUp: 'Up',
  ArrowDown: 'Down',
  ArrowLeft: 'Left',
  ArrowRight: 'Right',
  PageUp: 'PageUp',
  PageDown: 'PageDown',
  Home: 'Home',
  End: 'End',
};

function errorOf(code: BrowserLoadErrorCode): { code: BrowserLoadErrorCode; message: string } {
  return { code, message: BROWSER_ERROR_MESSAGES[code] };
}

function clip(text: string): string {
  return text.length > ENTRY_MAX ? `${text.slice(0, ENTRY_MAX)}…` : text;
}

function push<T>(buffer: T[], entry: T): void {
  buffer.push(entry);
  if (buffer.length > BUFFER_MAX) buffer.splice(0, buffer.length - BUFFER_MAX);
}

const pause = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Cria as páginas de verdade dos agentes: uma `WebContentsView` por aba, na sessão de agente do projeto (só em
 * memória), sem preload, com o depurador do Chromium ligado. É pelo depurador que saem a captura, o console, a
 * rede e a estrutura; a entrada (clique, tecla) vai por `sendInputEvent`.
 *
 * A página nasce na janela de apoio e só vai para a janela do app enquanto a pessoa a olha. Ela nunca abre um
 * diálogo: `alert`, `confirm`, `prompt`, login HTTP, `mailto:` e download são descartados, e o descarte fica no
 * console da aba, para o agente saber.
 */
export function createAgentPageFactory(deps: AgentPagesDeps): AgentPageFactory {
  /** Partições cuja sessão já foi configurada: os listeners de `webRequest` são um por sessão. */
  const configured = new Set<string>();

  return (projectId, events) => {
    const partition = agentBrowserPartition(projectId);
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
      configureAgentSession(
        contents.session,
        browserUserAgent(contents.session.getUserAgent(), deps.appName),
      );
    }
    // Uma página que ninguém vê não toca som.
    contents.setAudioMuted(true);

    const consoleEntries: AgentConsoleEntry[] = [];
    const networkEntries: AgentNetworkEntry[] = [];
    /** Pedidos de rede em andamento, para dar endereço e método à falha que chegar depois. */
    const requests = new Map<string, { url: string; method: string }>();
    /** Referências da última estrutura pedida: `e12` → nó do DOM. */
    let refs = new Map<string, number>();
    let failedUrl: string | null = null;
    /** A janela do app em que a view está agora, ou `null` quando está na janela de apoio. */
    let attachedTo: BrowserWindow | null = null;

    const note = (text: string): void => {
      push(consoleEntries, { level: 'warning', text: `[navegador] ${text}` });
    };

    const load = (url: string): void => {
      failedUrl = null;
      contents.loadURL(url).catch(() => undefined);
    };

    guardAgentContents(contents, {
      // O agente não ganha uma aba que não pediu: a janela nova abre na própria aba.
      openTab: (url) => load(url),
      dropped: (what) => note(`descartado sem abrir: ${what}`),
    });
    contents.on('login', (event, _details, _authInfo, callback) => {
      event.preventDefault();
      note('descartado sem abrir: pedido de login HTTP');
      callback();
    });

    const debug = contents.debugger;
    /** Pergunta ao depurador, com tempo máximo. */
    const send = <T>(method: string, params?: Record<string, unknown>): Promise<T> => {
      if (contents.isDestroyed()) return Promise.reject(new Error(NO_TAB));
      return new Promise<T>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('tempo esgotado')), COMMAND_TIMEOUT_MS);
        debug.sendCommand(method, params).then(
          (value: unknown) => {
            clearTimeout(timer);
            resolve(value as T);
          },
          (error: unknown) => {
            clearTimeout(timer);
            reject(error instanceof Error ? error : new Error(String(error)));
          },
        );
      });
    };

    type RemoteValue = { type?: string; value?: unknown; description?: string };
    const textOf = (value: RemoteValue): string => {
      if (typeof value.value === 'string') return value.value;
      if (value.value !== undefined) return JSON.stringify(value.value);
      return value.description ?? value.type ?? '';
    };

    debug.on('message', (_event, method: string, params: Record<string, unknown>) => {
      switch (method) {
        case 'Runtime.consoleAPICalled': {
          const args = (params['args'] as RemoteValue[] | undefined) ?? [];
          push(consoleEntries, {
            level: String(params['type'] ?? 'log'),
            text: clip(args.map(textOf).join(' ')),
          });
          return;
        }
        case 'Runtime.exceptionThrown': {
          const details = params['exceptionDetails'] as
            { text?: string; exception?: RemoteValue } | undefined;
          push(consoleEntries, {
            level: 'error',
            text: clip(details?.exception?.description ?? details?.text ?? 'erro de script'),
          });
          return;
        }
        case 'Log.entryAdded': {
          const entry = params['entry'] as { level?: string; text?: string } | undefined;
          push(consoleEntries, { level: entry?.level ?? 'info', text: clip(entry?.text ?? '') });
          return;
        }
        case 'Network.requestWillBeSent': {
          const request = params['request'] as { url?: string; method?: string } | undefined;
          requests.set(String(params['requestId']), {
            url: clip(request?.url ?? ''),
            method: request?.method ?? 'GET',
          });
          if (requests.size > BUFFER_MAX * 5) {
            const oldest = requests.keys().next().value;
            if (oldest !== undefined) requests.delete(oldest);
          }
          return;
        }
        case 'Network.responseReceived': {
          const response = params['response'] as { status?: number; url?: string } | undefined;
          const status = response?.status ?? 0;
          if (status < 400) return;
          const request = requests.get(String(params['requestId']));
          push(networkEntries, {
            url: request?.url ?? clip(response?.url ?? ''),
            method: request?.method ?? 'GET',
            status,
          });
          return;
        }
        case 'Network.loadingFailed': {
          if (params['canceled'] === true) return;
          const request = requests.get(String(params['requestId']));
          if (request === undefined) return;
          push(networkEntries, { ...request, error: String(params['errorText'] ?? 'falhou') });
          return;
        }
        case 'Page.javascriptDialogOpening': {
          const type = String(params['type'] ?? 'alert');
          // Sair de uma página com `beforeunload` segue; os outros diálogos são recusados.
          const accept = type === 'beforeunload';
          if (!accept) note(`diálogo descartado: ${type}`);
          send('Page.handleJavaScriptDialog', { accept }).catch(() => undefined);
          return;
        }
        default:
      }
    });

    try {
      debug.attach('1.3');
      for (const domain of ['Page', 'Runtime', 'Log', 'Network']) {
        send(`${domain}.enable`).catch(() => undefined);
      }
    } catch (error) {
      // Sem depurador a página ainda navega e lê texto; captura, console e estrutura respondem com erro.
      console.warn('Página de agente sem depurador:', error);
    }

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
      events.onChange(failedUrl === null ? { ...snapshot(), loading: false } : { loading: false });
    });
    contents.on('did-navigate', () => {
      failedUrl = null;
      // Página nova: o que a anterior disse não vale mais.
      consoleEntries.length = 0;
      networkEntries.length = 0;
      requests.clear();
      refs = new Map();
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
    // Com a pessoa dentro da página, os atalhos do app ainda valem: ela não fica presa.
    contents.on('before-input-event', (event, input) => {
      const action = shortcutOf(input);
      if (action === undefined) return;
      event.preventDefault();
      if (action === 'reload') contents.reload();
      else if (action === 'back') contents.navigationHistory.goBack();
      else if (action === 'forward') contents.navigationHistory.goForward();
      else if (action !== 'new-tab' && action !== 'close-tab') events.onShortcut(action);
    });

    /** Dispara uma navegação e espera a página parar de carregar, falhar ou o tempo máximo. */
    const settle = (start: () => void): Promise<void> => {
      if (contents.isDestroyed()) return Promise.reject(new Error(NO_TAB));
      return new Promise<void>((resolve, reject) => {
        let done = false;
        const finish = (error?: Error): void => {
          if (done) return;
          done = true;
          clearTimeout(timer);
          if (!contents.isDestroyed()) {
            contents.off('did-stop-loading', onStop);
            contents.off('did-navigate-in-page', onStop);
            contents.off('did-fail-load', onFail);
            contents.off('destroyed', onDestroyed);
          }
          if (error === undefined) resolve();
          else reject(error);
        };
        const onStop = (): void => finish();
        const onFail = (
          _event: unknown,
          errorCode: number,
          _description: string,
          _url: string,
          isMainFrame: boolean,
        ): void => {
          if (!isMainFrame) return;
          const code = loadErrorOf(errorCode);
          if (code !== null) finish(new Error(BROWSER_ERROR_MESSAGES[code]));
        };
        const onDestroyed = (): void => finish(new Error(NO_TAB));
        contents.on('did-stop-loading', onStop);
        contents.on('did-navigate-in-page', onStop);
        contents.on('did-fail-load', onFail);
        contents.on('destroyed', onDestroyed);
        // Passou do tempo: a ferramenta devolve o que a página tem agora.
        const timer = setTimeout(() => finish(), LOAD_TIMEOUT_MS);
        try {
          start();
        } catch (error) {
          finish(error instanceof Error ? error : new Error(String(error)));
        }
      });
    };

    /** O centro, na área da página, do elemento de uma referência. Rola até ele antes. */
    const centerOf = async (ref: string): Promise<{ x: number; y: number }> => {
      const backendNodeId = refs.get(ref);
      if (backendNodeId === undefined) throw new Error(NO_REF);
      try {
        await send('DOM.scrollIntoViewIfNeeded', { backendNodeId });
        const { model } = await send<{ model: { content: number[] } }>('DOM.getBoxModel', {
          backendNodeId,
        });
        const [x1 = 0, y1 = 0, , , x3 = 0, y3 = 0] = model.content;
        return { x: Math.round((x1 + x3) / 2), y: Math.round((y1 + y3) / 2) };
      } catch {
        throw new Error(NO_REF);
      }
    };

    const clickAt = async (point: { x: number; y: number }): Promise<void> => {
      if (contents.isDestroyed()) throw new Error(NO_TAB);
      const base = { x: point.x, y: point.y, button: 'left' as const, clickCount: 1 };
      contents.sendInputEvent({ type: 'mouseMove', x: point.x, y: point.y });
      contents.sendInputEvent({ type: 'mouseDown', ...base });
      contents.sendInputEvent({ type: 'mouseUp', ...base });
      // Dá à página um instante para reagir antes de a ferramenta responder.
      await pause(100);
    };

    const detach = (): void => {
      const win = attachedTo;
      attachedTo = null;
      if (win === null || win.isDestroyed()) return;
      const hadFocus = !contents.isDestroyed() && contents.isFocused();
      win.contentView.removeChildView(view);
      if (hadFocus) win.webContents.focus();
    };

    deps.support.host(view);

    const handle: AgentPageHandle = {
      load: (url) => settle(() => load(url)),
      back: () =>
        settle(() => {
          if (!contents.navigationHistory.canGoBack()) throw new Error('Não há página anterior.');
          contents.navigationHistory.goBack();
        }),
      forward: () =>
        settle(() => {
          if (!contents.navigationHistory.canGoForward()) {
            throw new Error('Não há página seguinte.');
          }
          contents.navigationHistory.goForward();
        }),
      reload: () =>
        settle(() => {
          if (failedUrl !== null && failedUrl !== '') load(failedUrl);
          else contents.reload();
        }),
      async text() {
        const { result } = await send<{ result: { value?: unknown } }>('Runtime.evaluate', {
          expression: 'document.body ? document.body.innerText : ""',
          returnByValue: true,
        });
        return typeof result.value === 'string' ? result.value : '';
      },
      async snapshot() {
        const { nodes } = await send<{ nodes: AxNode[] }>('Accessibility.getFullAXTree');
        const built = buildSnapshot(nodes);
        refs = built.refs;
        return built.text;
      },
      async screenshot() {
        try {
          const { data } = await send<{ data: string }>('Page.captureScreenshot', {
            format: 'png',
          });
          return { mimeType: 'image/png', base64: data };
        } catch {
          throw new Error(NO_CAPTURE);
        }
      },
      async click(target: AgentClickTarget) {
        await clickAt('ref' in target ? await centerOf(target.ref) : target);
      },
      async type(text, ref) {
        if (ref !== undefined) await clickAt(await centerOf(ref));
        if (contents.isDestroyed()) throw new Error(NO_TAB);
        await contents.insertText(text);
        await pause(50);
      },
      async pressKey(key) {
        if (contents.isDestroyed()) throw new Error(NO_TAB);
        const keyCode = KEY_CODES[key];
        contents.sendInputEvent({ type: 'keyDown', keyCode });
        // O Enter só envia um formulário quando chega também como caractere.
        if (key === 'Enter') contents.sendInputEvent({ type: 'char', keyCode: '\r' });
        contents.sendInputEvent({ type: 'keyUp', keyCode });
        await pause(100);
      },
      async scroll(deltaY, ref) {
        if (ref === undefined) {
          await send('Runtime.evaluate', { expression: `window.scrollBy(0, ${String(deltaY)})` });
          return;
        }
        const backendNodeId = refs.get(ref);
        if (backendNodeId === undefined) throw new Error(NO_REF);
        try {
          const { object } = await send<{ object: { objectId?: string } }>('DOM.resolveNode', {
            backendNodeId,
          });
          await send('Runtime.callFunctionOn', {
            objectId: object.objectId,
            arguments: [{ value: deltaY }],
            // Rola o primeiro ancestral que de fato rola; sem nenhum, a página.
            functionDeclaration: `function (dy) {
              let el = this.nodeType === 1 ? this : this.parentElement;
              while (el && el.scrollHeight <= el.clientHeight) el = el.parentElement;
              (el || document.scrollingElement || document.documentElement).scrollBy(0, dy);
            }`,
          });
        } catch {
          throw new Error(NO_REF);
        }
      },
      console: () => [...consoleEntries],
      networkErrors: () => [...networkEntries],
      show(bounds: BrowserBounds) {
        const win = deps.window();
        if (win === undefined || win.isDestroyed() || contents.isDestroyed()) return;
        if (attachedTo !== win) {
          detach();
          deps.support.release(view);
          win.contentView.addChildView(view);
          attachedTo = win;
        }
        view.setBounds(bounds);
      },
      park() {
        if (attachedTo === null) return;
        detach();
        if (!contents.isDestroyed()) deps.support.host(view);
      },
      focus() {
        if (!contents.isDestroyed()) contents.focus();
      },
      destroy() {
        detach();
        deps.support.release(view);
        if (contents.isDestroyed()) return;
        try {
          if (debug.isAttached()) debug.detach();
        } catch {
          // Já solto.
        }
        contents.close();
      },
    };
    return handle;
  };
}

/** Apaga cookies, armazenamento, cache e senhas de autenticação HTTP da sessão de agente do projeto. */
export async function clearAgentSession(projectId: string): Promise<void> {
  const target = session.fromPartition(agentBrowserPartition(projectId));
  await target.clearStorageData();
  await target.clearCache();
  await target.clearAuthCache();
}
