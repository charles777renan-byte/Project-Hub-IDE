import {
  BROWSER_EXTERNAL_HTTPS_ONLY,
  CHANNELS,
  type BrowserStateDto,
} from '@project-hub/contracts';
import type { IpcMainInvokeEvent } from 'electron';
import { describe, expect, it, vi } from 'vitest';
import type { BrowserService } from '../src/main/browser/browser-service';
import { registerBrowserHandlers } from '../src/main/ipc/browser';
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
    snapshot: vi.fn(() => Promise.resolve({ ok: true as const, data: 'data:image/png;base64,AA' })),
    focusPage: vi.fn(() => OK),
    openDevTools: vi.fn(() => OK),
    urlOf: vi.fn((): string | undefined => 'https://exemplo.com/a'),
    suspendProject: vi.fn(),
    forgetProject: vi.fn(),
    dispose: vi.fn(),
  } satisfies BrowserService;
}

function setup(
  options: {
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
  const order: string[] = [];
  browser.forgetProject.mockImplementation(() => void order.push('forget'));
  const clearSession = vi.fn(() => {
    order.push('clear');
    return Promise.resolve();
  });
  const confirmClear = vi.fn(() => Promise.resolve(options.confirm ?? true));
  const openExternal = vi.fn((_url: string) => Promise.resolve());
  registerBrowserHandlers(registry, isTrusted, {
    browser,
    contentSize: () =>
      options.content === null ? undefined : (options.content ?? { width: 1600, height: 900 }),
    zoomFactor: () => options.zoom ?? 1,
    confirmClear,
    clearSession,
    openExternal,
  });
  return {
    browser,
    order,
    clearSession,
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
  it('registra os 15 canais de pedido do navegador', () => {
    expect(setup().channels()).toEqual(Object.keys(VALID).sort());
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
    expect(ipc.browser.forgetProject).not.toHaveBeenCalled();
  });

  it('clear-data confirmado esquece as abas, limpa a sessão e devolve o estado novo', async () => {
    const ipc = setup();
    expect(await ipc.call(CHANNELS.browserClearData, PROJECT)).toEqual(OK_STATE);
    // As páginas fecham antes de a sessão ser limpa: uma página viva regravaria o armazenamento.
    expect(ipc.order).toEqual(['forget', 'clear']);
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
