import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { CHANNELS, type AppResult } from '@project-hub/contracts';
import type { Session, WebContents } from 'electron';
import { describe, expect, expectTypeOf, it, vi } from 'vitest';
import {
  applyContentSecurityPolicy,
  CONTENT_SECURITY_POLICY,
  denyAllPermissions,
  isAllowedExternalUrl,
  isAllowedNavigation,
  isFileUrlInside,
  isTrustedSenderUrl,
  restrictFileRequests,
  restrictNavigation,
} from '../src/main/security';
import { buildProjectHubApi } from '../src/preload/api';

// Os módulos testados só importam tipos do Electron. Os objetos do Electron que eles recebem
// (sessão e webContents) são substituídos por versões falsas, que guardam os ouvintes registrados.

function required<T>(value: T | undefined, what: string): T {
  if (value === undefined) {
    throw new Error(`${what} não foi registrado`);
  }
  return value;
}

type NavigateEvent = { url: string; preventDefault: () => void };
type OpenHandler = (details: { url: string }) => { action: string };

function fakeWebContents() {
  let navigateListener: ((event: NavigateEvent) => void) | undefined;
  let openHandler: OpenHandler | undefined;
  const contents = {
    on(name: string, listener: (event: NavigateEvent) => void) {
      if (name === 'will-navigate') {
        navigateListener = listener;
      }
      return contents;
    },
    setWindowOpenHandler(handler: OpenHandler) {
      openHandler = handler;
    },
  };
  return {
    contents: contents as unknown as WebContents,
    /** Dispara `will-navigate` e diz se a navegação foi impedida. */
    navigate(url: string): boolean {
      const preventDefault = vi.fn();
      required(navigateListener, 'will-navigate')({ url, preventDefault });
      return preventDefault.mock.calls.length > 0;
    },
    /** Simula `window.open(url)` e devolve a resposta do handler. */
    open(url: string) {
      return required(openHandler, 'setWindowOpenHandler')({ url });
    },
  };
}

/** `confirmed` é a resposta da pessoa no diálogo de confirmação: Abrir (true) ou Cancelar (false). */
function setupNavigation(appOrigin: string, confirmed = true) {
  const confirmExternal = vi.fn((_url: string) => Promise.resolve(confirmed));
  const openExternal = vi.fn((_url: string) => Promise.resolve());
  const fake = fakeWebContents();
  restrictNavigation(fake.contents, appOrigin, { confirmExternal, openExternal });
  return { ...fake, confirmExternal, openExternal };
}

/** Deixa terminar a confirmação e a abertura, que são assíncronas. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

/** Roda `action` e devolve as rejeições que ficaram sem tratamento. */
async function unhandledRejectionsDuring(action: () => void): Promise<unknown[]> {
  const unhandled: unknown[] = [];
  const onUnhandled = (reason: unknown) => unhandled.push(reason);
  process.on('unhandledRejection', onUnhandled);
  try {
    action();
    await new Promise((resolve) => setTimeout(resolve, 20));
  } finally {
    process.off('unhandledRejection', onUnhandled);
  }
  return unhandled;
}

describe('CONTENT_SECURITY_POLICY', () => {
  it('CSP restritiva', () => {
    expect(CONTENT_SECURITY_POLICY).toContain("default-src 'self'");
    expect(CONTENT_SECURITY_POLICY).toContain("object-src 'none'");
  });

  it('é exatamente a política do ADR 0007', () => {
    expect(CONTENT_SECURITY_POLICY).toBe(
      "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; object-src 'none'; base-uri 'none'; frame-ancestors 'none'",
    );
  });

  it('a meta do index.html repete a política, sem frame-ancestors', () => {
    // O navegador ignora frame-ancestors em <meta>; essa diretiva só vale no cabeçalho.
    const html = readFileSync(new URL('../src/renderer/index.html', import.meta.url), 'utf8');
    const meta = /<meta\s+http-equiv="Content-Security-Policy"\s+content="([^"]*)"/i.exec(html);
    const withoutFrameAncestors = CONTENT_SECURITY_POLICY.split('; ')
      .filter((directive) => !directive.startsWith('frame-ancestors'))
      .join('; ');
    expect(meta?.[1]).toBe(withoutFrameAncestors);
  });
});

describe('isAllowedNavigation', () => {
  it('bloqueia navegação para fora do app', () => {
    expect(isAllowedNavigation('https://evil.example', 'file://')).toBe(false);
  });

  it('em desenvolvimento, aceita a origem do servidor do Vite', () => {
    expect(isAllowedNavigation('http://localhost:5173/#/projetos', 'http://localhost:5173')).toBe(
      true,
    );
  });

  it.each([
    'http://localhost:5174/',
    'https://localhost:5173/',
    'http://127.0.0.1:5173/',
    'http://localhost:5173.evil.example/',
    'http://localhost:5173@evil.example/',
    'https://evil.example/',
    'file:///C:/Windows/win.ini',
    'javascript:alert(1)',
    'data:text/html,<h1>x</h1>',
    'about:blank',
    'não é uma URL',
  ])('em desenvolvimento, recusa %s', (url) => {
    expect(isAllowedNavigation(url, 'http://localhost:5173')).toBe(false);
  });

  // Em file:// a origem é opaca: nenhuma navegação de documento é aceita. As rotas do renderer
  // trocam só o hash, o que não dispara will-navigate.
  it.each([
    'file:///C:/app/out/renderer/index.html',
    'file:///C:/Users/fulano/repositorio/pagina.html',
    'https://evil.example/',
  ])('em file://, recusa %s', (url) => {
    expect(isAllowedNavigation(url, 'file://')).toBe(false);
  });

  it('duas origens opacas nunca contam como a mesma', () => {
    expect(isAllowedNavigation('file:///C:/pagina.html', 'null')).toBe(false);
  });
});

describe('isAllowedExternalUrl', () => {
  it('bloqueia javascript: em links externos', () => {
    expect(isAllowedExternalUrl('javascript:alert(1)')).toBe(false);
  });

  it.each(['https://example.com/docs', 'mailto:contato@example.com'])('aceita %s', (url) => {
    expect(isAllowedExternalUrl(url)).toBe(true);
  });

  it.each([
    'http://example.com/',
    'file:///C:/Windows/System32/calc.exe',
    'data:text/html,<script>alert(1)</script>',
    'vbscript:msgbox(1)',
    'ms-settings:privacy',
    'smb://servidor/pasta',
    'não é uma URL',
    '',
  ])('recusa %s', (url) => {
    expect(isAllowedExternalUrl(url)).toBe(false);
  });
});

describe('restrictNavigation', () => {
  it('impede a saída do app e abre https: no navegador do sistema depois de Abrir', async () => {
    const { navigate, confirmExternal, openExternal } = setupNavigation('file://');
    expect(navigate('https://example.com/docs')).toBe(true);
    await settle();
    expect(confirmExternal).toHaveBeenCalledWith('https://example.com/docs');
    expect(openExternal).toHaveBeenCalledWith('https://example.com/docs');
  });

  it.each(['javascript:alert(1)', 'file:///C:/Users/fulano/pagina.html', 'http://example.com/'])(
    'impede %s sem perguntar nem abrir nada fora',
    async (url) => {
      const { navigate, confirmExternal, openExternal } = setupNavigation('file://');
      expect(navigate(url)).toBe(true);
      await settle();
      expect(confirmExternal).not.toHaveBeenCalled();
      expect(openExternal).not.toHaveBeenCalled();
    },
  );

  it('deixa seguir a navegação na origem do servidor de desenvolvimento', async () => {
    const { navigate, confirmExternal, openExternal } = setupNavigation('http://localhost:5173');
    expect(navigate('http://localhost:5173/')).toBe(false);
    await settle();
    expect(confirmExternal).not.toHaveBeenCalled();
    expect(openExternal).not.toHaveBeenCalled();
  });

  it('nega toda janela nova e só pergunta e abre fora https: e mailto:', async () => {
    const { open, confirmExternal, openExternal } = setupNavigation('file://');
    for (const url of [
      'https://example.com/',
      'mailto:contato@example.com',
      'file:///C:/Windows/System32/calc.exe',
      'javascript:alert(1)',
    ]) {
      expect(open(url)).toEqual({ action: 'deny' });
    }
    await settle();
    const allowed = [['https://example.com/'], ['mailto:contato@example.com']];
    expect(confirmExternal.mock.calls).toEqual(allowed);
    expect(openExternal.mock.calls).toEqual(allowed);
  });

  it('nega janela nova até para a origem do app', async () => {
    const { open, confirmExternal, openExternal } = setupNavigation('http://localhost:5173');
    expect(open('http://localhost:5173/')).toEqual({ action: 'deny' });
    await settle();
    expect(confirmExternal).not.toHaveBeenCalled();
    expect(openExternal).not.toHaveBeenCalled();
  });

  it.each(['https://example.com/docs', 'mailto:contato@example.com'])(
    'não abre %s quando a pessoa escolhe Cancelar',
    async (url) => {
      const { navigate, open, confirmExternal, openExternal } = setupNavigation('file://', false);
      expect(navigate(url)).toBe(true);
      expect(open(url)).toEqual({ action: 'deny' });
      await settle();
      expect(confirmExternal.mock.calls).toEqual([[url], [url]]);
      expect(openExternal).not.toHaveBeenCalled();
    },
  );

  it('pergunta e abre com a URL normalizada', async () => {
    const { open, confirmExternal, openExternal } = setupNavigation('file://');
    open('https://example.com/a b');
    await settle();
    expect(confirmExternal).toHaveBeenCalledWith('https://example.com/a%20b');
    expect(openExternal).toHaveBeenCalledWith('https://example.com/a%20b');
  });

  // Funções comuns, não vi.fn: o vi.fn trata a promessa que devolve e esconderia a rejeição.
  it.each([
    ['rejeita', () => Promise.reject(new Error('diálogo indisponível'))],
    [
      'lança erro',
      () => {
        throw new Error('diálogo indisponível');
      },
    ],
  ])('quando o diálogo %s, não abre e não deixa rejeição solta', async (_case, confirmExternal) => {
    const opened: string[] = [];
    const fake = fakeWebContents();
    restrictNavigation(fake.contents, 'file://', {
      confirmExternal,
      openExternal: (url) => {
        opened.push(url);
        return Promise.resolve();
      },
    });
    const unhandled = await unhandledRejectionsDuring(() => fake.open('https://example.com/'));
    expect(opened).toEqual([]);
    expect(unhandled).toEqual([]);
  });

  it('trata a falha ao abrir fora, sem rejeição solta', async () => {
    const opened: string[] = [];
    const fake = fakeWebContents();
    restrictNavigation(fake.contents, 'file://', {
      confirmExternal: () => Promise.resolve(true),
      openExternal: (url) => {
        opened.push(url);
        return Promise.reject(new Error('nenhum programa para o protocolo'));
      },
    });
    const unhandled = await unhandledRejectionsDuring(() =>
      fake.open('mailto:contato@example.com'),
    );
    expect(opened).toEqual(['mailto:contato@example.com']);
    expect(unhandled).toEqual([]);
  });
});

describe('applyContentSecurityPolicy', () => {
  type HeadersListener = (
    details: { responseHeaders?: Record<string, string[]> },
    callback: (response: unknown) => void,
  ) => void;

  function capture() {
    let listener: HeadersListener | undefined;
    const session = {
      webRequest: {
        onHeadersReceived(registered: HeadersListener) {
          listener = registered;
        },
      },
    } as unknown as Session;
    applyContentSecurityPolicy(session);
    return required(listener, 'onHeadersReceived');
  }

  it('acrescenta a política completa, com frame-ancestors, ao cabeçalho da resposta', () => {
    const callback = vi.fn();
    capture()({ responseHeaders: { 'Content-Type': ['text/html'] } }, callback);
    expect(callback).toHaveBeenCalledWith({
      responseHeaders: {
        'Content-Type': ['text/html'],
        'Content-Security-Policy': [CONTENT_SECURITY_POLICY],
      },
    });
  });

  it('funciona quando a resposta não tem cabeçalhos', () => {
    const callback = vi.fn();
    capture()({}, callback);
    expect(callback).toHaveBeenCalledWith({
      responseHeaders: { 'Content-Security-Policy': [CONTENT_SECURITY_POLICY] },
    });
  });
});

// Em file://, a CSP trata como 'self' qualquer arquivo local. O filtro de pedidos file: limita o
// renderer à pasta dele. Os caminhos saem de resolve() para valer no Windows, no macOS e no Linux.
const rendererDir = resolve('/app/out/renderer');
const fileUrl = (...segments: string[]) => pathToFileURL(join(...segments)).href;

describe('isFileUrlInside', () => {
  it.each([
    ['o index.html', fileUrl(rendererDir, 'index.html')],
    ['o index.html com hash de rota', `${fileUrl(rendererDir, 'index.html')}#/projetos`],
    ['um arquivo de subpasta', fileUrl(rendererDir, 'assets', 'index.js')],
  ])('aceita %s', (_case, url) => {
    expect(isFileUrlInside(url, rendererDir)).toBe(true);
  });

  it.each([
    ['arquivo fora da pasta', fileUrl(resolve('/repositorio'), 'script.js')],
    ['pasta irmã com o mesmo prefixo', fileUrl(resolve('/app/out/renderer-x'), 'index.html')],
    ['subida com ..', `${pathToFileURL(rendererDir).href}/../../segredo.txt`],
    ['barra codificada', `${pathToFileURL(rendererDir).href}/..%2F..%2Fsegredo.txt`],
    ['a própria pasta', pathToFileURL(rendererDir).href],
    ['arquivo em outro host', 'file://servidor/compartilhamento/index.html'],
    ['URL que não é file:', 'http://localhost:5173/index.html'],
    ['texto que não é URL', 'não é uma URL'],
  ])('recusa %s', (_case, url) => {
    expect(isFileUrlInside(url, rendererDir)).toBe(false);
  });
});

describe('restrictFileRequests', () => {
  type RequestListener = (
    details: { url: string },
    callback: (response: { cancel?: boolean }) => void,
  ) => void;

  function capture() {
    let listener: RequestListener | undefined;
    const session = {
      webRequest: {
        onBeforeRequest(registered: RequestListener) {
          listener = registered;
        },
      },
    } as unknown as Session;
    restrictFileRequests(session, rendererDir);
    const registered = required(listener, 'onBeforeRequest');
    return (url: string) => {
      const callback = vi.fn();
      registered({ url }, callback);
      return callback.mock.calls[0]?.[0];
    };
  }

  it('cancela pedido file: fora da pasta do renderer', () => {
    expect(capture()(fileUrl(resolve('/repositorio'), 'script.js'))).toEqual({ cancel: true });
  });

  it('deixa passar arquivo da pasta do renderer e pedido que não é file:', () => {
    const request = capture();
    expect(request(fileUrl(rendererDir, 'index.html'))).toEqual({ cancel: false });
    expect(request('http://localhost:5173/@vite/client')).toEqual({ cancel: false });
  });
});

describe('denyAllPermissions', () => {
  it('nega pedidos e consultas de permissão', () => {
    let request:
      | ((contents: unknown, permission: string, callback: (granted: boolean) => void) => void)
      | undefined;
    let check: ((contents: unknown, permission: string) => boolean) | undefined;
    const session = {
      setPermissionRequestHandler(handler: typeof request) {
        request = handler;
      },
      setPermissionCheckHandler(handler: typeof check) {
        check = handler;
      },
    } as unknown as Session;
    denyAllPermissions(session);

    for (const permission of ['media', 'geolocation', 'notifications', 'openExternal']) {
      const callback = vi.fn();
      required(request, 'setPermissionRequestHandler')(null, permission, callback);
      expect(callback).toHaveBeenCalledWith(false);
      expect(required(check, 'setPermissionCheckHandler')(null, permission)).toBe(false);
    }
  });
});

// Quem chama um canal IPC precisa ser o aplicativo. Em desenvolvimento, a origem é a do Vite. Em
// produção, a origem é file://, opaca, e o remetente confiável é o index.html da pasta do renderer.
describe('isTrustedSenderUrl', () => {
  it('em desenvolvimento, aceita o quadro na origem do servidor do Vite, com rota no hash', () => {
    expect(
      isTrustedSenderUrl('http://localhost:5173/#/projects', 'http://localhost:5173', rendererDir),
    ).toBe(true);
  });

  it.each(['https://evil.example/', 'http://localhost:5174/', 'file:///C:/app/index.html', ''])(
    'em desenvolvimento, recusa %j',
    (url) => {
      expect(isTrustedSenderUrl(url, 'http://localhost:5173', rendererDir)).toBe(false);
    },
  );

  it('em produção, aceita o index.html da pasta do renderer, com rota no hash', () => {
    expect(
      isTrustedSenderUrl(`${fileUrl(rendererDir, 'index.html')}#/projects`, 'file://', rendererDir),
    ).toBe(true);
  });

  it.each([
    ['arquivo de fora da pasta do renderer', fileUrl(resolve('/repositorio'), 'index.html')],
    ['site externo', 'https://evil.example/'],
    ['quadro sem endereço', ''],
  ])('em produção, recusa %s', (_case, url) => {
    expect(isTrustedSenderUrl(url, 'file://', rendererDir)).toBe(false);
  });
});

describe('buildProjectHubApi', () => {
  it('preload só chama canais conhecidos', async () => {
    const calls: string[] = [];
    const api = buildProjectHubApi(async (channel) => {
      calls.push(channel);
      return { ok: true, data: 'pong' };
    });
    await api.ping();
    expect(calls).toEqual([CHANNELS.appPing]);
  });

  it('a API exposta tem só ping e os métodos de projetos, sem envio genérico', () => {
    const api = buildProjectHubApi(() => Promise.resolve(undefined));
    expect(Object.keys(api).sort()).toEqual(['ping', 'projects']);
    expect(Object.keys(api.projects).sort()).toEqual(['add', 'chooseDirectory', 'list']);
  });

  it('projects.list e projects.add usam os canais de contracts, e add leva o caminho', async () => {
    const calls: Array<[string, unknown]> = [];
    const api = buildProjectHubApi((channel, payload) => {
      calls.push([channel, payload]);
      return Promise.resolve({ ok: true, data: [] });
    });
    await api.projects.list();
    await api.projects.add({ path: 'C:\\Projetos\\app' });
    expect(calls).toEqual([
      [CHANNELS.projectsList, undefined],
      [CHANNELS.projectsAdd, { path: 'C:\\Projetos\\app' }],
    ]);
  });

  it('projects.chooseDirectory aceita null, que é o cancelamento da pessoa', async () => {
    const api = buildProjectHubApi(() => Promise.resolve({ ok: true, data: null }));
    await expect(api.projects.chooseDirectory()).resolves.toEqual({ ok: true, data: null });
  });

  it.each([
    ['ping', (api: ReturnType<typeof buildProjectHubApi>) => api.ping(), { ok: true, data: 42 }],
    [
      'projects.list',
      (api: ReturnType<typeof buildProjectHubApi>) => api.projects.list(),
      { ok: true, data: [{ id: 'p1' }] },
    ],
    [
      'projects.add',
      (api: ReturnType<typeof buildProjectHubApi>) => api.projects.add({ path: 'C:\\app' }),
      { ok: false, error: { code: 'NAO_EXISTE', message: 'x', retryable: false } },
    ],
    [
      'projects.chooseDirectory',
      (api: ReturnType<typeof buildProjectHubApi>) => api.projects.chooseDirectory(),
      undefined,
    ],
  ])(
    '%s: resposta fora do contrato vira VALIDATION_FAILED, sem repassar o dado',
    async (_name, call, response) => {
      const api = buildProjectHubApi(() => Promise.resolve(response));
      await expect(call(api)).resolves.toEqual({
        ok: false,
        error: { code: 'VALIDATION_FAILED', message: expect.any(String), retryable: false },
      });
    },
  );

  it('ping devolve a resposta do processo principal', async () => {
    const api = buildProjectHubApi(() => Promise.resolve({ ok: true, data: 'pong' }));
    await expect(api.ping()).resolves.toEqual({ ok: true, data: 'pong' });
    expectTypeOf(api.ping).toEqualTypeOf<() => Promise<AppResult<string>>>();
  });
});
