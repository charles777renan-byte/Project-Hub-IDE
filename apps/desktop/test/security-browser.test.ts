import type { Session, WebContents } from 'electron';
import { describe, expect, it, vi } from 'vitest';
import {
  browserPartition,
  browserUserAgent,
  configureBrowserSession,
  guardBrowserContents,
} from '../src/main/security';

// Políticas das sessões do navegador interno. Como em security.test.ts, a sessão e o webContents do Electron são
// versões falsas que guardam os ouvintes registrados.

function required<T>(value: T | undefined, what: string): T {
  if (value === undefined) throw new Error(`${what} não foi registrado`);
  return value;
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('browserPartition', () => {
  it('monta a partição persistente do projeto', () => {
    expect(browserPartition('3f2a-b1_X')).toBe('persist:navegador-3f2a-b1_X');
  });

  it.each(['../x', 'a b', '', 'a/b', 'a:b'])('recusa o id %j', (id) => {
    expect(() => browserPartition(id)).toThrow();
  });
});

describe('browserUserAgent', () => {
  it('tira Electron e o nome do app do agente de usuário', () => {
    const ua =
      'Mozilla/5.0 (Windows NT 10.0) AppleWebKit/537.36 (KHTML, like Gecko) project-hub/0.1.0 Chrome/140.0.0.0 Electron/44.9.0 Safari/537.36';
    expect(browserUserAgent(ua, 'project-hub')).toBe(
      'Mozilla/5.0 (Windows NT 10.0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36',
    );
  });

  it('tira o nome do app mesmo com caracteres especiais', () => {
    const ua = 'Mozilla/5.0 @project-hub/desktop/1.0.0 Chrome/140.0.0.0 Electron/44.9.0 Safari/537.36';
    expect(browserUserAgent(ua, '@project-hub/desktop')).toBe(
      'Mozilla/5.0 Chrome/140.0.0.0 Safari/537.36',
    );
  });
});

describe('configureBrowserSession', () => {
  type RequestListener = (
    details: { url: string },
    callback: (response: { cancel?: boolean }) => void,
  ) => void;

  function setup() {
    let beforeRequest: RequestListener | undefined;
    let request:
      | ((contents: unknown, permission: string, callback: (granted: boolean) => void) => void)
      | undefined;
    let check: ((contents: unknown, permission: string) => boolean) | undefined;
    const onHeadersReceived = vi.fn();
    const on = vi.fn();
    const setUserAgent = vi.fn();
    const session = {
      webRequest: {
        onBeforeRequest(listener: RequestListener) {
          beforeRequest = listener;
        },
        onHeadersReceived,
      },
      setPermissionRequestHandler(handler: typeof request) {
        request = handler;
      },
      setPermissionCheckHandler(handler: typeof check) {
        check = handler;
      },
      setUserAgent,
      on,
    } as unknown as Session;
    configureBrowserSession(session, 'UA de teste');
    return {
      ask(url: string) {
        const callback = vi.fn();
        required(beforeRequest, 'onBeforeRequest')({ url }, callback);
        return callback.mock.calls[0]?.[0];
      },
      request: () => required(request, 'setPermissionRequestHandler'),
      check: () => required(check, 'setPermissionCheckHandler'),
      onHeadersReceived,
      on,
      setUserAgent,
    };
  }

  it('cancela todo pedido file:', () => {
    expect(setup().ask('file:///C:/Windows/win.ini')).toEqual({ cancel: true });
  });

  it.each(['http://localhost:3000/a.js', 'https://x.dev/', 'blob:https://x.dev/1', 'data:image/png;base64,AA'])(
    'deixa passar %s',
    (url) => {
      expect(setup().ask(url)).toEqual({ cancel: false });
    },
  );

  it('nega todo pedido e toda consulta de permissão', () => {
    const session = setup();
    for (const permission of ['media', 'geolocation', 'notifications', 'clipboard-read']) {
      const callback = vi.fn();
      session.request()(null, permission, callback);
      expect(callback).toHaveBeenCalledWith(false);
      expect(session.check()(null, permission)).toBe(false);
    }
  });

  it('troca o agente de usuário da sessão', () => {
    expect(setup().setUserAgent).toHaveBeenCalledWith('UA de teste');
  });

  it('não põe a CSP do app nas páginas', () => {
    expect(setup().onHeadersReceived).not.toHaveBeenCalled();
  });

  it('não mexe nos downloads: o diálogo "Salvar como" do sistema é quem decide o destino', () => {
    expect(setup().on).not.toHaveBeenCalledWith('will-download', expect.anything());
  });
});

describe('guardBrowserContents', () => {
  type NavigateEvent = { url: string; isMainFrame?: boolean; preventDefault: () => void };
  type OpenHandler = (details: { url: string }) => { action: string };

  function setup(confirmed = true) {
    const listeners = new Map<string, (event: NavigateEvent) => void>();
    let openHandler: OpenHandler | undefined;
    const contents = {
      on(name: string, listener: (event: NavigateEvent) => void) {
        listeners.set(name, listener);
        return contents;
      },
      setWindowOpenHandler(handler: OpenHandler) {
        openHandler = handler;
      },
    };
    const confirmExternal = vi.fn((_url: string) => Promise.resolve(confirmed));
    const openExternal = vi.fn((_url: string) => Promise.resolve());
    const openTab = vi.fn();
    guardBrowserContents(contents as unknown as WebContents, {
      external: { confirmExternal, openExternal },
      openTab,
    });
    /** Dispara o evento e diz se a navegação foi impedida. */
    const fire = (name: string, url: string, isMainFrame = true): boolean => {
      const preventDefault = vi.fn();
      required(listeners.get(name), name)({ url, isMainFrame, preventDefault });
      return preventDefault.mock.calls.length > 0;
    };
    return {
      fire,
      open: (url: string) => required(openHandler, 'setWindowOpenHandler')({ url }),
      confirmExternal,
      openExternal,
      openTab,
    };
  }

  it.each(['javascript:alert(1)', 'file:///C:/x.html', 'data:text/html,<b>x</b>', 'chrome://gpu'])(
    'barra a navegação para %s',
    (url) => {
      expect(setup().fire('will-navigate', url)).toBe(true);
    },
  );

  it.each(['https://exemplo.com/', 'http://localhost:3000/', 'about:blank'])(
    'deixa navegar para %s',
    (url) => {
      expect(setup().fire('will-navigate', url)).toBe(false);
    },
  );

  it('barra redirecionamento para file:', () => {
    expect(setup().fire('will-redirect', 'file:///C:/x.html')).toBe(true);
  });

  it('deixa redirecionar para https', () => {
    expect(setup().fire('will-redirect', 'https://exemplo.com/b')).toBe(false);
  });

  it('não barra a navegação de um quadro interno (about:srcdoc de um iframe)', () => {
    expect(setup().fire('will-redirect', 'about:srcdoc', false)).toBe(false);
  });

  it('mailto: é barrado e vai para a confirmação que já existe', async () => {
    const guard = setup();
    expect(guard.fire('will-navigate', 'mailto:a@b.c')).toBe(true);
    await settle();
    expect(guard.confirmExternal).toHaveBeenCalledWith('mailto:a@b.c');
    expect(guard.openExternal).toHaveBeenCalledWith('mailto:a@b.c');
  });

  it('mailto: recusado na confirmação não abre', async () => {
    const guard = setup(false);
    guard.fire('will-navigate', 'mailto:a@b.c');
    await settle();
    expect(guard.openExternal).not.toHaveBeenCalled();
  });

  it('endereço bloqueado que não é link externo não chega à confirmação', async () => {
    const guard = setup();
    guard.fire('will-navigate', 'file:///C:/x.html');
    await settle();
    expect(guard.confirmExternal).not.toHaveBeenCalled();
  });

  it('janela nova com https vira aba e nunca abre janela', () => {
    const guard = setup();
    expect(guard.open('https://exemplo.com/nova')).toEqual({ action: 'deny' });
    expect(guard.openTab).toHaveBeenCalledWith('https://exemplo.com/nova');
  });

  it('janela nova com javascript: é ignorada', () => {
    const guard = setup();
    expect(guard.open('javascript:alert(1)')).toEqual({ action: 'deny' });
    expect(guard.openTab).not.toHaveBeenCalled();
  });

  it('janela nova com about:blank é ignorada (não há o que mostrar)', () => {
    const guard = setup();
    expect(guard.open('about:blank')).toEqual({ action: 'deny' });
    expect(guard.openTab).not.toHaveBeenCalled();
  });
});
