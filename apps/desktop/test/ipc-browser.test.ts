import {
  BROWSER_EXTERNAL_HTTPS_ONLY,
  CHANNELS,
  type AppResult,
  type BrowserStateDto,
  type BrowserTabDto,
} from '@project-hub/contracts';
import type { IpcMainInvokeEvent } from 'electron';
import { describe, expect, it, vi } from 'vitest';
import type { BrowserService } from '../src/main/browser/browser-service';
import { registerBrowserHandlers, type BrowserIpcAgent } from '../src/main/ipc/browser';
import type { IpcRegistry } from '../src/main/ipc/trusted-handler';

const TRUSTED = 'file:///app/index.html';
const isTrusted = (event: IpcMainInvokeEvent) => event.senderFrame?.url === TRUSTED;

const STATE: BrowserStateDto = { projectId: 'p1', tabs: [], activeTabId: null };
const OK_STATE = { ok: true as const, data: STATE };
const OK = { ok: true as const, data: undefined };

function fakeService() {
  return {
    state: vi.fn(() => OK_STATE),
    openTab: vi.fn(() => OK_STATE),
    closeTab: vi.fn(() => OK_STATE),
    selectTab: vi.fn(() => OK_STATE),
    navigate: vi.fn(() => OK_STATE),
    back: vi.fn(() => OK),
    forward: vi.fn(() => OK),
    reload: vi.fn(() => OK),
    stop: vi.fn(() => OK),
    setBounds: vi.fn(() => OK),
    setYielded: vi.fn(),
    snapshot: vi.fn(() => Promise.resolve({ ok: true as const, data: 'data:image/png;base64,AA' })),
    hideAll: vi.fn(),
    focusPage: vi.fn(() => OK),
    openDevTools: vi.fn(() => OK),
    urlOf: vi.fn((): string | undefined => 'https://exemplo.com/a'),
    reloadOrigin: vi.fn(),
    hasOrigin: vi.fn(() => false),
    suspendProject: vi.fn(),
    forgetProject: vi.fn(),
    dispose: vi.fn(),
  } satisfies BrowserService;
}

function agentTab(id: string): BrowserTabDto {
  return {
    id,
    url: 'https://agente.exemplo/',
    title: 'Página do agente',
    loading: false,
    canGoBack: false,
    canGoForward: false,
    error: null,
    owner: 'agent',
    terminalTitle: 'Claude Code · app',
  };
}

/** O serviço das abas dos agentes, com as abas `owned` e a lembrança de qual a pessoa olha. */
function fakeAgent(owned: string[]) {
  let looking: string | null = null;
  return {
    tabsOf: vi.fn(() => owned.map(agentTab)),
    owns: vi.fn((_projectId: string, tabId: string) => owned.includes(tabId)),
    lookingAt: vi.fn(() => looking),
    lookAt: vi.fn((_projectId: string, tabId: string | null) => {
      looking = tabId;
    }),
    setBounds: vi.fn(),
    closeByPerson: vi.fn(() => {
      looking = null;
    }),
    navigateByPerson: vi.fn((): AppResult<undefined> => OK),
    stepByPerson: vi.fn(),
    focusPage: vi.fn(),
    urlOf: vi.fn((): string | undefined => 'https://agente.exemplo/'),
    snapshotByPerson: vi.fn((): Promise<string | null> =>
      Promise.resolve('data:image/png;base64,AG'),
    ),
    forgetProject: vi.fn(),
  } satisfies BrowserIpcAgent;
}

function setup(
  options: {
    /** Ids das abas de agente do projeto. */
    agentTabs?: string[];
    confirm?: boolean;
    zoom?: number;
    content?: { width: number; height: number } | null;
  } = {},
) {
  const listeners = new Map<string, (event: IpcMainInvokeEvent, payload?: unknown) => unknown>();
  const registry: IpcRegistry = {
    handle(channel, listener) {
      listeners.set(channel, listener);
    },
  };
  const browser = fakeService();
  const agent = fakeAgent(options.agentTabs ?? []);
  const order: string[] = [];
  browser.forgetProject.mockImplementation(() => void order.push('forget'));
  agent.forgetProject.mockImplementation(() => void order.push('agent-forget'));
  const clearSession = vi.fn(() => {
    order.push('clear');
    return Promise.resolve();
  });
  const clearAgentSession = vi.fn((_projectId: string) => {
    order.push('agent-clear');
    return Promise.resolve();
  });
  const confirmClear = vi.fn(() => Promise.resolve(options.confirm ?? true));
  const openExternal = vi.fn((_url: string) => Promise.resolve());
  registerBrowserHandlers(registry, isTrusted, {
    browser,
    agent,
    clearAgentSession,
    agentAccess: () => ({
      supported: true,
      programs: [
        { label: 'Claude Code', access: true },
        { label: 'Antigravity CLI', access: false },
      ],
    }),
    contentSize: () =>
      options.content === null ? undefined : (options.content ?? { width: 1600, height: 900 }),
    zoomFactor: () => options.zoom ?? 1,
    confirmClear,
    clearSession,
    openExternal,
  });
  return {
    browser,
    agent,
    order,
    clearSession,
    clearAgentSession,
    confirmClear,
    openExternal,
    channels: () => [...listeners.keys()].sort(),
    call(channel: string, payload?: unknown, senderUrl = TRUSTED) {
      const listener = listeners.get(channel);
      if (listener === undefined) throw new Error(`canal ${channel} não registrado`);
      const event = { senderFrame: { url: senderUrl } } as unknown as IpcMainInvokeEvent;
      return listener(event, payload);
    },
  };
}

const PROJECT = { projectId: 'p1' };
const TAB = { projectId: 'p1', tabId: 't1' };
const RECT = { x: 1000, y: 80, width: 600, height: 780 };

/** Um pedido válido por canal. */
const VALID: Record<string, unknown> = {
  [CHANNELS.browserState]: PROJECT,
  [CHANNELS.browserOpenTab]: PROJECT,
  [CHANNELS.browserCloseTab]: TAB,
  [CHANNELS.browserSelectTab]: TAB,
  [CHANNELS.browserNavigate]: { ...TAB, text: 'exemplo.com' },
  [CHANNELS.browserBack]: TAB,
  [CHANNELS.browserForward]: TAB,
  [CHANNELS.browserReload]: TAB,
  [CHANNELS.browserStop]: TAB,
  [CHANNELS.browserSetBounds]: { ...PROJECT, bounds: RECT },
  [CHANNELS.browserSnapshot]: PROJECT,
  [CHANNELS.browserFocusPage]: PROJECT,
  [CHANNELS.browserOpenDevtools]: TAB,
  [CHANNELS.browserOpenExternal]: TAB,
  [CHANNELS.browserClearData]: PROJECT,
};

describe('registerBrowserHandlers', () => {
  it('registra os 16 canais de pedido do navegador', () => {
    expect(setup().channels()).toEqual([...Object.keys(VALID), CHANNELS.browserAgentAccess].sort());
  });

  it.each(Object.entries(VALID))(
    '%s recusa remetente de outra origem',
    async (channel, payload) => {
      const ipc = setup();
      const result = await ipc.call(channel, payload, 'https://exemplo.com/');
      expect(result).toMatchObject({ ok: false, error: { code: 'PERMISSION_DENIED' } });
      for (const spy of Object.values(ipc.browser)) expect(spy).not.toHaveBeenCalled();
      expect(ipc.confirmClear).not.toHaveBeenCalled();
      expect(ipc.openExternal).not.toHaveBeenCalled();
    },
  );

  it.each(Object.keys(VALID))(
    '%s recusa entrada inválida sem chamar o serviço',
    async (channel) => {
      const ipc = setup();
      for (const payload of [undefined, {}, { projectId: '' }, { projectId: 7, tabId: 't' }]) {
        expect(await ipc.call(channel, payload)).toMatchObject({
          ok: false,
          error: { code: 'VALIDATION_FAILED' },
        });
      }
      for (const spy of Object.values(ipc.browser)) expect(spy).not.toHaveBeenCalled();
    },
  );

  it('cada canal simples chama o método certo', async () => {
    const ipc = setup();
    await ipc.call(CHANNELS.browserState, PROJECT);
    await ipc.call(CHANNELS.browserOpenTab, PROJECT);
    await ipc.call(CHANNELS.browserCloseTab, TAB);
    await ipc.call(CHANNELS.browserSelectTab, TAB);
    await ipc.call(CHANNELS.browserNavigate, { ...TAB, text: 'exemplo.com' });
    await ipc.call(CHANNELS.browserBack, TAB);
    await ipc.call(CHANNELS.browserForward, TAB);
    await ipc.call(CHANNELS.browserReload, TAB);
    await ipc.call(CHANNELS.browserStop, TAB);
    await ipc.call(CHANNELS.browserFocusPage, PROJECT);
    await ipc.call(CHANNELS.browserOpenDevtools, TAB);
    expect(ipc.browser.state).toHaveBeenCalledWith('p1');
    // O renderer nunca escolhe o endereço da aba nova: só o projeto chega ao serviço.
    expect(ipc.browser.openTab).toHaveBeenCalledWith('p1');
    expect(ipc.browser.closeTab).toHaveBeenCalledWith('p1', 't1');
    expect(ipc.browser.selectTab).toHaveBeenCalledWith('p1', 't1');
    expect(ipc.browser.navigate).toHaveBeenCalledWith('p1', 't1', 'exemplo.com');
    expect(ipc.browser.back).toHaveBeenCalledWith('p1', 't1');
    expect(ipc.browser.forward).toHaveBeenCalledWith('p1', 't1');
    expect(ipc.browser.reload).toHaveBeenCalledWith('p1', 't1');
    expect(ipc.browser.stop).toHaveBeenCalledWith('p1', 't1');
    expect(ipc.browser.focusPage).toHaveBeenCalledWith('p1');
    expect(ipc.browser.openDevTools).toHaveBeenCalledWith('p1', 't1');
  });

  it('snapshot devolve a imagem do serviço', async () => {
    expect(await setup().call(CHANNELS.browserSnapshot, PROJECT)).toEqual({
      ok: true,
      data: 'data:image/png;base64,AA',
    });
  });

  it('set-bounds válido chega ao serviço já convertido pelo zoom', async () => {
    const ipc = setup({ zoom: 1.25, content: { width: 2000, height: 1200 } });
    await ipc.call(CHANNELS.browserSetBounds, {
      ...PROJECT,
      bounds: { x: 10.4, y: 20.6, width: 300.5, height: 400 },
    });
    expect(ipc.browser.setBounds).toHaveBeenCalledWith('p1', {
      x: 13,
      y: 26,
      width: 376,
      height: 500,
    });
  });

  it('set-bounds fora da área de conteúdo esconde', async () => {
    const ipc = setup();
    await ipc.call(CHANNELS.browserSetBounds, {
      ...PROJECT,
      bounds: { x: 1200, y: 0, width: 600, height: 100 },
    });
    expect(ipc.browser.setBounds).toHaveBeenCalledWith('p1', null);
  });

  it('set-bounds sem janela esconde', async () => {
    const ipc = setup({ content: null });
    await ipc.call(CHANNELS.browserSetBounds, { ...PROJECT, bounds: RECT });
    expect(ipc.browser.setBounds).toHaveBeenCalledWith('p1', null);
  });

  it('set-bounds com área vazia esconde', async () => {
    const ipc = setup();
    await ipc.call(CHANNELS.browserSetBounds, { ...PROJECT, bounds: { ...RECT, width: 0 } });
    expect(ipc.browser.setBounds).toHaveBeenCalledWith('p1', null);
  });

  it('set-bounds com null esconde', async () => {
    const ipc = setup();
    await ipc.call(CHANNELS.browserSetBounds, { ...PROJECT, bounds: null });
    expect(ipc.browser.setBounds).toHaveBeenCalledWith('p1', null);
  });

  it('clear-data sem confirmação não apaga nada e devolve o estado atual', async () => {
    const ipc = setup({ confirm: false });
    expect(await ipc.call(CHANNELS.browserClearData, PROJECT)).toEqual(OK_STATE);
    expect(ipc.clearSession).not.toHaveBeenCalled();
    expect(ipc.clearAgentSession).not.toHaveBeenCalled();
    expect(ipc.browser.forgetProject).not.toHaveBeenCalled();
    expect(ipc.agent.forgetProject).not.toHaveBeenCalled();
  });

  it('clear-data confirmado esquece as abas, limpa a sessão e devolve o estado novo', async () => {
    const ipc = setup();
    expect(await ipc.call(CHANNELS.browserClearData, PROJECT)).toEqual(OK_STATE);
    // As páginas fecham antes de a sessão ser limpa: uma página viva regravaria o armazenamento.
    expect(ipc.order).toEqual(['forget', 'agent-forget', 'clear', 'agent-clear']);
    expect(ipc.clearAgentSession).toHaveBeenCalledWith('p1');
    expect(ipc.browser.setYielded).toHaveBeenLastCalledWith('p1', false);
    expect(ipc.clearSession).toHaveBeenCalledWith('p1');
    expect(ipc.browser.state).toHaveBeenCalledWith('p1');
  });

  it('clear-data de projeto que não existe nem pergunta', async () => {
    const ipc = setup();
    ipc.browser.state.mockReturnValueOnce({
      ok: false,
      error: { code: 'VALIDATION_FAILED', message: 'x', retryable: false },
    } as never);
    expect(await ipc.call(CHANNELS.browserClearData, PROJECT)).toMatchObject({ ok: false });
    expect(ipc.confirmClear).not.toHaveBeenCalled();
  });

  it('open-external abre o endereço https da aba', async () => {
    const ipc = setup();
    expect(await ipc.call(CHANNELS.browserOpenExternal, TAB)).toEqual(OK);
    expect(ipc.openExternal).toHaveBeenCalledWith('https://exemplo.com/a');
  });

  it.each([undefined, 'http://localhost:3000/', 'about:blank'])(
    'open-external recusa a aba com endereço %s',
    async (url) => {
      const ipc = setup();
      ipc.browser.urlOf.mockReturnValueOnce(url);
      expect(await ipc.call(CHANNELS.browserOpenExternal, TAB)).toMatchObject({
        ok: false,
        error: { code: 'VALIDATION_FAILED', message: BROWSER_EXTERNAL_HTTPS_ONLY },
      });
      expect(ipc.openExternal).not.toHaveBeenCalled();
    },
  );
});

describe('abas de agente nos canais do navegador', () => {
  const AGENT_TAB = { projectId: 'p1', tabId: 'g1' };
  const REFUSED = { ok: false, error: { code: 'VALIDATION_FAILED' } };

  it('o estado traz as abas da pessoa e as do agente', async () => {
    const ipc = setup({ agentTabs: ['g1'] });
    expect(await ipc.call(CHANNELS.browserState, PROJECT)).toEqual({
      ok: true,
      data: { projectId: 'p1', tabs: [agentTab('g1')], activeTabId: null },
    });
  });

  it('escolher uma aba de agente passa a olhá-la e cede a página da pessoa, sem trocar a aba ativa dela', async () => {
    const ipc = setup({ agentTabs: ['g1'] });
    expect(await ipc.call(CHANNELS.browserSelectTab, AGENT_TAB)).toMatchObject({
      ok: true,
      data: { activeTabId: 'g1' },
    });
    expect(ipc.agent.lookAt).toHaveBeenCalledWith('p1', 'g1');
    expect(ipc.browser.setYielded).toHaveBeenLastCalledWith('p1', true);
    expect(ipc.browser.selectTab).not.toHaveBeenCalled();
  });

  it('escolher ou abrir uma aba da pessoa deixa de olhar a do agente', async () => {
    const ipc = setup({ agentTabs: ['g1'] });
    await ipc.call(CHANNELS.browserSelectTab, AGENT_TAB);
    await ipc.call(CHANNELS.browserSelectTab, TAB);
    expect(ipc.agent.lookAt).toHaveBeenLastCalledWith('p1', null);
    expect(ipc.browser.setYielded).toHaveBeenLastCalledWith('p1', false);
    expect(ipc.browser.selectTab).toHaveBeenCalledWith('p1', 't1');

    await ipc.call(CHANNELS.browserSelectTab, AGENT_TAB);
    await ipc.call(CHANNELS.browserOpenTab, PROJECT);
    expect(ipc.agent.lookAt).toHaveBeenLastCalledWith('p1', null);
    expect(ipc.browser.setYielded).toHaveBeenLastCalledWith('p1', false);
  });

  it('fechar uma aba de agente vai para o serviço do agente e devolve a página da pessoa', async () => {
    const ipc = setup({ agentTabs: ['g1'] });
    await ipc.call(CHANNELS.browserSelectTab, AGENT_TAB);
    expect(await ipc.call(CHANNELS.browserCloseTab, AGENT_TAB)).toMatchObject({ ok: true });
    expect(ipc.agent.closeByPerson).toHaveBeenCalledWith('p1', 'g1');
    expect(ipc.browser.closeTab).not.toHaveBeenCalled();
    expect(ipc.browser.setYielded).toHaveBeenLastCalledWith('p1', false);
  });

  it('navegar, voltar, avançar e recarregar numa aba de agente vão para o serviço do agente', async () => {
    const ipc = setup({ agentTabs: ['g1'] });
    expect(
      await ipc.call(CHANNELS.browserNavigate, { ...AGENT_TAB, text: 'exemplo.com' }),
    ).toMatchObject({ ok: true, data: { projectId: 'p1' } });
    expect(ipc.agent.navigateByPerson).toHaveBeenCalledWith('p1', 'g1', 'exemplo.com');
    expect(await ipc.call(CHANNELS.browserBack, AGENT_TAB)).toEqual(OK);
    expect(await ipc.call(CHANNELS.browserForward, AGENT_TAB)).toEqual(OK);
    expect(await ipc.call(CHANNELS.browserReload, AGENT_TAB)).toEqual(OK);
    expect(ipc.agent.stepByPerson.mock.calls).toEqual([
      ['p1', 'g1', 'back'],
      ['p1', 'g1', 'forward'],
      ['p1', 'g1', 'reload'],
    ]);
    for (const name of ['navigate', 'back', 'forward', 'reload'] as const) {
      expect(ipc.browser[name]).not.toHaveBeenCalled();
    }
  });

  it('a recusa do serviço do agente ao navegar volta para a tela', async () => {
    const ipc = setup({ agentTabs: ['g1'] });
    ipc.agent.navigateByPerson.mockReturnValueOnce({
      ok: false,
      error: {
        code: 'VALIDATION_FAILED',
        message: 'Esse endereço não abre aqui.',
        retryable: false,
      },
    });
    expect(
      await ipc.call(CHANNELS.browserNavigate, { ...AGENT_TAB, text: 'file:///c:/x' }),
    ).toMatchObject({ ok: false, error: { message: 'Esse endereço não abre aqui.' } });
  });

  it('parar e abrir as ferramentas de desenvolvedor são recusados numa aba de agente', async () => {
    const ipc = setup({ agentTabs: ['g1'] });
    expect(await ipc.call(CHANNELS.browserStop, AGENT_TAB)).toMatchObject(REFUSED);
    expect(await ipc.call(CHANNELS.browserOpenDevtools, AGENT_TAB)).toMatchObject(REFUSED);
    expect(ipc.browser.stop).not.toHaveBeenCalled();
    expect(ipc.browser.openDevTools).not.toHaveBeenCalled();
  });

  it('abrir no navegador do sistema usa o endereço da aba do agente, com a mesma regra de https', async () => {
    const ipc = setup({ agentTabs: ['g1'] });
    expect(await ipc.call(CHANNELS.browserOpenExternal, AGENT_TAB)).toEqual(OK);
    expect(ipc.openExternal).toHaveBeenCalledWith('https://agente.exemplo/');
    expect(ipc.browser.urlOf).not.toHaveBeenCalled();
    ipc.agent.urlOf.mockReturnValueOnce('http://localhost:3000/');
    expect(await ipc.call(CHANNELS.browserOpenExternal, AGENT_TAB)).toMatchObject(REFUSED);
  });

  it('o retângulo vai para os dois serviços, já conferido', async () => {
    const ipc = setup({ agentTabs: ['g1'] });
    await ipc.call(CHANNELS.browserSetBounds, { ...PROJECT, bounds: RECT });
    expect(ipc.agent.setBounds).toHaveBeenLastCalledWith('p1', RECT);
    await ipc.call(CHANNELS.browserSetBounds, { ...PROJECT, bounds: { ...RECT, x: 5000 } });
    expect(ipc.browser.setBounds).toHaveBeenLastCalledWith('p1', null);
    expect(ipc.agent.setBounds).toHaveBeenLastCalledWith('p1', null);
  });

  it('o retângulo de um projeto que não existe não chega ao serviço do agente', async () => {
    const ipc = setup();
    ipc.browser.setBounds.mockReturnValueOnce({
      ok: false,
      error: { code: 'VALIDATION_FAILED', message: 'x', retryable: false },
    } as never);
    await ipc.call(CHANNELS.browserSetBounds, { ...PROJECT, bounds: RECT });
    expect(ipc.agent.setBounds).not.toHaveBeenCalled();
  });

  it('o foco e a imagem parada vão para a página que a pessoa está olhando', async () => {
    const ipc = setup({ agentTabs: ['g1'] });
    await ipc.call(CHANNELS.browserFocusPage, PROJECT);
    expect(ipc.browser.focusPage).toHaveBeenCalledTimes(1);
    expect(ipc.agent.focusPage).not.toHaveBeenCalled();

    await ipc.call(CHANNELS.browserSelectTab, AGENT_TAB);
    await ipc.call(CHANNELS.browserFocusPage, PROJECT);
    expect(ipc.agent.focusPage).toHaveBeenCalledWith('p1');
    expect(ipc.browser.focusPage).toHaveBeenCalledTimes(1);
    expect(await ipc.call(CHANNELS.browserSnapshot, PROJECT)).toEqual({
      ok: true,
      data: 'data:image/png;base64,AG',
    });
    expect(ipc.browser.snapshot).not.toHaveBeenCalled();
  });

  it('agent-access devolve só rótulos e sim ou não, e recusa remetente de outra origem', async () => {
    const ipc = setup();
    const result = await ipc.call(CHANNELS.browserAgentAccess);
    expect(result).toEqual({
      ok: true,
      data: {
        supported: true,
        programs: [
          { label: 'Claude Code', access: true },
          { label: 'Antigravity CLI', access: false },
        ],
      },
    });
    expect(JSON.stringify(result)).not.toMatch(/127\.0\.0\.1|token|Bearer/i);
    expect(
      await ipc.call(CHANNELS.browserAgentAccess, undefined, 'https://exemplo.com/'),
    ).toMatchObject({ ok: false, error: { code: 'PERMISSION_DENIED' } });
  });
});
