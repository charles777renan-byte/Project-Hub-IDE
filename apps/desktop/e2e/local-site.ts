import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { ElectronApplication } from '@playwright/test';

// Auxiliares dos testes do navegador interno: um site local descartável (nenhum teste usa a internet) e o acesso,
// pelo processo principal, à página que o navegador mostra. A página não é do app: os testes a alcançam pela view
// presa à janela, nunca por um canal do app.

const PAGE = (title: string, body: string): string =>
  `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>${title}</title></head><body>${body}</body></html>`;

/**
 * Servidor HTTP em 127.0.0.1, numa porta livre. `/` devolve uma página com o título "Site de teste" e um link
 * `target=_blank` para `/outra`; `/cookie` grava o cookie `visita=1` (com validade, para sobreviver ao reinício do
 * app); `/le-cookie` devolve o cookie recebido como texto.
 */
export async function startLocalSite(): Promise<{ url: string; close(): Promise<void> }> {
  const server = createServer((request, response) => {
    const path = new URL(request.url ?? '/', 'http://127.0.0.1').pathname;
    response.setHeader('Content-Type', 'text/html; charset=utf-8');
    response.setHeader('Cache-Control', 'no-store');
    if (path === '/') {
      response.end(
        PAGE(
          'Site de teste',
          '<h1>Site de teste</h1><a id="nova" href="/outra" target="_blank">Outra</a>',
        ),
      );
    } else if (path === '/outra') {
      response.end(PAGE('Outra página', '<h1>Outra página</h1>'));
    } else if (path === '/cookie') {
      response.setHeader('Set-Cookie', 'visita=1; Max-Age=3600; Path=/');
      response.end(PAGE('Cookie gravado', '<p id="texto">gravado</p>'));
    } else if (path === '/le-cookie') {
      response.end(PAGE('Cookie lido', `<p id="texto">${request.headers.cookie ?? ''}</p>`));
    } else {
      response.statusCode = 404;
      response.end(PAGE('Não encontrada', '<h1>404</h1>'));
    }
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${port}`,
    close: () =>
      new Promise<void>((resolve) => {
        // As conexões que a página deixou abertas não podem segurar o fechamento.
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  };
}

/**
 * Roda `script` na página que o navegador do projeto visível mostra agora (a view presa à janela), pelo processo
 * principal. Falha se não há página à vista.
 */
export function evalInBrowserPage<T>(app: ElectronApplication, script: string): Promise<T> {
  return app.evaluate(async ({ BrowserWindow }, code) => {
    const win = BrowserWindow.getAllWindows()[0];
    const view = win?.contentView.children.find((child) => 'webContents' in child) as
      { webContents: Electron.WebContents } | undefined;
    if (view === undefined) throw new Error('Nenhuma página do navegador está na janela.');
    return (await view.webContents.executeJavaScript(code, true)) as unknown;
  }, script) as Promise<T>;
}

export type ViewState = {
  /** Quantas páginas do navegador estão presas à janela (0 ou 1). */
  attached: number;
  /** O retângulo da página à vista, no sistema de coordenadas da janela. */
  bounds: { x: number; y: number; width: number; height: number } | null;
  /** O endereço da página à vista. */
  url: string | null;
  /** Quantas janelas o app tem. */
  windows: number;
};

/** O que o processo principal tem na janela agora. */
export function viewState(app: ElectronApplication): Promise<ViewState> {
  return app.evaluate(({ BrowserWindow }) => {
    const windows = BrowserWindow.getAllWindows();
    const views = (windows[0]?.contentView.children ?? []).filter(
      (child) => 'webContents' in child,
    ) as unknown as { webContents: Electron.WebContents; getBounds(): Electron.Rectangle }[];
    const view = views[0];
    return {
      attached: views.length,
      bounds: view === undefined ? null : view.getBounds(),
      url: view === undefined ? null : view.webContents.getURL(),
      windows: windows.length,
    };
  });
}

/** Manda uma tecla à página à vista, como se viesse do teclado (passa pelo `before-input-event` do app). */
export function pressInBrowserPage(
  app: ElectronApplication,
  keyCode: string,
  modifiers: ('control' | 'alt' | 'shift')[] = [],
): Promise<void> {
  return app.evaluate(
    ({ BrowserWindow }, input) => {
      const win = BrowserWindow.getAllWindows()[0];
      const view = win?.contentView.children.find((child) => 'webContents' in child) as
        { webContents: Electron.WebContents } | undefined;
      if (view === undefined) throw new Error('Nenhuma página do navegador está na janela.');
      view.webContents.sendInputEvent({ type: 'keyDown', ...input });
      view.webContents.sendInputEvent({ type: 'keyUp', ...input });
    },
    { keyCode, modifiers },
  );
}
