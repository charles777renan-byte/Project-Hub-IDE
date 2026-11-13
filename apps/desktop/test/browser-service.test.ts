import {
  BROWSER_ADDRESS_BLOCKED,
  BROWSER_ERROR_MESSAGES,
  BROWSER_TAB_LIMIT,
  BROWSER_TAB_LIMIT_MESSAGE,
  type AppResult,
  type BrowserShortcutEvent,
  type BrowserStateDto,
} from '@project-hub/contracts';
import type { BrowserTabRecord, BrowserTabRepository } from '@project-hub/database';
import { describe, expect, it } from 'vitest';
import {
  createBrowserService,
  type PageEvents,
  type PageHandle,
} from '../src/main/browser/browser-service';

// O serviço é testado com páginas falsas, que guardam o que o serviço mandou fazer e deixam o teste disparar os
// eventos de cada página, e com um repositório em memória.

type FakePage = {
  projectId: string;
  calls: string[];
  events: PageEvents;
  destroyed: boolean;
};

function setup(initial: BrowserTabRecord[] = []) {
  const stored = new Map<string, BrowserTabRecord[]>();
  for (const record of initial) {
    stored.set(record.projectId, [...(stored.get(record.projectId) ?? []), record]);
  }
  const repo: BrowserTabRepository = {
    listByProject: (projectId) =>
      [...(stored.get(projectId) ?? [])].sort((a, b) => a.position - b.position),
    replaceProject: (projectId, records) => void stored.set(projectId, [...records]),
    deleteByProject: (projectId) => void stored.delete(projectId),
  };
  const pages: FakePage[] = [];
  const published: BrowserStateDto[] = [];
  const shortcuts: BrowserShortcutEvent[] = [];
  let nextId = 0;
  const service = createBrowserService({
    repo,
    pages: (projectId, events) => {
      const page: FakePage = { projectId, calls: [], events, destroyed: false };
      pages.push(page);
      const record =
        (name: string) =>
        (...args: unknown[]) =>
          void page.calls.push(args.length === 0 ? name : `${name}:${JSON.stringify(args[0])}`);
      const handle: PageHandle = {
        load: record('load'),
        back: record('back'),
        forward: record('forward'),
        reload: record('reload'),
        stop: record('stop'),
        setBounds: record('setBounds'),
        setVisible: record('setVisible'),
        setMuted: record('setMuted'),
        capture: () => Promise.resolve('data:image/png;base64,AA'),
        focus: record('focus'),
        openDevTools: record('openDevTools'),
        destroy: () => {
          page.destroyed = true;
          page.calls.push('destroy');
        },
      };
      return handle;
    },
    projectExists: (projectId) => projectId === 'A' || projectId === 'B',
    publish: (state) => void published.push(state),
    publishShortcut: (event) => void shortcuts.push(event),
    newId: () => `t${(nextId += 1)}`,
    now: () => '2026-11-12T10:00:00Z',
  });
  return { service, repo, pages, published, shortcuts };
}

function data<T>(result: AppResult<T>): T {
  if (!result.ok) throw new Error(`esperava sucesso, veio ${result.error.code}`);
  return result.data;
}

const RECT = { x: 900, y: 80, width: 600, height: 700 };

function stored(
  projectId: string,
  id: string,
  position: number,
  isActive = false,
): BrowserTabRecord {
  return {
    id,
    projectId,
    url: `http://localhost:3000/${id}`,
    title: id,
    position,
    isActive,
    updatedAt: '2026-11-11T10:00:00Z',
  };
}

/** A última chamada de um tipo que a página recebeu (por exemplo, o último `setVisible`). */
function last(page: FakePage | undefined, name: string): string | undefined {
  return page?.calls.filter((call) => call === name || call.startsWith(`${name}:`)).at(-1);
}

describe('createBrowserService', () => {
  it('cria uma aba vazia no primeiro state e a grava', () => {
    const { service, repo, pages } = setup();
    const state = data(service.state('A'));
    expect(state.tabs).toHaveLength(1);
    expect(state.tabs[0]).toMatchObject({ url: '', title: '', loading: false, error: null });
    expect(state.activeTabId).toBe(state.tabs[0]?.id);
    expect(repo.listByProject('A')).toHaveLength(1);
    expect(repo.listByProject('A')[0]).toMatchObject({ url: '', isActive: true, position: 0 });
    expect(pages).toHaveLength(0);
  });

  it('projeto que não existe é recusado em todos os pedidos', async () => {
    const { service } = setup();
    const results = [
      service.state('X'),
      service.openTab('X'),
      service.closeTab('X', 't'),
      service.selectTab('X', 't'),
      service.navigate('X', 't', 'a.com'),
      service.back('X', 't'),
      service.forward('X', 't'),
      service.reload('X', 't'),
      service.stop('X', 't'),
      service.setBounds('X', RECT),
      await service.snapshot('X'),
      service.focusPage('X'),
      service.openDevTools('X', 't'),
    ];
    for (const result of results) {
      expect(result).toMatchObject({ ok: false, error: { code: 'VALIDATION_FAILED' } });
    }
  });

  it('aba que não existe é recusada', () => {
    const { service } = setup();
    service.state('A');
    expect(service.navigate('A', 'nao-existe', 'a.com')).toMatchObject({
      ok: false,
      error: { code: 'VALIDATION_FAILED' },
    });
  });

  it('navigate carrega o endereço interpretado e marca a aba como carregando', () => {
    const { service, pages } = setup();
    const tabId = data(service.state('A')).activeTabId ?? '';
    const state = data(service.navigate('A', tabId, 'localhost:3000'));
    expect(pages).toHaveLength(1);
    expect(pages[0]?.calls).toContain('load:"http://localhost:3000/"');
    expect(state.tabs[0]).toMatchObject({
      url: 'http://localhost:3000/',
      loading: true,
      error: null,
    });
  });

  it('navigate recusa protocolo bloqueado, sem carregar', () => {
    const { service, pages } = setup();
    const tabId = data(service.state('A')).activeTabId ?? '';
    const result = service.navigate('A', tabId, 'javascript:alert(1)');
    expect(result).toMatchObject({
      ok: false,
      error: { code: 'VALIDATION_FAILED', message: BROWSER_ADDRESS_BLOCKED },
    });
    expect(pages).toHaveLength(0);
  });

  it('navigate com texto vazio devolve o estado sem mudar nada', () => {
    const { service, pages, published } = setup();
    const before = data(service.state('A'));
    const count = published.length;
    expect(data(service.navigate('A', before.activeTabId ?? '', '   '))).toEqual(before);
    expect(pages).toHaveLength(0);
    expect(published).toHaveLength(count);
  });

  it('não cria página para aba restaurada até ela ser mostrada', () => {
    const { service, pages } = setup([
      stored('A', 'a', 0),
      stored('A', 'b', 1, true),
      stored('A', 'c', 2),
    ]);
    const state = data(service.state('A'));
    expect(state.tabs.map((tab) => tab.id)).toEqual(['a', 'b', 'c']);
    expect(state.activeTabId).toBe('b');
    expect(pages).toHaveLength(0);

    service.setBounds('A', RECT);
    expect(pages).toHaveLength(1);
    expect(pages[0]?.calls).toContain('load:"http://localhost:3000/b"');
    expect(last(pages[0], 'setBounds')).toBe(`setBounds:${JSON.stringify(RECT)}`);
    expect(last(pages[0], 'setVisible')).toBe('setVisible:true');
  });

  it('só a aba ativa do projeto visível fica visível, e o outro projeto fica sem som', () => {
    const { service, pages } = setup([stored('A', 'a', 0, true), stored('B', 'b', 0, true)]);
    service.setBounds('A', RECT);
    service.setBounds('B', RECT);
    const [pageA, pageB] = pages;
    expect(last(pageA, 'setVisible')).toBe('setVisible:false');
    expect(last(pageA, 'setMuted')).toBe('setMuted:true');
    expect(last(pageB, 'setVisible')).toBe('setVisible:true');
    expect(last(pageB, 'setMuted')).toBe('setMuted:false');
  });

  it('setBounds(null) esconde a página do projeto visível', () => {
    const { service, pages } = setup([stored('A', 'a', 0, true)]);
    service.setBounds('A', RECT);
    service.setBounds('A', null);
    expect(last(pages[0], 'setVisible')).toBe('setVisible:false');
  });

  it('hideAll esconde a página à vista, e o próximo retângulo a traz de volta', () => {
    const { service, pages } = setup([stored('A', 'a', 0, true)]);
    service.hideAll();
    service.setBounds('A', RECT);
    service.hideAll();
    expect(last(pages[0], 'setVisible')).toBe('setVisible:false');
    expect(pages[0]?.destroyed).toBe(false);
    service.setBounds('A', RECT);
    expect(last(pages[0], 'setVisible')).toBe('setVisible:true');
  });

  it('o "esconder" atrasado de um projeto não esconde o que entrou depois', () => {
    const { service, pages } = setup([stored('A', 'a', 0, true), stored('B', 'b', 0, true)]);
    service.setBounds('A', RECT);
    service.setBounds('B', RECT);
    service.setBounds('A', null);
    expect(last(pages[1], 'setVisible')).toBe('setVisible:true');
  });

  it('selectTab troca a página visível', () => {
    const { service, pages } = setup([stored('A', 'a', 0, true), stored('A', 'b', 1)]);
    service.setBounds('A', RECT);
    const state = data(service.selectTab('A', 'b'));
    expect(state.activeTabId).toBe('b');
    expect(last(pages[0], 'setVisible')).toBe('setVisible:false');
    expect(last(pages[1], 'setVisible')).toBe('setVisible:true');
  });

  it('openTab abre uma aba vazia, ativa, no fim', () => {
    const { service } = setup([stored('A', 'a', 0, true)]);
    const state = data(service.openTab('A'));
    expect(state.tabs).toHaveLength(2);
    expect(state.tabs[1]).toMatchObject({ url: '' });
    expect(state.activeTabId).toBe(state.tabs[1]?.id);
  });

  it('openTab recusa acima do limite', () => {
    const { service } = setup();
    service.state('A');
    for (let i = 1; i < BROWSER_TAB_LIMIT; i += 1) data(service.openTab('A'));
    expect(service.openTab('A')).toMatchObject({
      ok: false,
      error: { code: 'VALIDATION_FAILED', message: BROWSER_TAB_LIMIT_MESSAGE },
    });
    expect(data(service.state('A')).tabs).toHaveLength(BROWSER_TAB_LIMIT);
  });

  it('página que pede janela nova em laço para na oitava aba, sem erro', () => {
    const { service, pages } = setup([stored('A', 'a', 0, true)]);
    service.setBounds('A', RECT);
    for (let i = 0; i < 20; i += 1) pages[0]?.events.onOpenTab(`https://exemplo.com/${i}`);
    const state = data(service.state('A'));
    expect(state.tabs).toHaveLength(BROWSER_TAB_LIMIT);
    expect(state.tabs[1]).toMatchObject({ url: 'https://exemplo.com/0' });
  });

  it('fechar a aba ativa ativa a vizinha da direita, ou a da esquerda', () => {
    const { service } = setup([
      stored('A', 'a', 0),
      stored('A', 'b', 1, true),
      stored('A', 'c', 2),
    ]);
    expect(data(service.closeTab('A', 'b')).activeTabId).toBe('c');
    expect(data(service.closeTab('A', 'c')).activeTabId).toBe('a');
  });

  it('fechar uma aba que não é a ativa mantém a ativa', () => {
    const { service } = setup([stored('A', 'a', 0, true), stored('A', 'b', 1)]);
    const state = data(service.closeTab('A', 'b'));
    expect(state.activeTabId).toBe('a');
    expect(state.tabs).toHaveLength(1);
  });

  it('fechar a última aba cria uma vazia e destrói a página', () => {
    const { service, pages } = setup([stored('A', 'a', 0, true)]);
    service.setBounds('A', RECT);
    const state = data(service.closeTab('A', 'a'));
    expect(pages[0]?.destroyed).toBe(true);
    expect(state.tabs).toHaveLength(1);
    expect(state.tabs[0]).toMatchObject({ url: '' });
    expect(state.tabs[0]?.id).not.toBe('a');
  });

  it('onChange atualiza a aba, grava o título e publica', () => {
    const { service, pages, published, repo } = setup([stored('A', 'a', 0, true)]);
    service.setBounds('A', RECT);
    pages[0]?.events.onChange({ title: 'Olá', loading: false, canGoBack: true });
    expect(published.at(-1)?.tabs[0]).toMatchObject({
      title: 'Olá',
      loading: false,
      canGoBack: true,
    });
    expect(repo.listByProject('A')[0]).toMatchObject({ title: 'Olá' });
  });

  it('página que caiu vira erro CRASHED, e Recarregar tenta de novo', () => {
    const { service, pages, published } = setup([stored('A', 'a', 0, true)]);
    service.setBounds('A', RECT);
    const error = { code: 'CRASHED' as const, message: BROWSER_ERROR_MESSAGES.CRASHED };
    pages[0]?.events.onChange({ error, loading: false });
    expect(published.at(-1)?.tabs[0]).toMatchObject({ error, loading: false });
    expect(service.reload('A', 'a')).toEqual({ ok: true, data: undefined });
    expect(pages[0]?.calls).toContain('reload');
  });

  it('reload de aba restaurada que nunca foi mostrada carrega o endereço dela', () => {
    const { service, pages } = setup([stored('A', 'a', 0, true)]);
    service.state('A');
    service.reload('A', 'a');
    expect(pages[0]?.calls).toContain('load:"http://localhost:3000/a"');
  });

  it('back, forward e stop vão para a página da aba', () => {
    const { service, pages } = setup([stored('A', 'a', 0, true)]);
    service.setBounds('A', RECT);
    service.back('A', 'a');
    service.forward('A', 'a');
    service.stop('A', 'a');
    expect(pages[0]?.calls).toEqual(expect.arrayContaining(['back', 'forward', 'stop']));
  });

  it('snapshot devolve a imagem da página ativa, ou null sem página', async () => {
    const { service } = setup([stored('A', 'a', 0, true)]);
    expect(await service.snapshot('A')).toEqual({ ok: true, data: null });
    service.setBounds('A', RECT);
    expect(await service.snapshot('A')).toEqual({ ok: true, data: 'data:image/png;base64,AA' });
  });

  it('suspendProject destrói as páginas, mantém a lista e ignora evento atrasado', () => {
    const { service, pages, published, repo } = setup([stored('A', 'a', 0, true)]);
    service.setBounds('A', RECT);
    const before = repo.listByProject('A');
    service.suspendProject('A');
    expect(pages[0]?.destroyed).toBe(true);
    expect(repo.listByProject('A')).toEqual(before);
    const count = published.length;
    pages[0]?.events.onChange({ title: 'atrasado' });
    pages[0]?.events.onOpenTab('https://exemplo.com/');
    expect(published).toHaveLength(count);
    expect(repo.listByProject('A')).toEqual(before);
  });

  it('depois de suspenso, o projeto volta com as abas e sem página', () => {
    const { service, pages } = setup([stored('A', 'a', 0, true)]);
    service.setBounds('A', RECT);
    service.suspendProject('A');
    expect(data(service.state('A')).tabs.map((tab) => tab.id)).toEqual(['a']);
    expect(pages).toHaveLength(1);
  });

  it('forgetProject apaga a lista e ignora evento atrasado', () => {
    const { service, pages, published, repo } = setup([stored('A', 'a', 0, true)]);
    service.setBounds('A', RECT);
    service.forgetProject('A');
    expect(pages[0]?.destroyed).toBe(true);
    expect(repo.listByProject('A')).toEqual([]);
    const count = published.length;
    pages[0]?.events.onChange({ title: 'atrasado' });
    expect(published).toHaveLength(count);
    expect(repo.listByProject('A')).toEqual([]);
  });

  it('dispose destrói todas as páginas', () => {
    const { service, pages } = setup([stored('A', 'a', 0, true), stored('B', 'b', 0, true)]);
    service.setBounds('A', RECT);
    service.setBounds('B', RECT);
    service.dispose();
    expect(pages.every((page) => page.destroyed)).toBe(true);
  });

  it('atalho new-tab abre aba e pede o foco no endereço', () => {
    const { service, pages, shortcuts } = setup([stored('A', 'a', 0, true)]);
    service.setBounds('A', RECT);
    pages[0]?.events.onShortcut('new-tab');
    expect(data(service.state('A')).tabs).toHaveLength(2);
    expect(shortcuts).toEqual([{ projectId: 'A', action: 'focus-address' }]);
  });

  it('atalho close-tab fecha a aba ativa', () => {
    const { service, pages } = setup([stored('A', 'a', 0, true), stored('A', 'b', 1)]);
    service.setBounds('A', RECT);
    pages[0]?.events.onShortcut('close-tab');
    expect(data(service.state('A')).tabs.map((tab) => tab.id)).toEqual(['b']);
  });

  it('atalhos reload, back e forward agem na aba ativa', () => {
    const { service, pages } = setup([stored('A', 'a', 0, true)]);
    service.setBounds('A', RECT);
    pages[0]?.events.onShortcut('reload');
    pages[0]?.events.onShortcut('back');
    pages[0]?.events.onShortcut('forward');
    expect(pages[0]?.calls).toEqual(expect.arrayContaining(['reload', 'back', 'forward']));
  });

  it('atalhos do app vão para o renderer', () => {
    const { service, pages, shortcuts } = setup([stored('A', 'a', 0, true)]);
    service.setBounds('A', RECT);
    pages[0]?.events.onShortcut('toggle-right-panel');
    pages[0]?.events.onShortcut('focus-toolbar');
    expect(shortcuts).toEqual([
      { projectId: 'A', action: 'toggle-right-panel' },
      { projectId: 'A', action: 'focus-toolbar' },
    ]);
  });

  it('urlOf devolve o endereço da aba', () => {
    const { service } = setup([stored('A', 'a', 0, true)]);
    service.state('A');
    expect(service.urlOf('A', 'a')).toBe('http://localhost:3000/a');
    expect(service.urlOf('A', 'nao')).toBeUndefined();
  });
});
