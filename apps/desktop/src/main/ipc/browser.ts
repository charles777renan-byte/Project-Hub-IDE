import { failure } from '@project-hub/application';
import {
  BROWSER_EXTERNAL_HTTPS_ONLY,
  CHANNELS,
  browserBoundsInputSchema,
  browserNavigateInputSchema,
  browserProjectInputSchema,
  browserTabInputSchema,
  type AppResult,
} from '@project-hub/contracts';
import type { BrowserService } from '../browser/browser-service';
import { fitsContent, toViewBounds } from '../browser/page-events';
import {
  registerTrustedHandler,
  validated,
  type IpcRegistry,
  type SenderCheck,
} from './trusted-handler';

/** O que os canais do navegador precisam além do serviço: a janela, os diálogos nativos e a sessão do projeto. */
export type BrowserIpcDeps = {
  browser: BrowserService;
  /** Tamanho da área de conteúdo da janela do app, ou `undefined` sem janela. */
  contentSize(): { width: number; height: number } | undefined;
  /** Zoom da janela do app (1 = 100%). */
  zoomFactor(): number;
  /** Pergunta, num diálogo nativo, se os dados de navegação do projeto podem ser apagados. Cancelar é o padrão. */
  confirmClear(): Promise<boolean>;
  /** Apaga cookies, armazenamento e cache da sessão do projeto. */
  clearSession(projectId: string): Promise<void>;
  /** Abre o endereço no navegador do sistema, depois da confirmação nativa que já existe. */
  openExternal(url: string): Promise<void>;
};

function isHttps(url: string | undefined): url is string {
  if (url === undefined) return false;
  try {
    return new URL(url).protocol === 'https:';
  } catch {
    return false;
  }
}

/**
 * Liga os 15 canais `browser:*`. Todos recusam remetente de outra origem (R65) e conferem a entrada com zod antes
 * de chamar o serviço. O renderer manda só ids, o texto digitado e um retângulo; quem decide o que carrega, onde a
 * página aparece e o que é apagado é o processo principal. Uma página do navegador nunca chega aqui: ela não tem
 * preload, e o remetente dela é de outra origem.
 */
export function registerBrowserHandlers(
  registry: IpcRegistry,
  isTrusted: SenderCheck,
  deps: BrowserIpcDeps,
): void {
  const { browser } = deps;
  const reg = (
    channel: string,
    run: (_event: unknown, payload: unknown) => Promise<AppResult<unknown>>,
  ) => registerTrustedHandler(registry, channel, isTrusted, run);
  const sync = <T>(result: AppResult<T>) => Promise.resolve(result);

  reg(
    CHANNELS.browserState,
    validated(browserProjectInputSchema, ({ projectId }) => sync(browser.state(projectId))),
  );
  reg(
    CHANNELS.browserOpenTab,
    validated(browserProjectInputSchema, ({ projectId }) => sync(browser.openTab(projectId))),
  );
  reg(
    CHANNELS.browserCloseTab,
    validated(browserTabInputSchema, ({ projectId, tabId }) =>
      sync(browser.closeTab(projectId, tabId)),
    ),
  );
  reg(
    CHANNELS.browserSelectTab,
    validated(browserTabInputSchema, ({ projectId, tabId }) =>
      sync(browser.selectTab(projectId, tabId)),
    ),
  );
  reg(
    CHANNELS.browserNavigate,
    validated(browserNavigateInputSchema, ({ projectId, tabId, text }) =>
      sync(browser.navigate(projectId, tabId, text)),
    ),
  );
  reg(
    CHANNELS.browserBack,
    validated(browserTabInputSchema, ({ projectId, tabId }) =>
      sync(browser.back(projectId, tabId)),
    ),
  );
  reg(
    CHANNELS.browserForward,
    validated(browserTabInputSchema, ({ projectId, tabId }) =>
      sync(browser.forward(projectId, tabId)),
    ),
  );
  reg(
    CHANNELS.browserReload,
    validated(browserTabInputSchema, ({ projectId, tabId }) =>
      sync(browser.reload(projectId, tabId)),
    ),
  );
  reg(
    CHANNELS.browserStop,
    validated(browserTabInputSchema, ({ projectId, tabId }) =>
      sync(browser.stop(projectId, tabId)),
    ),
  );

  reg(
    CHANNELS.browserSetBounds,
    validated(browserBoundsInputSchema, ({ projectId, bounds }) => {
      // O retângulo vem do renderer: só vale se cabe na área de conteúdo da janela. Fora disso, a página some,
      // em vez de cobrir outra parte do app.
      const content = deps.contentSize();
      const view = bounds === null ? null : toViewBounds(bounds, deps.zoomFactor());
      const usable =
        view !== null &&
        content !== undefined &&
        view.width > 0 &&
        view.height > 0 &&
        fitsContent(view, content);
      return sync(browser.setBounds(projectId, usable ? view : null));
    }),
  );

  reg(
    CHANNELS.browserSnapshot,
    validated(browserProjectInputSchema, ({ projectId }) => browser.snapshot(projectId)),
  );
  reg(
    CHANNELS.browserFocusPage,
    validated(browserProjectInputSchema, ({ projectId }) => sync(browser.focusPage(projectId))),
  );
  reg(
    CHANNELS.browserOpenDevtools,
    validated(browserTabInputSchema, ({ projectId, tabId }) =>
      sync(browser.openDevTools(projectId, tabId)),
    ),
  );

  reg(
    CHANNELS.browserOpenExternal,
    validated(browserTabInputSchema, async ({ projectId, tabId }) => {
      // A mesma regra dos links externos do app: só https sai para o navegador do sistema.
      const url = browser.urlOf(projectId, tabId);
      if (!isHttps(url)) return failure('VALIDATION_FAILED', BROWSER_EXTERNAL_HTTPS_ONLY);
      await deps.openExternal(url);
      return { ok: true, data: undefined };
    }),
  );

  reg(
    CHANNELS.browserClearData,
    validated(browserProjectInputSchema, async ({ projectId }) => {
      const current = browser.state(projectId);
      if (!current.ok) return current;
      if (!(await deps.confirmClear())) return current;
      // As páginas fecham antes: uma página viva regravaria cookies e armazenamento logo depois da limpeza.
      browser.forgetProject(projectId);
      await deps.clearSession(projectId);
      return browser.state(projectId);
    }),
  );
}
