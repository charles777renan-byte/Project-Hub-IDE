import { failure } from '@project-hub/application';
import {
  BROWSER_ADDRESS_BLOCKED,
  BROWSER_TAB_LIMIT,
  BROWSER_TAB_LIMIT_MESSAGE,
  type AppResult,
  type BrowserBounds,
  type BrowserShortcutAction,
  type BrowserShortcutEvent,
  type BrowserStateDto,
  type BrowserTabDto,
} from '@project-hub/contracts';
import type { BrowserTabRepository } from '@project-hub/database';
import { interpretAddress } from './address';

/** O que o serviço manda uma página fazer. A implementação de verdade usa uma `WebContentsView` (browser-views.ts). */
export type PageHandle = {
  load(url: string): void;
  back(): void;
  forward(): void;
  reload(): void;
  stop(): void;
  setBounds(bounds: BrowserBounds): void;
  setVisible(visible: boolean): void;
  setMuted(muted: boolean): void;
  /** Imagem parada da página, como `data:image/png`, ou `null` se não deu para capturar. */
  capture(): Promise<string | null>;
  focus(): void;
  openDevTools(): void;
  destroy(): void;
};

/** Atalhos que uma página pode devolver: os do app (que vão ao renderer) e os que o próprio serviço resolve. */
export type PageShortcut =
  BrowserShortcutAction | 'new-tab' | 'close-tab' | 'reload' | 'back' | 'forward';

/** O que uma página conta ao serviço. */
export type PageEvents = {
  onChange(patch: Partial<Omit<BrowserTabDto, 'id'>>): void;
  /** A página pediu uma janela nova com um endereço permitido. */
  onOpenTab(url: string): void;
  onShortcut(action: PageShortcut): void;
};

export type PageFactory = (projectId: string, events: PageEvents) => PageHandle;

export type BrowserServiceDeps = {
  repo: BrowserTabRepository;
  pages: PageFactory;
  projectExists(projectId: string): boolean;
  publish(state: BrowserStateDto): void;
  publishShortcut(event: BrowserShortcutEvent): void;
  newId(): string;
  now(): string;
};

export type BrowserService = {
  state(projectId: string): AppResult<BrowserStateDto>;
  openTab(projectId: string, url?: string): AppResult<BrowserStateDto>;
  closeTab(projectId: string, tabId: string): AppResult<BrowserStateDto>;
  selectTab(projectId: string, tabId: string): AppResult<BrowserStateDto>;
  navigate(projectId: string, tabId: string, text: string): AppResult<BrowserStateDto>;
  back(projectId: string, tabId: string): AppResult<undefined>;
  forward(projectId: string, tabId: string): AppResult<undefined>;
  reload(projectId: string, tabId: string): AppResult<undefined>;
  stop(projectId: string, tabId: string): AppResult<undefined>;
  /** `null` esconde. Só um projeto fica visível por vez: o do último retângulo não nulo. */
  setBounds(projectId: string, bounds: BrowserBounds | null): AppResult<undefined>;
  snapshot(projectId: string): Promise<AppResult<string | null>>;
  /**
   * Esconde a página que estiver à vista, sem destruir nada. Para quando a janela do app recarrega ou o processo
   * dela cai: o renderer que mediu a área não existe mais, e ninguém mandaria esconder a página.
   */
  hideAll(): void;
  focusPage(projectId: string): AppResult<undefined>;
  openDevTools(projectId: string, tabId: string): AppResult<undefined>;
  /** Endereço atual da aba, para "Abrir no navegador do sistema". */
  urlOf(projectId: string, tabId: string): string | undefined;
  /** Destrói as páginas do projeto e mantém a lista no banco (a aba do projeto foi fechada). */
  suspendProject(projectId: string): void;
  /** Destrói as páginas e apaga a lista (projeto removido, ou dados de navegação limpos). */
  forgetProject(projectId: string): void;
  dispose(): void;
};

const NO_PROJECT = 'O projeto não existe.';
const NO_TAB = 'A aba não existe mais.';
const DONE: AppResult<undefined> = { ok: true, data: undefined };

/** Uma página viva. `alive` vira falso ao destruir: um evento que chegue depois é ignorado. */
type LivePage = { handle: PageHandle; alive: { value: boolean } };

type ProjectState = {
  tabs: BrowserTabDto[];
  activeTabId: string;
  pages: Map<string, LivePage>;
};

/**
 * O navegador de cada projeto: as abas, qual está ativa e as páginas vivas. É o dono do estado; o renderer só
 * mostra o que este serviço publica. A lista de abas vai para o banco a cada mudança (endereço, título, ordem e a
 * ativa); carregando, voltar/avançar e erro vivem só em memória.
 *
 * A página de uma aba só é criada quando há o que mostrar: a aba ativa do projeto visível com endereço, ou um
 * pedido de navegar. Uma aba restaurada do banco e nunca mostrada não gasta um processo.
 */
export function createBrowserService(deps: BrowserServiceDeps): BrowserService {
  const projects = new Map<string, ProjectState>();
  /** O projeto cujo navegador está na tela e onde; `bounds` nulo é "escondido". */
  let shown: { projectId: string; bounds: BrowserBounds | null } | null = null;

  function emptyTab(url = ''): BrowserTabDto {
    return {
      id: deps.newId(),
      url,
      title: '',
      loading: false,
      canGoBack: false,
      canGoForward: false,
      error: null,
    };
  }

  function persist(projectId: string, project: ProjectState): void {
    const updatedAt = deps.now();
    deps.repo.replaceProject(
      projectId,
      project.tabs.map((tab, position) => ({
        id: tab.id,
        projectId,
        url: tab.url,
        title: tab.title,
        position,
        isActive: tab.id === project.activeTabId,
        updatedAt,
      })),
    );
  }

  /** O estado do projeto, lido do banco no primeiro acesso. Projeto sem abas ganha uma vazia. */
  function load(projectId: string): ProjectState | undefined {
    const known = projects.get(projectId);
    if (known !== undefined) return known;
    if (!deps.projectExists(projectId)) return undefined;
    const records = deps.repo.listByProject(projectId);
    const tabs = records.map((record): BrowserTabDto => ({
      ...emptyTab(record.url),
      id: record.id,
      title: record.title,
    }));
    const project: ProjectState = { tabs, activeTabId: '', pages: new Map() };
    if (tabs.length === 0) {
      const tab = emptyTab();
      project.tabs.push(tab);
      project.activeTabId = tab.id;
      persist(projectId, project);
    } else {
      project.activeTabId = records.find((record) => record.isActive)?.id ?? tabs[0]?.id ?? '';
    }
    projects.set(projectId, project);
    return project;
  }

  function snapshotOf(projectId: string, project: ProjectState): BrowserStateDto {
    return {
      projectId,
      tabs: project.tabs.map((tab) => ({ ...tab })),
      activeTabId: project.activeTabId,
    };
  }

  function publish(projectId: string, project: ProjectState): BrowserStateDto {
    const state = snapshotOf(projectId, project);
    deps.publish(state);
    return state;
  }

  function destroyPage(project: ProjectState, tabId: string): void {
    const page = project.pages.get(tabId);
    if (page === undefined) return;
    page.alive.value = false;
    project.pages.delete(tabId);
    page.handle.destroy();
  }

  function createPage(projectId: string, project: ProjectState, tabId: string): LivePage {
    const alive = { value: true };
    const tabOf = () => (alive.value ? project.tabs.find((tab) => tab.id === tabId) : undefined);
    const handle = deps.pages(projectId, {
      onChange(patch) {
        const tab = tabOf();
        if (tab === undefined) return;
        Object.assign(tab, patch);
        if (patch.url !== undefined || patch.title !== undefined) persist(projectId, project);
        publish(projectId, project);
      },
      onOpenTab(url) {
        if (!alive.value) return;
        // Acima do limite, o pedido da página é só ignorado.
        openTab(projectId, url);
      },
      onShortcut(action) {
        if (!alive.value) return;
        shortcut(projectId, project, action);
      },
    });
    const page = { handle, alive };
    project.pages.set(tabId, page);
    return page;
  }

  /** A página da aba, criada e carregada agora se a aba tem endereço e ainda não tem página. */
  function ensureLoaded(
    projectId: string,
    project: ProjectState,
    tab: BrowserTabDto,
  ): LivePage | undefined {
    const existing = project.pages.get(tab.id);
    if (existing !== undefined) return existing;
    if (tab.url === '') return undefined;
    const page = createPage(projectId, project, tab.id);
    tab.loading = true;
    tab.error = null;
    page.handle.load(tab.url);
    return page;
  }

  /** Põe na tela a página da aba ativa do projeto visível e esconde todas as outras. */
  function apply(): void {
    const visible = shown;
    for (const [projectId, project] of projects) {
      const onScreen =
        visible !== null && visible.projectId === projectId && visible.bounds !== null;
      if (onScreen) {
        const active = project.tabs.find((tab) => tab.id === project.activeTabId);
        if (active !== undefined) ensureLoaded(projectId, project, active);
      }
      for (const [tabId, page] of project.pages) {
        if (!(onScreen && tabId === project.activeTabId)) page.handle.setVisible(false);
        page.handle.setMuted(visible?.projectId !== projectId);
      }
    }
    if (visible === null || visible.bounds === null) return;
    const project = projects.get(visible.projectId);
    const page = project?.pages.get(project.activeTabId);
    if (page === undefined) return;
    page.handle.setBounds(visible.bounds);
    page.handle.setVisible(true);
  }

  function shortcut(projectId: string, project: ProjectState, action: PageShortcut): void {
    const active = project.activeTabId;
    switch (action) {
      case 'new-tab':
        if (openTab(projectId).ok) deps.publishShortcut({ projectId, action: 'focus-address' });
        return;
      case 'close-tab':
        closeTab(projectId, active);
        return;
      case 'reload':
        reload(projectId, active);
        return;
      case 'back':
        project.pages.get(active)?.handle.back();
        return;
      case 'forward':
        project.pages.get(active)?.handle.forward();
        return;
      default:
        deps.publishShortcut({ projectId, action });
    }
  }

  function openTab(projectId: string, url?: string): AppResult<BrowserStateDto> {
    const project = load(projectId);
    if (project === undefined) return failure('VALIDATION_FAILED', NO_PROJECT);
    if (project.tabs.length >= BROWSER_TAB_LIMIT) {
      return failure('VALIDATION_FAILED', BROWSER_TAB_LIMIT_MESSAGE);
    }
    const tab = emptyTab(url);
    project.tabs.push(tab);
    project.activeTabId = tab.id;
    persist(projectId, project);
    apply();
    return { ok: true, data: publish(projectId, project) };
  }

  function closeTab(projectId: string, tabId: string): AppResult<BrowserStateDto> {
    const project = load(projectId);
    if (project === undefined) return failure('VALIDATION_FAILED', NO_PROJECT);
    const index = project.tabs.findIndex((tab) => tab.id === tabId);
    if (index === -1) return failure('VALIDATION_FAILED', NO_TAB);
    destroyPage(project, tabId);
    project.tabs.splice(index, 1);
    if (project.tabs.length === 0) project.tabs.push(emptyTab());
    if (project.activeTabId === tabId) {
      // A vizinha da direita tomou o índice da que saiu; sem ela, a da esquerda.
      project.activeTabId =
        (project.tabs[index] ?? project.tabs[index - 1] ?? project.tabs[0])?.id ?? '';
    }
    persist(projectId, project);
    apply();
    return { ok: true, data: publish(projectId, project) };
  }

  function reload(projectId: string, tabId: string): AppResult<undefined> {
    const found = find(projectId, tabId);
    if (!found.ok) return found;
    const { project, tab } = found.data;
    const page = project.pages.get(tabId);
    if (page === undefined) {
      if (ensureLoaded(projectId, project, tab) === undefined) return DONE;
      apply();
    } else {
      tab.error = null;
      tab.loading = true;
      page.handle.reload();
    }
    publish(projectId, project);
    return DONE;
  }

  function find(
    projectId: string,
    tabId: string,
  ): AppResult<{ project: ProjectState; tab: BrowserTabDto }> {
    const project = load(projectId);
    if (project === undefined) return failure('VALIDATION_FAILED', NO_PROJECT);
    const tab = project.tabs.find((candidate) => candidate.id === tabId);
    if (tab === undefined) return failure('VALIDATION_FAILED', NO_TAB);
    return { ok: true, data: { project, tab } };
  }

  /** Roda `act` na página da aba, se ela existe. Aba sem página (nunca carregada) não faz nada. */
  function onPage(
    projectId: string,
    tabId: string,
    act: (handle: PageHandle) => void,
  ): AppResult<undefined> {
    const found = find(projectId, tabId);
    if (!found.ok) return found;
    const page = found.data.project.pages.get(tabId);
    if (page !== undefined) act(page.handle);
    return DONE;
  }

  function dropProject(projectId: string): void {
    const project = projects.get(projectId);
    if (project !== undefined) {
      for (const tabId of [...project.pages.keys()]) destroyPage(project, tabId);
      projects.delete(projectId);
    }
    if (shown?.projectId === projectId) shown = null;
  }

  return {
    state(projectId) {
      const project = load(projectId);
      if (project === undefined) return failure('VALIDATION_FAILED', NO_PROJECT);
      return { ok: true, data: snapshotOf(projectId, project) };
    },

    openTab,
    closeTab,

    selectTab(projectId, tabId) {
      const found = find(projectId, tabId);
      if (!found.ok) return found;
      const { project } = found.data;
      project.activeTabId = tabId;
      persist(projectId, project);
      apply();
      return { ok: true, data: publish(projectId, project) };
    },

    navigate(projectId, tabId, text) {
      const found = find(projectId, tabId);
      if (!found.ok) return found;
      const { project, tab } = found.data;
      const address = interpretAddress(text);
      if (address.kind === 'blocked') return failure('VALIDATION_FAILED', BROWSER_ADDRESS_BLOCKED);
      if (address.kind === 'empty') return { ok: true, data: snapshotOf(projectId, project) };
      const page = project.pages.get(tabId) ?? createPage(projectId, project, tabId);
      tab.url = address.url;
      tab.error = null;
      tab.loading = true;
      page.handle.load(address.url);
      persist(projectId, project);
      apply();
      return { ok: true, data: publish(projectId, project) };
    },

    back: (projectId, tabId) => onPage(projectId, tabId, (page) => page.back()),
    forward: (projectId, tabId) => onPage(projectId, tabId, (page) => page.forward()),
    reload,
    stop: (projectId, tabId) => onPage(projectId, tabId, (page) => page.stop()),

    setBounds(projectId, bounds) {
      if (load(projectId) === undefined) return failure('VALIDATION_FAILED', NO_PROJECT);
      if (bounds === null) {
        // O "esconder" de um projeto que já saiu da tela chega depois do retângulo do que entrou: não vale.
        if (shown?.projectId !== projectId) return DONE;
        shown = { projectId, bounds: null };
      } else {
        shown = { projectId, bounds };
      }
      const project = projects.get(projectId);
      const before = project === undefined ? undefined : project.pages.size;
      apply();
      // Mostrar pela primeira vez uma aba restaurada começa a carregá-la: o renderer precisa saber.
      if (project !== undefined && project.pages.size !== before) publish(projectId, project);
      return DONE;
    },

    hideAll() {
      if (shown === null) return;
      shown = { projectId: shown.projectId, bounds: null };
      apply();
    },

    async snapshot(projectId) {
      const project = load(projectId);
      if (project === undefined) return failure('VALIDATION_FAILED', NO_PROJECT);
      const page = project.pages.get(project.activeTabId);
      return { ok: true, data: page === undefined ? null : await page.handle.capture() };
    },

    focusPage(projectId) {
      const project = load(projectId);
      if (project === undefined) return failure('VALIDATION_FAILED', NO_PROJECT);
      project.pages.get(project.activeTabId)?.handle.focus();
      return DONE;
    },

    openDevTools: (projectId, tabId) => onPage(projectId, tabId, (page) => page.openDevTools()),

    urlOf(projectId, tabId) {
      const url = load(projectId)?.tabs.find((tab) => tab.id === tabId)?.url;
      return url === undefined || url === '' ? undefined : url;
    },

    suspendProject: dropProject,

    forgetProject(projectId) {
      dropProject(projectId);
      deps.repo.deleteByProject(projectId);
    },

    dispose() {
      for (const projectId of [...projects.keys()]) dropProject(projectId);
    },
  };
}
