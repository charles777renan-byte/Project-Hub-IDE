import { failure } from '@project-hub/application';
import {
  BROWSER_ADDRESS_BLOCKED,
  BROWSER_ADDRESS_MAX,
  BROWSER_AGENT_TAB_LIMIT,
  BROWSER_AGENT_TAB_LIMIT_MESSAGE,
  type AppResult,
  type BrowserBounds,
  type BrowserTabDto,
} from '@project-hub/contracts';
import { interpretAddress } from '../address';
import type { AgentIdentity } from './agent-tokens';

export type AgentConsoleEntry = { level: string; text: string };
export type AgentNetworkEntry = { url: string; method: string; status?: number; error?: string };
export type AgentClickTarget = { ref: string } | { x: number; y: number };

/** As teclas que o agente pode apertar sozinhas. */
export const AGENT_KEYS = [
  'Enter',
  'Tab',
  'Escape',
  'Backspace',
  'ArrowUp',
  'ArrowDown',
  'ArrowLeft',
  'ArrowRight',
  'PageUp',
  'PageDown',
  'Home',
  'End',
] as const;
export type AgentKey = (typeof AGENT_KEYS)[number];

/** O que o serviço manda uma página do agente fazer. A de verdade está em agent-pages.ts. */
export type AgentPageHandle = {
  /** Carrega e espera a carga (ou o tempo máximo). Rejeita com a mensagem do erro de carga. */
  load(url: string): Promise<void>;
  back(): Promise<void>;
  forward(): Promise<void>;
  reload(): Promise<void>;
  text(): Promise<string>;
  snapshot(): Promise<string>;
  screenshot(): Promise<{ mimeType: 'image/png'; base64: string }>;
  click(target: AgentClickTarget): Promise<void>;
  type(text: string, ref?: string): Promise<void>;
  pressKey(key: AgentKey): Promise<void>;
  scroll(deltaY: number, ref?: string): Promise<void>;
  console(): AgentConsoleEntry[];
  networkErrors(): AgentNetworkEntry[];
  /** Vai para a janela principal, nesse retângulo. */
  show(bounds: BrowserBounds): void;
  /** Volta para a janela de apoio. */
  park(): void;
  focus(): void;
  destroy(): void;
};

/** O que uma página do agente conta ao serviço. */
export type AgentPageEvents = {
  onChange(patch: Partial<Omit<BrowserTabDto, 'id' | 'owner'>>): void;
};

export type AgentPageFactory = (projectId: string, events: AgentPageEvents) => AgentPageHandle;

export type AgentBrowserDeps = {
  pages: AgentPageFactory;
  projectExists(projectId: string): boolean;
  terminalTitle(terminalId: string): string;
  previewUrl(projectId: string): string | undefined;
  /** Algo mudou nas abas de agente do projeto. */
  changed(projectId: string): void;
  newId(): string;
};

/** Uma aba, como o agente a vê. */
export type AgentTabView = { id: string; url: string; title: string; loading: boolean };

export type AgentNavigation = { url: string } | 'back' | 'forward' | 'reload';

export type AgentBrowser = {
  // Chamadas do agente. `who` vem do token; nenhuma recebe um id de projeto de fora.
  tabs(who: AgentIdentity): { tabs: AgentTabView[]; previewUrl?: string };
  open(who: AgentIdentity, url: string): Promise<AppResult<AgentTabView>>;
  close(who: AgentIdentity, tabId: string): AppResult<undefined>;
  navigate(
    who: AgentIdentity,
    tabId: string,
    action: AgentNavigation,
  ): Promise<AppResult<AgentTabView>>;
  page(who: AgentIdentity, tabId: string): AppResult<AgentPageHandle>;
  // Chamadas da tela.
  /** As abas de agente do projeto, como abas do navegador com `owner: 'agent'`. */
  tabsOf(projectId: string): BrowserTabDto[];
  owns(projectId: string, tabId: string): boolean;
  /** A aba de agente que a pessoa está olhando, ou `null`. */
  lookingAt(projectId: string): string | null;
  lookAt(projectId: string, tabId: string | null): void;
  /** Onde a página aparece. `null` é "o painel fechou". Só um projeto fica na tela: o do último retângulo. */
  setBounds(projectId: string, bounds: BrowserBounds | null): void;
  closeByPerson(projectId: string, tabId: string): void;
  navigateByPerson(projectId: string, tabId: string, text: string): AppResult<undefined>;
  stepByPerson(projectId: string, tabId: string, step: 'back' | 'forward' | 'reload'): void;
  focusPage(projectId: string): void;
  urlOf(projectId: string, tabId: string): string | undefined;
  // Ciclo de vida.
  endTerminal(terminalId: string): void;
  forgetProject(projectId: string): void;
  /** Devolve à janela de apoio a página que estiver na principal (a janela recarregou, ou o renderer caiu). */
  parkAll(): void;
  dispose(): void;
};

const NO_PROJECT = 'O projeto não existe.';
const NO_TAB = 'A aba não existe mais.';
const NO_ADDRESS = 'Informe um endereço.';
const LOAD_FAILED = 'Não foi possível abrir esta página.';
const DONE: AppResult<undefined> = { ok: true, data: undefined };

type AgentTab = {
  dto: BrowserTabDto;
  projectId: string;
  terminalId: string;
  handle: AgentPageHandle;
  alive: boolean;
  /** Rejeita quando a aba é destruída: solta quem espera uma carga dela. */
  gone: Promise<never>;
  markGone(): void;
};

function messageOf(error: unknown): string {
  return error instanceof Error && error.message !== '' ? error.message : LOAD_FAILED;
}

/**
 * As abas dos agentes: de quem é cada uma, o limite por projeto e onde a página está (na janela de apoio, ou na
 * principal enquanto a pessoa olha). É separado do serviço das abas da pessoa de propósito: estas abas não vão
 * para o banco, não dependem de o projeto estar na tela e morrem com o terminal que as abriu.
 *
 * Cada aba pertence ao terminal que a abriu. Para qualquer outro terminal, ela não existe: a resposta é a mesma de
 * uma aba fechada, para um agente não descobrir as abas de outro.
 */
export function createAgentBrowser(deps: AgentBrowserDeps): AgentBrowser {
  /** Todas as abas, na ordem em que foram abertas. */
  const tabs: AgentTab[] = [];
  const looking = new Map<string, string>();
  /** O projeto cujo painel do navegador está na tela, e onde. */
  let screen: { projectId: string; bounds: BrowserBounds } | null = null;
  /** A aba que está na janela principal agora. */
  let displayed: AgentTab | null = null;

  const view = (tab: AgentTab): AgentTabView => ({
    id: tab.dto.id,
    url: tab.dto.url,
    title: tab.dto.title,
    loading: tab.dto.loading,
  });

  const ofProject = (projectId: string): AgentTab[] =>
    tabs.filter((tab) => tab.projectId === projectId);

  const find = (projectId: string, tabId: string): AgentTab | undefined =>
    tabs.find((tab) => tab.projectId === projectId && tab.dto.id === tabId);

  const own = (who: AgentIdentity, tabId: string): AgentTab | undefined => {
    const tab = find(who.projectId, tabId);
    return tab !== undefined && tab.terminalId === who.terminalId ? tab : undefined;
  };

  /** Põe na janela principal a aba que a pessoa olha no projeto da tela, e devolve as outras à janela de apoio. */
  function apply(): void {
    const wanted =
      screen === null ? undefined : find(screen.projectId, looking.get(screen.projectId) ?? '');
    if (displayed !== null && displayed !== wanted) {
      if (displayed.alive) displayed.handle.park();
      displayed = null;
    }
    if (wanted === undefined || screen === null) return;
    wanted.handle.show(screen.bounds);
    displayed = wanted;
  }

  function destroy(tab: AgentTab): void {
    const index = tabs.indexOf(tab);
    if (index === -1) return;
    tabs.splice(index, 1);
    tab.alive = false;
    if (looking.get(tab.projectId) === tab.dto.id) looking.delete(tab.projectId);
    if (displayed === tab) displayed = null;
    tab.markGone();
    tab.handle.destroy();
  }

  function destroyAll(victims: AgentTab[]): void {
    const projects = new Set(victims.map((tab) => tab.projectId));
    for (const tab of victims) destroy(tab);
    apply();
    for (const projectId of projects) deps.changed(projectId);
  }

  function create(who: AgentIdentity): AgentTab {
    let markGone: () => void = () => undefined;
    const gone = new Promise<never>((_resolve, reject) => {
      markGone = () => reject(new Error(NO_TAB));
    });
    // Ninguém esperando não é erro: a rejeição só interessa a quem corre contra ela.
    gone.catch(() => undefined);
    const tab: AgentTab = {
      dto: {
        id: deps.newId(),
        url: '',
        title: '',
        loading: false,
        canGoBack: false,
        canGoForward: false,
        error: null,
        owner: 'agent',
        terminalTitle: deps.terminalTitle(who.terminalId),
      },
      projectId: who.projectId,
      terminalId: who.terminalId,
      alive: true,
      gone,
      markGone,
      handle: undefined as unknown as AgentPageHandle,
    };
    tab.handle = deps.pages(who.projectId, {
      onChange(patch) {
        if (!tab.alive) return;
        Object.assign(tab.dto, patch);
        deps.changed(tab.projectId);
      },
    });
    tabs.push(tab);
    return tab;
  }

  /** O endereço que o texto pede, pelas regras da barra da pessoa. */
  function addressOf(text: string): AppResult<string> {
    if (text.length > BROWSER_ADDRESS_MAX) {
      return failure('VALIDATION_FAILED', BROWSER_ADDRESS_BLOCKED);
    }
    const address = interpretAddress(text);
    if (address.kind === 'empty') return failure('VALIDATION_FAILED', NO_ADDRESS);
    if (address.kind === 'blocked') return failure('VALIDATION_FAILED', BROWSER_ADDRESS_BLOCKED);
    return { ok: true, data: address.url };
  }

  /** Espera a página terminar o que foi pedido, ou a aba sumir. */
  async function settle(tab: AgentTab, work: Promise<void>): Promise<AppResult<AgentTabView>> {
    try {
      await Promise.race([work, tab.gone]);
    } catch (error) {
      return failure('VALIDATION_FAILED', tab.alive ? messageOf(error) : NO_TAB);
    }
    if (!tab.alive) return failure('VALIDATION_FAILED', NO_TAB);
    return { ok: true, data: view(tab) };
  }

  function step(tab: AgentTab, action: 'back' | 'forward' | 'reload'): Promise<void> {
    if (action === 'back') return tab.handle.back();
    if (action === 'forward') return tab.handle.forward();
    return tab.handle.reload();
  }

  return {
    tabs(who) {
      const previewUrl = deps.previewUrl(who.projectId);
      return {
        tabs: ofProject(who.projectId)
          .filter((tab) => tab.terminalId === who.terminalId)
          .map(view),
        ...(previewUrl === undefined ? {} : { previewUrl }),
      };
    },

    async open(who, url) {
      if (!deps.projectExists(who.projectId)) return failure('VALIDATION_FAILED', NO_PROJECT);
      const address = addressOf(url);
      if (!address.ok) return address;
      if (ofProject(who.projectId).length >= BROWSER_AGENT_TAB_LIMIT) {
        return failure('VALIDATION_FAILED', BROWSER_AGENT_TAB_LIMIT_MESSAGE);
      }
      const tab = create(who);
      tab.dto.url = address.data;
      tab.dto.loading = true;
      deps.changed(tab.projectId);
      const result = await settle(tab, tab.handle.load(address.data));
      // A aba que não abriu não fica: o agente não tem o que fazer com ela.
      if (!result.ok && tab.alive) destroyAll([tab]);
      return result;
    },

    close(who, tabId) {
      const tab = own(who, tabId);
      if (tab === undefined) return failure('VALIDATION_FAILED', NO_TAB);
      destroyAll([tab]);
      return DONE;
    },

    async navigate(who, tabId, action) {
      const tab = own(who, tabId);
      if (tab === undefined) return failure('VALIDATION_FAILED', NO_TAB);
      if (typeof action === 'string') return settle(tab, step(tab, action));
      const address = addressOf(action.url);
      if (!address.ok) return address;
      return settle(tab, tab.handle.load(address.data));
    },

    page(who, tabId) {
      const tab = own(who, tabId);
      if (tab === undefined) return failure('VALIDATION_FAILED', NO_TAB);
      return { ok: true, data: tab.handle };
    },

    tabsOf: (projectId) => ofProject(projectId).map((tab) => ({ ...tab.dto })),

    owns: (projectId, tabId) => find(projectId, tabId) !== undefined,

    lookingAt: (projectId) => looking.get(projectId) ?? null,

    lookAt(projectId, tabId) {
      if (tabId !== null && find(projectId, tabId) !== undefined) looking.set(projectId, tabId);
      else looking.delete(projectId);
      apply();
    },

    setBounds(projectId, bounds) {
      if (bounds !== null) screen = { projectId, bounds };
      else if (screen?.projectId === projectId) screen = null;
      apply();
    },

    closeByPerson(projectId, tabId) {
      const tab = find(projectId, tabId);
      if (tab !== undefined) destroyAll([tab]);
    },

    navigateByPerson(projectId, tabId, text) {
      const tab = find(projectId, tabId);
      if (tab === undefined) return failure('VALIDATION_FAILED', NO_TAB);
      const address = addressOf(text);
      if (!address.ok) return address.error.message === NO_ADDRESS ? DONE : address;
      // A falha chega à tela pelo estado da aba; aqui ninguém espera a carga.
      tab.handle.load(address.data).catch(() => undefined);
      return DONE;
    },

    stepByPerson(projectId, tabId, action) {
      const tab = find(projectId, tabId);
      if (tab !== undefined) step(tab, action).catch(() => undefined);
    },

    focusPage(projectId) {
      if (displayed !== null && displayed.projectId === projectId) displayed.handle.focus();
    },

    urlOf: (projectId, tabId) => find(projectId, tabId)?.dto.url,

    endTerminal(terminalId) {
      destroyAll(tabs.filter((tab) => tab.terminalId === terminalId));
    },

    forgetProject(projectId) {
      destroyAll(ofProject(projectId));
    },

    parkAll() {
      screen = null;
      apply();
    },

    dispose() {
      destroyAll([...tabs]);
    },
  };
}
