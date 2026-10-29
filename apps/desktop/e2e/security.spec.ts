import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';

// Segurança do renderer no aplicativo construído (seção 17.2, 24.4 e ADR 0001). Cada teste confere um
// efeito observável da janela real, não a configuração: o que a página alcança, o que o cabeçalho da
// resposta diz e o que acontece quando a página tenta sair da pasta do aplicativo.

/** PNG de 1x1 pixel, válido: uma imagem de fora que carregaria se o filtro não a cancelasse. */
const ONE_PIXEL_PNG =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

/** Tipo de recurso que a página tenta carregar de uma URL `file:`. */
type ResourceKind = 'script' | 'stylesheet' | 'image';

/** Pede à página que carregue o recurso e devolve o evento que ela recebeu: `load` ou `error`. */
function loadResource(page: Page, kind: ResourceKind, url: string): Promise<'load' | 'error'> {
  return page.evaluate(
    ({ kind, url }) =>
      new Promise<'load' | 'error'>((resolve) => {
        const element =
          kind === 'script'
            ? Object.assign(document.createElement('script'), { src: url })
            : kind === 'stylesheet'
              ? Object.assign(document.createElement('link'), { rel: 'stylesheet', href: url })
              : Object.assign(document.createElement('img'), { src: url });
        element.addEventListener('load', () => resolve('load'));
        element.addEventListener('error', () => resolve('error'));
        document.head.append(element);
      }),
    { kind, url },
  );
}

/** Guarda o que a rede da página fez com cada pedido: cancelado pelo cliente ou concluído. */
function watchRequests(page: Page) {
  const failed = new Map<string, string>();
  const finished = new Set<string>();
  page.on('requestfailed', (request) => {
    failed.set(request.url(), request.failure()?.errorText ?? '');
  });
  page.on('requestfinished', (request) => {
    finished.add(request.url());
  });
  return { failed, finished };
}

/** Diretivas de uma política de conteúdo, cada uma com a lista exata das suas fontes. */
function parsePolicy(policy: string): Record<string, string[]> {
  const directives = policy
    .split(';')
    .map((directive) => directive.trim())
    .filter((directive) => directive !== '')
    .map((directive) => {
      const [name = '', ...sources] = directive.split(/\s+/);
      return [name, sources] as const;
    });
  return Object.fromEntries(directives);
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
        limits: names(api['limits']),
        worktrees: names(api['worktrees']),
        terminals: names(api['terminals']),
        workspaces: names(api['workspaces']),
        providers: names(api['providers']),
      };
    });

    expect(surface).not.toBeNull();
    expect(surface?.root).toEqual([
      'activity',
      'approvals',
      'limits',
      'missions',
      'ping',
      'profile',
      'projects',
      'providers',
      'system',
      'terminals',
      'workspaces',
      'worktrees',
    ]);
    expect(surface?.limits).toEqual(['get', 'refresh', 'subscribe']);
    expect(surface?.terminals).toEqual([
      'list',
      'onEvent',
      'resize',
      'subscribe',
      'unsubscribe',
      'write',
    ]);
    const everyName = [
      ...(surface?.root ?? []),
      ...(surface?.projects ?? []),
      ...(surface?.missions ?? []),
      ...(surface?.approvals ?? []),
      ...(surface?.limits ?? []),
      ...(surface?.worktrees ?? []),
      ...(surface?.terminals ?? []),
      ...(surface?.workspaces ?? []),
      ...(surface?.providers ?? []),
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

  test('a janela abre com sandbox, isolamento de contexto e sem integração com Node.js', async ({
    launchApp,
  }) => {
    const { app } = await launchApp();

    // As preferências com que o processo principal criou a janela (e não só o que a página vê).
    // `getLastWebPreferences` existe no Electron 44.9.0, mas não consta dos tipos: se uma versão
    // futura o tirar, o teste falha com TypeError, e não passa em silêncio.
    const preferences = await app.evaluate(({ BrowserWindow }) => {
      type WithPreferences = { getLastWebPreferences(): Record<string, unknown> | undefined };
      const windows = BrowserWindow.getAllWindows();
      const contents = windows[0]?.webContents as unknown as WithPreferences | undefined;
      const used = contents?.getLastWebPreferences();
      return {
        windows: windows.length,
        sandbox: used?.['sandbox'],
        contextIsolation: used?.['contextIsolation'],
        nodeIntegration: used?.['nodeIntegration'],
        webSecurity: used?.['webSecurity'],
      };
    });

    expect(preferences).toEqual({
      windows: 1,
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: true,
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
    // Cada diretiva com a lista exata de fontes, e nenhuma diretiva a mais.
    expect(parsePolicy(policy ?? '')).toEqual({
      'default-src': ["'self'"],
      'script-src': ["'self'"],
      'style-src': ["'self'"],
      'img-src': ["'self'", 'data:'],
      'object-src': ["'none'"],
      'base-uri': ["'none'"],
      'frame-ancestors': ["'none'"],
    });
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

test.describe('fontes locais', () => {
  /** Faces que o `fonts.css` declara: Inter 400 a 700 e JetBrains Mono 400 a 600, peso normal. */
  const FACES = [
    ...[400, 500, 600, 700].map((weight) => ({ family: 'Inter', weight })),
    ...[400, 500, 600].map((weight) => ({ family: 'JetBrains Mono', weight })),
  ];

  test('Inter e JetBrains Mono carregam de arquivos do aplicativo, sob a CSP e o filtro de arquivos', async ({
    launchApp,
  }) => {
    const { page } = await launchApp();

    // Observa a carga nova da página: pedidos de rede, mensagens do console e violações da CSP. O
    // ouvinte do evento entra antes de qualquer script da página, por isso `addInitScript` + reload.
    const requests = watchRequests(page);
    const consoleProblems: string[] = [];
    page.on('console', (message) => {
      if (message.type() === 'error' || message.type() === 'warning') {
        consoleProblems.push(message.text());
      }
    });
    await page.addInitScript(() => {
      const violations: string[] = [];
      Object.assign(window, { cspViolations: violations });
      document.addEventListener('securitypolicyviolation', (event) => {
        violations.push(`${event.violatedDirective} ${event.blockedURI}`);
      });
    });
    await page.reload();
    await expect(page.getByRole('link', { name: 'Início', exact: true })).toBeVisible();

    // O app construído carrega por `loadFile`, ou seja, `file://`, como o aplicativo empacotado. O
    // servidor de desenvolvimento (`loadURL`) não é exercitado por este teste.
    expect(page.url()).toMatch(/^file:\/\//);

    // Pede cada face e espera: `load` resolve com as faces carregadas e rejeita se a fonte falhar.
    const faces = await page.evaluate(async (wanted) => {
      for (const { family, weight } of wanted) {
        const loaded = await document.fonts.load(`${weight} 1em '${family}'`);
        if (loaded.length !== 1) throw new Error(`${family} ${weight}: ${loaded.length} faces`);
      }
      await document.fonts.ready;
      return [...document.fonts].map((face) => ({
        family: face.family.replace(/^["']|["']$/g, ''),
        weight: Number(face.weight),
        status: face.status,
      }));
    }, FACES);
    expect(faces).toEqual(FACES.map((face) => ({ ...face, status: 'loaded' })));

    // Os arquivos vieram da pasta do renderer: pedido concluído, nenhum cancelado, todos `.woff2`.
    const fontUrls = [...requests.finished].filter((url) => url.endsWith('.woff2'));
    expect(fontUrls).toHaveLength(FACES.length);
    for (const url of fontUrls) {
      expect(url).toMatch(/\/out\/renderer\/assets\/.+\.woff2$/);
      expect(requests.failed.has(url)).toBe(false);
    }

    // O texto da tela usa a fonte local de verdade: o Chromium diz qual fonte formou os glifos do
    // elemento. `isCustomFont` é `true` só para @font-face (a de sistema vem como `false`).
    const cdp = await page.context().newCDPSession(page);
    const platformFonts = async (selector: string) => {
      await cdp.send('DOM.enable');
      await cdp.send('CSS.enable');
      const { root } = await cdp.send('DOM.getDocument', { depth: 0 });
      const { nodeId } = await cdp.send('DOM.querySelector', { nodeId: root.nodeId, selector });
      expect(nodeId, selector).toBeGreaterThan(0);
      const { fonts } = await cdp.send('CSS.getPlatformFontsForNode', { nodeId });
      return fonts.map(({ familyName, isCustomFont }) => ({ familyName, isCustomFont }));
    };
    const sansFonts = await platformFonts('.topbar__home a');
    expect(sansFonts.length).toBeGreaterThan(0);
    expect(sansFonts.every(({ isCustomFont }) => isCustomFont)).toBe(true);
    expect(sansFonts.map(({ familyName }) => familyName)).toEqual(
      expect.arrayContaining([expect.stringContaining('Inter')]),
    );
    // Um elemento mono (classe `mono`, sem estilo inline) para conferir a segunda família.
    await page.evaluate(() => {
      const probe = document.createElement('span');
      probe.className = 'mono';
      probe.id = 'sonda-mono';
      probe.textContent = 'abc 123 ção';
      document.body.append(probe);
      // Força o cálculo de layout: sem ele o Chromium ainda não formou os glifos do elemento novo.
      probe.getBoundingClientRect();
    });
    const monoFonts = await platformFonts('#sonda-mono');
    expect(monoFonts.length).toBeGreaterThan(0);
    expect(monoFonts.every(({ isCustomFont }) => isCustomFont)).toBe(true);
    expect(monoFonts.map(({ familyName }) => familyName)).toEqual(
      expect.arrayContaining([expect.stringContaining('JetBrains Mono')]),
    );

    // Nada foi bloqueado pela CSP nem recusado pelo decodificador de fontes.
    expect(
      await page.evaluate(() => (window as unknown as { cspViolations: string[] }).cspViolations),
    ).toEqual([]);
    expect(consoleProblems).toEqual([]);
  });
});

test.describe('arquivos fora da pasta do renderer', () => {
  test('script, folha de estilo e imagem de fora não carregam', async ({ launchApp, dataDir }) => {
    const { page } = await launchApp();

    // Arquivos reais fora da pasta do renderer: sem o filtro, os três carregariam.
    const outsideScript = join(dataDir, 'fora.js');
    writeFileSync(outsideScript, 'window.__escapou = true;\n');
    const outsideStyle = join(dataDir, 'fora.css');
    writeFileSync(outsideStyle, 'body { display: none; }\n');
    const outsideImage = join(dataDir, 'fora.png');
    writeFileSync(outsideImage, Buffer.from(ONE_PIXEL_PNG, 'base64'));

    // Pedidos cancelados pelo filtro de arquivos (`restrictFileRequests`) falham no cliente.
    const requests = watchRequests(page);

    // Controle: arquivos da pasta do renderer não são cancelados por nenhum dos três canais. O
    // arquivo é a folha de estilo do próprio aplicativo; como script ou imagem ele não serve, mas o
    // pedido é concluído, e é isso que o controle confere.
    const ownStylesheet = await page.evaluate(
      () => document.querySelector<HTMLLinkElement>('link[rel="stylesheet"]')?.href,
    );
    expect(ownStylesheet).toMatch(/\/out\/renderer\/assets\/.+\.css$/);
    const inside = {
      stylesheet: `${String(ownStylesheet)}?controle-estilo`,
      script: `${String(ownStylesheet)}?controle-script`,
      image: `${String(ownStylesheet)}?controle-imagem`,
    };
    expect(await loadResource(page, 'stylesheet', inside.stylesheet)).toBe('load');
    await loadResource(page, 'script', inside.script);
    await loadResource(page, 'image', inside.image);
    for (const url of Object.values(inside)) {
      await expect.poll(() => requests.finished.has(url)).toBe(true);
      expect(requests.failed.has(url)).toBe(false);
    }

    // Arquivos de fora, por caminho absoluto e por `..` a partir da pasta do renderer.
    const parent = new URL('../../package.json', page.url()).href;
    const outside = [
      { kind: 'script', url: pathToFileURL(outsideScript).href },
      { kind: 'stylesheet', url: pathToFileURL(outsideStyle).href },
      { kind: 'image', url: pathToFileURL(outsideImage).href },
      { kind: 'stylesheet', url: parent },
      { kind: 'image', url: parent },
    ] as const;
    for (const { kind, url } of outside) {
      expect(await loadResource(page, kind, url)).toBe('error');
      await expect.poll(() => requests.failed.get(url)).toContain('ERR_BLOCKED_BY_CLIENT');
      expect(requests.finished.has(url)).toBe(false);
    }
    // O script de fora não rodou.
    expect(await page.evaluate(() => '__escapou' in window)).toBe(false);

    // `fetch` de `file:` não entra aqui: o Chromium o recusa a partir de uma página `file:` com ou
    // sem o filtro, então a falha não provaria nada sobre a proteção.
  });
});

test.describe('navegação', () => {
  test('navegação para domínio externo e para arquivo local é bloqueada', async ({
    launchApp,
    dataDir,
  }) => {
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

    // Janela nova também é negada: nenhuma janela surge, e o `window.open` não devolve janela.
    const opened = await page.evaluate(() => window.open('http://example.invalid/') !== null);
    expect(opened).toBe(false);
    await expect
      .poll(() => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length))
      .toBe(1);

    // O aplicativo segue de pé, na mesma página, com a interface montada e o IPC respondendo. A
    // conferência usa `evaluate`: depois de uma navegação cancelada, o Playwright ainda espera por
    // ela nas ações com localizador.
    expect(page.url()).toBe(startUrl);
    expect(await page.evaluate(() => document.querySelector('.topbar__home a') !== null)).toBe(
      true,
    );
    expect(await page.evaluate(() => window.projectHub.ping())).toEqual({
      ok: true,
      data: 'pong',
    });
  });
});
