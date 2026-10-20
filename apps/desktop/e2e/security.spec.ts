import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';

// Segurança do renderer no aplicativo construído (seção 17.2, 24.4 e ADR 0001). Cada teste confere um
// efeito observável da janela real, não a configuração: o que a página alcança, o que o cabeçalho da
// resposta diz e o que acontece quando a página tenta sair da pasta do aplicativo.

/** Tipo de recurso que a página tenta carregar de uma URL `file:`. */
type ResourceKind = 'script' | 'stylesheet';

/** Pede à página que carregue o recurso e devolve o evento que ela recebeu: `load` ou `error`. */
function loadResource(page: Page, kind: ResourceKind, url: string): Promise<'load' | 'error'> {
  return page.evaluate(
    ({ kind, url }) =>
      new Promise<'load' | 'error'>((resolve) => {
        const element = document.createElement(kind === 'script' ? 'script' : 'link');
        if (element instanceof HTMLLinkElement) {
          element.rel = 'stylesheet';
          element.href = url;
        } else if (element instanceof HTMLScriptElement) {
          element.src = url;
        }
        element.addEventListener('load', () => resolve('load'));
        element.addEventListener('error', () => resolve('error'));
        document.head.append(element);
      }),
    { kind, url },
  );
}

test.describe('renderer isolado', () => {
  test('renderer não tem Node.js nem ipcRenderer', async ({ launchApp }) => {
    const { page } = await launchApp();

    expect(await page.evaluate(() => typeof require)).toBe('undefined');
    expect(await page.evaluate(() => typeof process)).toBe('undefined');
    expect(await page.evaluate(() => 'ipcRenderer' in window)).toBe(false);
    expect(await page.evaluate(() => typeof module)).toBe('undefined');
    expect(await page.evaluate(() => typeof Buffer)).toBe('undefined');
    expect(await page.evaluate(() => typeof __dirname)).toBe('undefined');
  });

  test('o preload expõe só a API tipada, sem invoke nem send genéricos', async ({ launchApp }) => {
    const { page } = await launchApp();

    const surface = await page.evaluate(() => {
      const api = (window as unknown as { projectHub?: Record<string, unknown> }).projectHub;
      if (api === undefined) return null;
      const names = (value: unknown): string[] =>
        typeof value === 'object' && value !== null ? Object.keys(value).sort() : [];
      return {
        root: names(api),
        projects: names(api['projects']),
        missions: names(api['missions']),
        approvals: names(api['approvals']),
      };
    });

    expect(surface).not.toBeNull();
    expect(surface?.root).toEqual(['approvals', 'missions', 'ping', 'projects']);
    const everyName = [
      ...(surface?.root ?? []),
      ...(surface?.projects ?? []),
      ...(surface?.missions ?? []),
      ...(surface?.approvals ?? []),
    ];
    for (const generic of ['invoke', 'send', 'sendSync', 'on', 'once', 'ipcRenderer']) {
      expect(everyName).not.toContain(generic);
    }
    // A API funciona de verdade: o ping passa pelo IPC e pela checagem do remetente.
    expect(await page.evaluate(() => window.projectHub.ping())).toEqual({
      ok: true,
      data: 'pong',
    });
  });
});

test.describe('política de conteúdo', () => {
  test('a resposta do documento traz a CSP completa no cabeçalho', async ({ launchApp }) => {
    const { page } = await launchApp();

    const [response] = await Promise.all([
      page.waitForEvent(
        'response',
        (candidate) =>
          candidate.request().isNavigationRequest() && candidate.frame() === page.mainFrame(),
      ),
      page.reload(),
    ]);

    const policy = response.headers()['content-security-policy'];
    expect(policy).toBeDefined();
    for (const directive of [
      "default-src 'self'",
      "script-src 'self'",
      "style-src 'self'",
      "object-src 'none'",
      "base-uri 'none'",
      "frame-ancestors 'none'",
    ]) {
      expect(policy).toContain(directive);
    }
    expect(policy).not.toMatch(/unsafe-(inline|eval)/);
  });

  test('o cabeçalho tem efeito: a página não consegue se embutir num iframe', async ({
    launchApp,
  }) => {
    const { page } = await launchApp();
    const appUrl = page.url();

    // `frame-ancestors` só vale como cabeçalho (a <meta> do index.html não o tem).
    await page.evaluate((url) => {
      const frame = document.createElement('iframe');
      frame.src = url;
      document.body.append(frame);
    }, appUrl);

    const childUrls = () =>
      page
        .mainFrame()
        .childFrames()
        .map((frame) => frame.url());
    await expect.poll(childUrls).toEqual(['chrome-error://chromewebdata/']);
    expect(childUrls()).not.toContain(appUrl);
  });
});

test.describe('arquivos fora da pasta do renderer', () => {
  test('script, folha de estilo e fetch de fora não carregam', async ({ launchApp, dataDir }) => {
    const { page } = await launchApp();

    const outsideScript = join(dataDir, 'fora.js');
    writeFileSync(outsideScript, 'window.__escapou = true;\n');
    const outsideStyle = join(dataDir, 'fora.css');
    writeFileSync(outsideStyle, 'body { display: none; }\n');
    const outsideData = join(dataDir, 'segredo.txt');
    writeFileSync(outsideData, 'conteudo que o renderer nao pode ler\n');

    // Pedidos cancelados pelo filtro de arquivos (`restrictFileRequests`) falham no cliente.
    const failures = new Map<string, string>();
    page.on('requestfailed', (request) => {
      failures.set(request.url(), request.failure()?.errorText ?? '');
    });

    // Controle: um arquivo dentro da pasta do renderer (a folha de estilo do próprio aplicativo)
    // carrega pelo mesmo caminho.
    const ownStylesheet = await page.evaluate(
      () => document.querySelector<HTMLLinkElement>('link[rel="stylesheet"]')?.href,
    );
    expect(ownStylesheet).toMatch(/\/out\/renderer\/assets\/.+\.css$/);
    const inside = `${String(ownStylesheet)}?controle`;
    expect(await loadResource(page, 'stylesheet', inside)).toBe('load');
    expect(failures.has(inside)).toBe(false);

    // Arquivos de fora, por caminho absoluto e por `..` a partir da pasta do renderer.
    const outsideUrls = {
      script: pathToFileURL(outsideScript).href,
      stylesheet: pathToFileURL(outsideStyle).href,
      parent: new URL('../../package.json', page.url()).href,
    };
    expect(await loadResource(page, 'script', outsideUrls.script)).toBe('error');
    expect(await loadResource(page, 'stylesheet', outsideUrls.stylesheet)).toBe('error');
    expect(await loadResource(page, 'stylesheet', outsideUrls.parent)).toBe('error');
    for (const url of Object.values(outsideUrls)) {
      await expect.poll(() => failures.get(url)).toContain('ERR_BLOCKED_BY_CLIENT');
    }
    // O script de fora não rodou.
    expect(await page.evaluate(() => '__escapou' in window)).toBe(false);

    // Leitura direta por fetch também falha, tanto para um arquivo comum quanto para o de fora.
    for (const url of [pathToFileURL(outsideData).href, outsideUrls.parent]) {
      const outcome = await page.evaluate(async (target) => {
        try {
          await fetch(target);
          return 'leu';
        } catch {
          return 'falhou';
        }
      }, url);
      expect(outcome).toBe('falhou');
    }
  });
});

test.describe('navegação', () => {
  test('navegação para domínio externo é bloqueada', async ({ launchApp, dataDir }) => {
    const { app, page } = await launchApp();
    const startUrl = page.url();

    // Registra, no processo principal, cada tentativa de navegação e se ela foi impedida. O ouvinte
    // do teste entra depois do ouvinte da aplicação, então vê o resultado dele.
    await app.evaluate(({ BrowserWindow }) => {
      const attempts: { url: string; prevented: boolean }[] = [];
      Object.assign(globalThis, { navigationAttempts: attempts });
      const contents = BrowserWindow.getAllWindows()[0]?.webContents;
      contents?.on('will-navigate', (event) => {
        attempts.push({ url: event.url, prevented: event.defaultPrevented });
      });
    });
    const attempts = () =>
      app.evaluate(
        () =>
          (globalThis as unknown as { navigationAttempts: { url: string; prevented: boolean }[] })
            .navigationAttempts,
      );

    // O diálogo nativo de confirmação (https e mailto) tem cobertura nos testes unitários de
    // `security.ts`; aqui o destino é http, que é recusado antes de qualquer pergunta.
    const otherFile = pathToFileURL(join(dataDir, 'outro.html')).href;
    await page.evaluate(() => {
      window.location.href = 'http://example.invalid/';
    });
    await expect.poll(async () => (await attempts()).length).toBe(1);
    await page.evaluate((url) => {
      window.location.href = url;
    }, otherFile);
    await expect.poll(async () => (await attempts()).length).toBe(2);

    expect(await attempts()).toEqual([
      { url: 'http://example.invalid/', prevented: true },
      { url: otherFile, prevented: true },
    ]);
    expect(page.url()).toBe(startUrl);

    // Janela nova também é negada: nenhuma janela surge, e o `page.open` não devolve janela.
    const opened = await page.evaluate(() => window.open('http://example.invalid/') !== null);
    expect(opened).toBe(false);
    expect(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length)).toBe(1);

    // O aplicativo segue de pé, na mesma página, com a interface montada e o IPC respondendo. A
    // conferência usa `evaluate`: depois de uma navegação cancelada, o Playwright ainda espera por
    // ela nas ações com localizador.
    expect(page.url()).toBe(startUrl);
    expect(
      await page.evaluate(() => document.querySelector('nav[aria-label="Principal"]') !== null),
    ).toBe(true);
    expect(await page.evaluate(() => window.projectHub.ping())).toEqual({
      ok: true,
      data: 'pong',
    });
  });
});
