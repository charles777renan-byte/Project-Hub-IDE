import { failure } from '@project-hub/application';
import {
  BROWSER_EXTERNAL_HTTPS_ONLY,
  CHANNELS,
  browserBoundsInputSchema,
  browserNavigateInputSchema,
  browserProjectInputSchema,
  browserTabInputSchema,
  type AppResult,
  type BrowserAgentAccessDto,
  type BrowserStateDto,
} from '@project-hub/contracts';
import type { AgentBrowser } from '../browser/agent/agent-browser';
import type { BrowserService } from '../browser/browser-service';
import { composeBrowserState } from '../browser/browser-state';
import { fitsContent, toViewBounds } from '../browser/page-events';
import {
  registerTrustedHandler,
  validated,
  type IpcRegistry,
  type SenderCheck,
} from './trusted-handler';

/** O que os canais usam do serviço das abas dos agentes: só as chamadas da tela. */
export type BrowserIpcAgent = Pick<
  AgentBrowser,
  | 'tabsOf'
  | 'owns'
  | 'lookingAt'
  | 'lookAt'
  | 'setBounds'
  | 'closeByPerson'
  | 'navigateByPerson'
  | 'stepByPerson'
  | 'focusPage'
  | 'urlOf'
  | 'snapshotByPerson'
  | 'forgetProject'
>;

/** O que os canais do navegador precisam além do serviço: a janela, os diálogos nativos e a sessão do projeto. */
export type BrowserIpcDeps = {
  browser: BrowserService;
  /** As abas dos agentes do projeto, que a pessoa vê e pode fechar ou navegar. */
  agent: BrowserIpcAgent;
  /** Tamanho da área de conteúdo da janela do app, ou `undefined` sem janela. */
  contentSize(): { width: number; height: number } | undefined;
  /** Zoom da janela do app (1 = 100%). */
  zoomFactor(): number;
  /** Pergunta, num diálogo nativo, se os dados de navegação do projeto podem ser apagados. Cancelar é o padrão. */
  confirmClear(): Promise<boolean>;
  /** Apaga cookies, armazenamento e cache da sessão do projeto. */
  clearSession(projectId: string): Promise<void>;
  /** Apaga a sessão dos agentes do projeto. */
  clearAgentSession(projectId: string): Promise<void>;
  /** Quais programas recebem o navegador ao abrir um terminal. Só rótulos e sim ou não. */
  agentAccess(): BrowserAgentAccessDto;
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

const DONE: AppResult<undefined> = { ok: true, data: undefined };
const NOT_ON_AGENT_TAB = 'Esta ação não vale para a aba de um agente.';

/**
 * Liga os 16 canais `browser:*`. Todos recusam remetente de outra origem (R65) e conferem a entrada com zod antes
 * de chamar o serviço. O renderer manda só ids, o texto digitado e um retângulo; quem decide o que carrega, onde a
 * página aparece e o que é apagado é o processo principal. Uma página do navegador nunca chega aqui: ela não tem
 * preload, e o remetente dela é de outra origem.
 *
 * A tela mostra as abas da pessoa e as dos agentes numa lista só. O id da aba diz de quem ela é: a de um agente vai
 * para o serviço dos agentes, a da pessoa segue o caminho de sempre. O endereço do servidor de ferramentas e o
 * token dos terminais não passam por nenhum canal.
 */
export function registerBrowserHandlers(
  registry: IpcRegistry,
  isTrusted: SenderCheck,
  deps: BrowserIpcDeps,
): void {
  const { browser, agent } = deps;
  const reg = (
    channel: string,
    run: (_event: unknown, payload: unknown) => Promise<AppResult<unknown>>,
  ) => registerTrustedHandler(registry, channel, isTrusted, run);
  const sync = <T>(result: AppResult<T>) => Promise.resolve(result);
  /** O estado com as abas dos agentes juntas. */
  const composed = (result: AppResult<BrowserStateDto>): AppResult<BrowserStateDto> =>
    result.ok ? { ok: true, data: composeBrowserState(result.data, agent) } : result;
  /** A página da pessoa sai de vista enquanto ela olha uma aba de agente, e volta quando deixa de olhar. */
  const applyYield = (projectId: string): void =>
    browser.setYielded(projectId, agent.lookingAt(projectId) !== null);
  /** A pessoa voltou para as abas dela. */
  const lookAway = (projectId: string): void => {
    agent.lookAt(projectId, null);
    applyYield(projectId);
  };

  reg(
    CHANNELS.browserState,
    validated(browserProjectInputSchema, ({ projectId }) =>
      sync(composed(browser.state(projectId))),
    ),
  );
  reg(
    CHANNELS.browserOpenTab,
    validated(browserProjectInputSchema, ({ projectId }) => {
      const opened = browser.openTab(projectId);
      // A aba nova é a ativa: a pessoa passa a olhar para ela.
      if (opened.ok) lookAway(projectId);
      return sync(composed(opened.ok ? browser.state(projectId) : opened));
    }),
  );
  reg(
    CHANNELS.browserCloseTab,
    validated(browserTabInputSchema, ({ projectId, tabId }) => {
      if (!agent.owns(projectId, tabId)) return sync(composed(browser.closeTab(projectId, tabId)));
      agent.closeByPerson(projectId, tabId);
      applyYield(projectId);
      return sync(composed(browser.state(projectId)));
    }),
  );
  reg(
    CHANNELS.browserSelectTab,
    validated(browserTabInputSchema, ({ projectId, tabId }) => {
      if (!agent.owns(projectId, tabId)) {
        lookAway(projectId);
        return sync(composed(browser.selectTab(projectId, tabId)));
      }
      const current = browser.state(projectId);
      if (!current.ok) return sync(current);
      agent.lookAt(projectId, tabId);
      applyYield(projectId);
      return sync(composed(current));
    }),
  );
  reg(
    CHANNELS.browserNavigate,
    validated(browserNavigateInputSchema, ({ projectId, tabId, text }) => {
      if (!agent.owns(projectId, tabId)) {
        return sync(composed(browser.navigate(projectId, tabId, text)));
      }
      const went = agent.navigateByPerson(projectId, tabId, text);
      return sync(went.ok ? composed(browser.state(projectId)) : went);
    }),
  );

  const step = (
    channel: string,
    action: 'back' | 'forward' | 'reload',
    person: (projectId: string, tabId: string) => AppResult<undefined>,
  ): void =>
    reg(
      channel,
      validated(browserTabInputSchema, ({ projectId, tabId }) => {
        if (!agent.owns(projectId, tabId)) return sync(person(projectId, tabId));
        agent.stepByPerson(projectId, tabId, action);
        return sync(DONE);
      }),
    );
  step(CHANNELS.browserBack, 'back', browser.back);
  step(CHANNELS.browserForward, 'forward', browser.forward);
  step(CHANNELS.browserReload, 'reload', browser.reload);

  reg(
    CHANNELS.browserStop,
    validated(browserTabInputSchema, ({ projectId, tabId }) =>
      sync(
        agent.owns(projectId, tabId)
          ? failure('VALIDATION_FAILED', NOT_ON_AGENT_TAB)
          : browser.stop(projectId, tabId),
      ),
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
      const placed = browser.setBounds(projectId, usable ? view : null);
      // O mesmo lugar vale para a aba de agente que a pessoa olha. Projeto que não existe não chega lá.
      if (placed.ok) agent.setBounds(projectId, usable ? view : null);
      return sync(placed);
    }),
  );

  reg(
    CHANNELS.browserSnapshot,
    validated(browserProjectInputSchema, async ({ projectId }) =>
      agent.lookingAt(projectId) === null
        ? browser.snapshot(projectId)
        : { ok: true, data: await agent.snapshotByPerson(projectId) },
    ),
  );
  reg(
    CHANNELS.browserFocusPage,
    validated(browserProjectInputSchema, ({ projectId }) => {
      if (agent.lookingAt(projectId) === null) return sync(browser.focusPage(projectId));
      agent.focusPage(projectId);
      return sync(DONE);
    }),
  );
  reg(
    CHANNELS.browserOpenDevtools,
    validated(browserTabInputSchema, ({ projectId, tabId }) =>
      sync(
        // O depurador da aba de um agente é do app: é por ele que as ferramentas leem e agem na página.
        agent.owns(projectId, tabId)
          ? failure('VALIDATION_FAILED', NOT_ON_AGENT_TAB)
          : browser.openDevTools(projectId, tabId),
      ),
    ),
  );

  reg(
    CHANNELS.browserOpenExternal,
    validated(browserTabInputSchema, async ({ projectId, tabId }) => {
      // A mesma regra dos links externos do app: só https sai para o navegador do sistema.
      const url = agent.owns(projectId, tabId)
        ? agent.urlOf(projectId, tabId)
        : browser.urlOf(projectId, tabId);
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
      if (!(await deps.confirmClear())) return composed(current);
      // As páginas fecham antes: uma página viva regravaria cookies e armazenamento logo depois da limpeza.
      browser.forgetProject(projectId);
      agent.forgetProject(projectId);
      await deps.clearSession(projectId);
      await deps.clearAgentSession(projectId);
      applyYield(projectId);
      return composed(browser.state(projectId));
    }),
  );

  // Sem entrada: a resposta é a mesma para qualquer projeto.
  reg(CHANNELS.browserAgentAccess, () => sync({ ok: true, data: deps.agentAccess() }));
}
