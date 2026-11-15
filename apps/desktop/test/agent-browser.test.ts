import {
  BROWSER_ADDRESS_BLOCKED,
  BROWSER_AGENT_TAB_LIMIT_MESSAGE,
  type AppResult,
} from '@project-hub/contracts';
import { describe, expect, it } from 'vitest';
import {
  createAgentBrowser,
  type AgentPageEvents,
  type AgentPageHandle,
} from '../src/main/browser/agent/agent-browser';

// O serviço das abas do agente, com páginas falsas: cada uma guarda o que o serviço mandou fazer e deixa o teste
// decidir quando (e se) uma carga termina.

type FakePage = {
  projectId: string;
  calls: string[];
  events: AgentPageEvents;
  /** Cargas pendentes, na ordem em que foram pedidas. */
  loads: { url: string; resolve(): void; reject(error: Error): void }[];
  destroyed: boolean;
};

const A = { terminalId: 'term-a', projectId: 'p1' };
const B = { terminalId: 'term-b', projectId: 'p1' };
const OTHER = { terminalId: 'term-c', projectId: 'p2' };
const BOUNDS = { x: 10, y: 20, width: 300, height: 200 };

function setup(options: { autoLoad?: boolean; previewUrl?: string } = {}) {
  const autoLoad = options.autoLoad ?? true;
  const pages: FakePage[] = [];
  const changed: string[] = [];
  const shortcuts: string[] = [];
  let nextId = 0;
  const service = createAgentBrowser({
    pages: (projectId, events) => {
      const page: FakePage = { projectId, calls: [], events, loads: [], destroyed: false };
      pages.push(page);
      const note =
        (name: string) =>
        (...args: unknown[]): void =>
          void page.calls.push(args.length === 0 ? name : `${name}:${JSON.stringify(args[0])}`);
      const settle = (name: string) => (): Promise<void> => {
        page.calls.push(name);
        return Promise.resolve();
      };
      const handle: AgentPageHandle = {
        load(url) {
          page.calls.push(`load:${url}`);
          if (autoLoad) {
            events.onChange({ url, title: `título de ${url}`, loading: false });
            return Promise.resolve();
          }
          return new Promise<void>((resolve, reject) => {
            page.loads.push({ url, resolve, reject });
          });
        },
        back: settle('back'),
        forward: settle('forward'),
        reload: settle('reload'),
        text: () => Promise.resolve('texto'),
        snapshot: () => Promise.resolve('estrutura'),
        screenshot: () => Promise.resolve({ mimeType: 'image/png', base64: 'AAAA' }),
        click: () => Promise.resolve(),
        type: () => Promise.resolve(),
        pressKey: () => Promise.resolve(),
        scroll: () => Promise.resolve(),
        console: () => [],
        networkErrors: () => [],
        show: note('show'),
        park: note('park'),
        focus: note('focus'),
        destroy() {
          page.destroyed = true;
          page.calls.push('destroy');
        },
      };
      return handle;
    },
    projectExists: (projectId) => projectId === 'p1' || projectId === 'p2',
    terminalTitle: (terminalId) => `Claude · ${terminalId}`,
    previewUrl: () => options.previewUrl,
    changed: (projectId) => void changed.push(projectId),
    shortcut: (projectId, action) => void shortcuts.push(`${projectId}:${action}`),
    newId: () => `tab-${++nextId}`,
  });
  return { service, pages, changed, shortcuts };
}

function data<T>(result: AppResult<T>): T {
  if (!result.ok) throw new Error(`esperava sucesso, veio: ${result.error.message}`);
  return result.data;
}

function message(result: AppResult<unknown>): string {
  if (result.ok) throw new Error('esperava falha');
  return result.error.message;
}

describe('abas do agente', () => {
  it('abrir cria uma aba do agente, com o título do terminal, e avisa que mudou', async () => {
    const { service, pages, changed } = setup();
    const tab = data(await service.open(A, 'http://localhost:5173/'));
    expect(tab).toEqual({
      id: 'tab-1',
      url: 'http://localhost:5173/',
      title: 'título de http://localhost:5173/',
      loading: false,
    });
    expect(pages[0]?.calls).toContain('load:http://localhost:5173/');
    expect(service.tabsOf('p1')).toEqual([
      {
        id: 'tab-1',
        url: 'http://localhost:5173/',
        title: 'título de http://localhost:5173/',
        loading: false,
        canGoBack: false,
        canGoForward: false,
        error: null,
        owner: 'agent',
        terminalTitle: 'Claude · term-a',
      },
    ]);
    expect(changed).toContain('p1');
    expect(service.owns('p1', 'tab-1')).toBe(true);
    expect(service.owns('p2', 'tab-1')).toBe(false);
  });

  it('a quinta aba do projeto é recusada, mesmo vinda de outro terminal', async () => {
    const { service, pages } = setup();
    for (let i = 0; i < 3; i += 1) data(await service.open(A, 'http://localhost:1/'));
    data(await service.open(B, 'http://localhost:1/'));
    expect(message(await service.open(B, 'http://localhost:1/'))).toBe(
      BROWSER_AGENT_TAB_LIMIT_MESSAGE,
    );
    expect(pages).toHaveLength(4);
    // Outro projeto tem o seu próprio limite.
    data(await service.open(OTHER, 'http://localhost:1/'));
  });

  it('um terminal não lista, não fecha e não usa a aba de outro', async () => {
    const { service } = setup();
    const tab = data(await service.open(A, 'http://localhost:1/'));
    expect(service.tabs(B).tabs).toEqual([]);
    expect(service.tabs(A).tabs).toHaveLength(1);
    expect(message(service.close(B, tab.id))).toBe('A aba não existe mais.');
    expect(message(service.page(B, tab.id))).toBe('A aba não existe mais.');
    expect(message(await service.navigate(B, tab.id, 'reload'))).toBe('A aba não existe mais.');
    expect(message(service.page(OTHER, tab.id))).toBe('A aba não existe mais.');
    expect(service.page(A, tab.id).ok).toBe(true);
  });

  it('a lista traz o endereço do preview do projeto, quando há', async () => {
    expect(setup({ previewUrl: 'http://localhost:5173/' }).service.tabs(A)).toEqual({
      tabs: [],
      previewUrl: 'http://localhost:5173/',
    });
    expect(setup().service.tabs(A)).toEqual({ tabs: [] });
  });

  it.each([
    'file:///C:/Windows/win.ini',
    'javascript:alert(1)',
    'chrome://settings',
    'data:text/html,<h1>x</h1>',
    `http://localhost/${'a'.repeat(5000)}`,
  ])('recusa o endereço %s sem criar página', async (url) => {
    const { service, pages } = setup();
    expect(message(await service.open(A, url))).toBe(BROWSER_ADDRESS_BLOCKED);
    expect(pages).toHaveLength(0);
    expect(service.tabsOf('p1')).toEqual([]);
    const tab = data(await service.open(A, 'http://localhost:1/'));
    expect(message(await service.navigate(A, tab.id, { url }))).toBe(BROWSER_ADDRESS_BLOCKED);
  });

  it('endereço vazio e projeto que não existe são recusados', async () => {
    const { service, pages } = setup();
    expect(message(await service.open(A, '   '))).toBe('Informe um endereço.');
    expect(
      message(await service.open({ terminalId: 't', projectId: 'sumiu' }, 'http://localhost:1/')),
    ).toBe('O projeto não existe.');
    expect(pages).toHaveLength(0);
  });

  it('uma carga que falha ao abrir fecha a aba e devolve o motivo', async () => {
    const { service, pages } = setup({ autoLoad: false });
    const opening = service.open(A, 'http://localhost:9/');
    pages[0]?.loads[0]?.reject(new Error('O servidor recusou a conexão.'));
    expect(message(await opening)).toBe('O servidor recusou a conexão.');
    expect(pages[0]?.destroyed).toBe(true);
    expect(service.tabsOf('p1')).toEqual([]);
  });

  it('navegar numa aba aberta carrega, volta, avança e recarrega', async () => {
    const { service, pages } = setup();
    const tab = data(await service.open(A, 'http://localhost:1/'));
    const moved = data(await service.navigate(A, tab.id, { url: 'localhost:2' }));
    expect(moved.url).toBe('http://localhost:2/');
    data(await service.navigate(A, tab.id, 'back'));
    data(await service.navigate(A, tab.id, 'forward'));
    data(await service.navigate(A, tab.id, 'reload'));
    expect(pages[0]?.calls.filter((call) => !call.startsWith('park'))).toEqual([
      'load:http://localhost:1/',
      'load:http://localhost:2/',
      'back',
      'forward',
      'reload',
    ]);
  });

  it('o fim do terminal destrói só as abas dele e encerra a navegação pendente', async () => {
    const { service, pages, changed } = setup({ autoLoad: false });
    const first = service.open(A, 'http://localhost:1/');
    pages[0]?.loads[0]?.resolve();
    const tab = data(await first);
    const other = service.open(B, 'http://localhost:2/');
    pages[1]?.loads[0]?.resolve();
    data(await other);

    const pending = service.navigate(A, tab.id, { url: 'http://localhost:3/' });
    changed.length = 0;
    service.endTerminal('term-a');
    expect(message(await pending)).toBe('A aba não existe mais.');
    expect(pages[0]?.destroyed).toBe(true);
    expect(pages[1]?.destroyed).toBe(false);
    expect(service.tabs(A).tabs).toEqual([]);
    expect(service.tabs(B).tabs).toHaveLength(1);
    expect(changed).toEqual(['p1']);
    // Uma carga que termina depois não ressuscita nada.
    pages[0]?.loads[1]?.resolve();
    pages[0]?.events.onChange({ title: 'tarde demais' });
    expect(service.tabsOf('p1')).toHaveLength(1);
  });

  it('a pessoa fecha a aba que o agente usa: a chamada seguinte diz que ela não existe', async () => {
    const { service, pages } = setup();
    const tab = data(await service.open(A, 'http://localhost:1/'));
    service.closeByPerson('p1', tab.id);
    expect(pages[0]?.destroyed).toBe(true);
    expect(message(service.page(A, tab.id))).toBe('A aba não existe mais.');
    expect(message(await service.navigate(A, tab.id, 'reload'))).toBe('A aba não existe mais.');
    expect(message(service.close(A, tab.id))).toBe('A aba não existe mais.');
  });

  it('a pessoa navega na aba do agente pelas mesmas regras de endereço', async () => {
    const { service, pages } = setup();
    const tab = data(await service.open(A, 'http://localhost:1/'));
    expect(service.navigateByPerson('p1', tab.id, 'localhost:7').ok).toBe(true);
    expect(pages[0]?.calls).toContain('load:http://localhost:7/');
    expect(message(service.navigateByPerson('p1', tab.id, 'file:///c:/x'))).toBe(
      BROWSER_ADDRESS_BLOCKED,
    );
    service.stepByPerson('p1', tab.id, 'back');
    expect(pages[0]?.calls).toContain('back');
    expect(service.urlOf('p1', tab.id)).toBe('http://localhost:7/');
    expect(service.urlOf('p1', 'nenhuma')).toBeUndefined();
  });

  it('a página só vai para a janela principal enquanto a pessoa a olha', async () => {
    const { service, pages } = setup();
    const tab = data(await service.open(A, 'http://localhost:1/'));
    const shows = (): string[] =>
      (pages[0]?.calls ?? []).filter((call) => call.startsWith('show') || call === 'park');

    // Olhar sem retângulo ainda não mostra.
    service.lookAt('p1', tab.id);
    expect(service.lookingAt('p1')).toBe(tab.id);
    expect(shows().filter((call) => call.startsWith('show'))).toEqual([]);

    service.setBounds('p1', BOUNDS);
    expect(shows().at(-1)).toBe(`show:${JSON.stringify(BOUNDS)}`);

    // O painel fechou.
    service.setBounds('p1', null);
    expect(shows().at(-1)).toBe('park');

    service.setBounds('p1', BOUNDS);
    expect(shows().at(-1)).toBe(`show:${JSON.stringify(BOUNDS)}`);

    // Outro projeto tomou a tela.
    service.setBounds('p2', BOUNDS);
    expect(shows().at(-1)).toBe('park');

    service.setBounds('p1', BOUNDS);
    service.lookAt('p1', null);
    expect(service.lookingAt('p1')).toBeNull();
    expect(shows().at(-1)).toBe('park');

    service.lookAt('p1', tab.id);
    service.parkAll();
    expect(shows().at(-1)).toBe('park');
  });

  it('com a janela principal minimizada ou escondida, a página volta para a janela de apoio até ela reaparecer', async () => {
    const { service, pages } = setup();
    const tab = data(await service.open(A, 'http://localhost:1/'));
    const last = (): string | undefined =>
      (pages[0]?.calls ?? []).filter((call) => call.startsWith('show') || call === 'park').at(-1);
    service.lookAt('p1', tab.id);
    service.setBounds('p1', BOUNDS);
    expect(last()).toBe(`show:${JSON.stringify(BOUNDS)}`);

    // Numa janela que não é desenhada a captura do agente falharia.
    service.setWindowVisible(false);
    expect(last()).toBe('park');
    // A pessoa segue olhando esta aba: o que mudou foi só onde a página está.
    expect(service.lookingAt('p1')).toBe(tab.id);
    // Um retângulo que chega com a janela fora de vista não traz a página de volta.
    service.setBounds('p1', BOUNDS);
    expect(last()).toBe('park');

    service.setWindowVisible(true);
    expect(last()).toBe(`show:${JSON.stringify(BOUNDS)}`);
  });

  it('a imagem parada é a da aba que a pessoa olha, ou nada', async () => {
    const { service } = setup();
    expect(await service.snapshotByPerson('p1')).toBeNull();
    const tab = data(await service.open(A, 'http://localhost:1/'));
    expect(await service.snapshotByPerson('p1')).toBeNull();
    service.lookAt('p1', tab.id);
    expect(await service.snapshotByPerson('p1')).toBe('data:image/png;base64,AAAA');
    expect(await service.snapshotByPerson('p2')).toBeNull();
  });

  it('fechar a aba que a pessoa olha deixa de olhar', async () => {
    const { service } = setup();
    const tab = data(await service.open(A, 'http://localhost:1/'));
    service.lookAt('p1', tab.id);
    data(service.close(A, tab.id));
    expect(service.lookingAt('p1')).toBeNull();
    // Olhar uma aba que não é do agente não vale.
    service.lookAt('p1', 'aba-da-pessoa');
    expect(service.lookingAt('p1')).toBeNull();
  });

  it('o que a página conta atualiza a aba e avisa a tela', async () => {
    const { service, pages, changed } = setup();
    const tab = data(await service.open(A, 'http://localhost:1/'));
    changed.length = 0;
    pages[0]?.events.onChange({ title: 'Novo título', loading: true, canGoBack: true });
    expect(service.tabsOf('p1')[0]).toMatchObject({
      id: tab.id,
      title: 'Novo título',
      loading: true,
      canGoBack: true,
      owner: 'agent',
    });
    expect(changed).toEqual(['p1']);
  });

  it('um atalho do app vindo da página chega com o projeto dela, enquanto a aba vive', async () => {
    const { service, pages, shortcuts } = setup();
    const tab = data(await service.open(A, 'http://localhost:1/'));
    pages[0]?.events.onShortcut('focus-address');
    expect(shortcuts).toEqual(['p1:focus-address']);
    service.closeByPerson('p1', tab.id);
    pages[0]?.events.onShortcut('focus-toolbar');
    expect(shortcuts).toHaveLength(1);
  });

  it('esquecer o projeto e encerrar destroem as páginas', async () => {
    const { service, pages } = setup();
    data(await service.open(A, 'http://localhost:1/'));
    data(await service.open(OTHER, 'http://localhost:1/'));
    service.forgetProject('p1');
    expect(pages[0]?.destroyed).toBe(true);
    expect(pages[1]?.destroyed).toBe(false);
    service.dispose();
    expect(pages[1]?.destroyed).toBe(true);
    expect(service.tabsOf('p2')).toEqual([]);
  });
});
