import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import type { ElectronApplication, Locator, Page } from '@playwright/test';
import { createTempRepo } from '@project-hub/test-utils';
import { expect, test } from './fixtures';
import { SUPPORT_WINDOW_OPTIONS } from '../src/main/browser/agent/agent-window-options';
import { evalInBrowserPage, startLocalSite, viewState } from './local-site';
import { addGitProject, openProject, projectLink } from './missions';
import { decodePng, pixelAt } from './png';
import { expectTerminalToContain, fecharPainel } from './terminals';

// Os agentes dos terminais usando o navegador do projeto (fase 3). Tudo com dados descartáveis e páginas locais.
// O `claude` do menu "Abrir terminal" é trocado por um CLI falso (`fake-claude-browser.mjs`), que lê o que o app
// entrega ao terminal e chama o servidor de ferramentas de verdade. O teste comanda cada chamada por arquivo.

const FAKE_CLAUDE = join(import.meta.dirname, 'fixtures', 'fake-claude-browser.mjs');
const LIMIT = 'Limite de 4 abas do agente neste projeto. Feche uma com browser_close.';
const AGENT_NOTE = 'Aba de um agente. A sessão dela é separada da sua.';

type Reply = { isError: boolean; text: string | null; image: string | null };
type Access = { url: string; token: string; tools: string[]; permission: string[] };
type AgentTab = { id: string; url: string; title: string; loading: boolean };

/** O lado do teste da pasta de troca do `claude` falso que roda na pasta `repoPath`. */
function fakeAgent(repoPath: string) {
  const dir = join(tmpdir(), 'ph-fake-agent', basename(repoPath));
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  let step = 0;
  const waitFor = async (name: string): Promise<string> => {
    const file = join(dir, name);
    await expect
      .poll(() => existsSync(file), { timeout: 30_000, message: `o agente deveria gravar ${name}` })
      .toBe(true);
    return readFileSync(file, 'utf8');
  };
  const call = async (name: string, input: Record<string, unknown> = {}): Promise<Reply> => {
    step += 1;
    const target = join(dir, `roteiro-${String(step)}.json`);
    writeFileSync(`${target}.tmp`, JSON.stringify({ name, arguments: input }));
    renameSync(`${target}.tmp`, target);
    return JSON.parse(await waitFor(`saida-${String(step)}.json`)) as Reply;
  };
  return {
    call,
    /** A chamada tem de dar certo: devolve o texto da resposta. */
    async text(name: string, input: Record<string, unknown> = {}): Promise<string> {
      const reply = await call(name, input);
      expect(reply, `${name} deveria dar certo`).toMatchObject({ isError: false });
      return reply.text ?? '';
    },
    async open(url: string): Promise<AgentTab> {
      return JSON.parse(await this.text('browser_open', { url })) as AgentTab;
    },
    async tabs(): Promise<AgentTab[]> {
      return (JSON.parse(await this.text('browser_tabs')) as { tabs: AgentTab[] }).tabs;
    },
    /** A referência do elemento cuja linha no snapshot começa por `line` (papel e nome). */
    async ref(tabId: string, line: string): Promise<string> {
      const tree = await this.text('browser_snapshot', { tabId });
      const found = tree.split('\n').find((each) => each.includes(`${line} [ref=`));
      const ref = found === undefined ? null : /\[ref=(e\d+)\]/.exec(found);
      if (ref?.[1] === undefined) throw new Error(`"${line}" não está no snapshot:\n${tree}`);
      return ref[1];
    },
    /** A captura da aba, decodificada. */
    async shot(tabId: string) {
      const reply = await call('browser_screenshot', { tabId });
      expect(reply.isError).toBe(false);
      return decodePng(Buffer.from(reply.image ?? '', 'base64'));
    },
    async access(): Promise<Access> {
      return JSON.parse(await waitFor('acesso.json')) as Access;
    },
    /**
     * Encerra o `claude` falso, se ele ainda roda. Com o processo do terminal vivo, o app aberto pelo Playwright não
     * termina de fechar; por isso todo teste passa por aqui antes da limpeza.
     */
    async quit(): Promise<void> {
      step += 1;
      const target = join(dir, `roteiro-${String(step)}.json`);
      writeFileSync(`${target}.tmp`, JSON.stringify({ name: '__sair' }));
      renameSync(`${target}.tmp`, target);
      const until = Date.now() + 5000;
      while (!existsSync(join(dir, 'fim.json')) && Date.now() < until) {
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
    },
    dispose: () => rmSync(dir, { recursive: true, force: true }),
  };
}

/** Quantas cores diferentes há numa amostra da imagem. */
function colorsIn(pixels: ReturnType<typeof decodePng>): number {
  const seen = new Set<string>();
  for (let y = 0; y < pixels.height; y += 8) {
    for (let x = 0; x < pixels.width; x += 8) seen.add(pixelAt(pixels, x, y).join(','));
  }
  return seen.size;
}

const rightPanel = (page: Page): Locator =>
  page.getByRole('complementary', { name: 'Painel direito' });
const navigatorTab = (page: Page): Locator =>
  rightPanel(page)
    .getByRole('tablist', { name: 'Painéis laterais' })
    .getByRole('tab', { name: /^Navegador/ });
const address = (page: Page): Locator =>
  rightPanel(page).getByRole('textbox', { name: 'Endereço' });
const pageTab = (page: Page, name: string | RegExp): Locator =>
  rightPanel(page).getByRole('tablist', { name: 'Abas do navegador' }).getByRole('tab', { name });

async function openNavigator(page: Page): Promise<void> {
  await navigatorTab(page).click();
  await expect(address(page)).toBeVisible();
}

async function go(page: Page, app: ElectronApplication, url: string): Promise<void> {
  await address(page).fill(url);
  await address(page).press('Enter');
  await expect.poll(async () => (await viewState(app)).url).toBe(url);
}

/** Abre o Claude (falso) pelo menu "Abrir terminal" do projeto e espera ele alcançar o servidor de ferramentas. */
async function openAgentTerminal(page: Page, projectName: string): Promise<Locator> {
  await openProject(page, projectName, 'Terminais');
  await page.getByRole('button', { name: 'Abrir terminal' }).click();
  await page.getByRole('menuitem', { name: /Claude Code/ }).click();
  const pane = page.getByRole('region', { name: /^Painel Claude Code/ });
  await expectTerminalToContain(pane.locator('.terminal-view'), 'claude-falso: pronto', {
    timeout: 30_000,
  });
  return pane;
}

/** Uma chamada direta ao servidor de ferramentas, de fora do app. */
async function post(access: Access, headers: Record<string, string> = {}) {
  const response = await fetch(access.url, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${access.token}`,
      'content-type': 'application/json',
      accept: 'application/json, text/event-stream',
      ...headers,
    },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} }),
  });
  return { status: response.status, body: await response.text() };
}

test.describe('agentes no navegador do projeto', () => {
  test.skip(process.platform !== 'win32', 'Os agentes só alcançam o navegador no Windows.');
  test.setTimeout(180_000);

  let site: Awaited<ReturnType<typeof startLocalSite>>;
  let agent: ReturnType<typeof fakeAgent>;

  test.beforeEach(async ({ gitRepo }) => {
    site = await startLocalSite();
    agent = fakeAgent(gitRepo.path);
  });
  test.afterEach(async () => {
    await agent.quit();
    agent.dispose();
    await site.close();
  });

  test('o agente abre, lê, clica, digita, aperta Enter e captura a tela, sem a página aparecer', async ({
    launchApp,
    gitRepo,
  }) => {
    const { app, page } = await launchApp({
      dialogPath: gitRepo.path,
      panelClaudeScript: FAKE_CLAUDE,
    });
    const name = basename(gitRepo.path);
    await addGitProject(page, name);
    await openAgentTerminal(page, name);

    const access = await agent.access();
    expect(access.tools).toContain('browser_open');
    expect(access.permission).toEqual(['mcp__navegador']);

    const tab = await agent.open(`${site.url}/agente`);
    expect(tab).toMatchObject({ url: `${site.url}/agente`, title: 'Página do agente' });
    expect(await agent.text('browser_read_text', { tabId: tab.id })).toContain('Página do agente');

    const button = await agent.ref(tab.id, 'button "Mudar título"');
    expect(await agent.text('browser_click', { tabId: tab.id, ref: button })).toBe('Feito.');
    await expect.poll(async () => (await agent.tabs())[0]?.title).toBe('Clicado');

    const field = await agent.ref(tab.id, 'textbox "Campo de teste"');
    await agent.text('browser_type', { tabId: tab.id, text: 'olá', ref: field });
    await agent.text('browser_press_key', { tabId: tab.id, key: 'Enter' });
    expect(await agent.text('browser_read_text', { tabId: tab.id })).toContain('enviado: olá');
    expect(await agent.text('browser_console', { tabId: tab.id })).toContain('erro plantado');

    const shot = await agent.shot(tab.id);
    expect([shot.width, shot.height]).toEqual([1280, 800]);
    expect(colorsIn(shot)).toBeGreaterThan(1);

    // Nada disso pôs uma página na janela da pessoa, nem tirou o foco dela.
    expect((await viewState(app)).attached).toBe(0);
    expect(
      await app.evaluate(({ BrowserWindow }) => BrowserWindow.getFocusedWindow()?.isFocusable()),
    ).not.toBe(false);
  });

  test('com a tela a 150%, a captura segue em 1280x800 e o clique por coordenada cai no ponto da imagem', async ({
    launchApp,
    gitRepo,
  }) => {
    const { page } = await launchApp({
      dialogPath: gitRepo.path,
      panelClaudeScript: FAKE_CLAUDE,
      extraArgs: ['--force-device-scale-factor=1.5'],
    });
    const name = basename(gitRepo.path);
    await addGitProject(page, name);
    await openAgentTerminal(page, name);
    const tab = await agent.open(`${site.url}/agente`);

    const shot = await agent.shot(tab.id);
    expect([shot.width, shot.height]).toEqual([1280, 800]);
    expect(colorsIn(shot)).toBeGreaterThan(1);
    await agent.text('browser_click', { tabId: tab.id, x: 900, y: 500 });
    expect(await agent.text('browser_read_text', { tabId: tab.id })).toContain('ponto: 900,500');
  });

  test('funciona igual com o painel direito fechado e outro projeto na tela', async ({
    launchApp,
    gitRepo,
    gitEnv,
  }) => {
    const previous = Object.keys(gitEnv).map((key) => [key, process.env[key]] as const);
    Object.assign(process.env, gitEnv);
    const second = createTempRepo();
    for (const [key, value] of previous) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    try {
      const { app, page } = await launchApp({
        dialogPath: gitRepo.path,
        panelClaudeScript: FAKE_CLAUDE,
      });
      const nameA = basename(gitRepo.path);
      const nameB = basename(second.path);
      await addGitProject(page, nameA);
      const added = await page.evaluate(
        (path) => window.projectHub.projects.add({ path }),
        second.path,
      );
      expect(added.ok).toBe(true);
      await page.reload();
      await expect(projectLink(page, nameB)).toBeVisible();
      await openAgentTerminal(page, nameA);

      await openProject(page, nameB);
      await page.getByRole('button', { name: 'Ocultar painel direito' }).click();
      await expect(page.getByRole('button', { name: 'Mostrar painel direito' })).toBeVisible();

      const tab = await agent.open(`${site.url}/agente`);
      const button = await agent.ref(tab.id, 'button "Mudar título"');
      await agent.text('browser_click', { tabId: tab.id, ref: button });
      await expect.poll(async () => (await agent.tabs())[0]?.title).toBe('Clicado');
      const shot = await agent.shot(tab.id);
      expect([shot.width, shot.height]).toEqual([1280, 800]);
      expect(colorsIn(shot)).toBeGreaterThan(1);
      expect((await viewState(app)).attached).toBe(0);
    } finally {
      second.cleanup();
    }
  });

  test('a aba do agente aparece marcada; a pessoa olha, volta para a dela, e a captura segue', async ({
    launchApp,
    gitRepo,
  }) => {
    const { app, page } = await launchApp({
      dialogPath: gitRepo.path,
      panelClaudeScript: FAKE_CLAUDE,
    });
    const name = basename(gitRepo.path);
    await addGitProject(page, name);
    await openAgentTerminal(page, name);
    const tab = await agent.open(`${site.url}/agente`);

    // O ponto na aba Navegador vale com ela fechada.
    await expect(navigatorTab(page)).toHaveAccessibleName('Navegador: agente no navegador');
    await openNavigator(page);
    const agentTab = pageTab(page, 'Agente: Página do agente');
    await expect(agentTab).toBeVisible();
    await expect(agentTab).toHaveAttribute('aria-selected', 'false');
    expect((await viewState(app)).attached).toBe(0);

    // A pessoa escolhe a aba do agente: a página dele aparece na janela, com o aviso.
    await agentTab.click();
    await expect.poll(async () => (await viewState(app)).url).toBe(`${site.url}/agente`);
    await expect(rightPanel(page).getByText(AGENT_NOTE)).toBeVisible();
    expect(await evalInBrowserPage<string>(app, 'document.title')).toBe('Página do agente');
    // O agente segue usando a aba enquanto a pessoa olha.
    const button = await agent.ref(tab.id, 'button "Mudar título"');
    await agent.text('browser_click', { tabId: tab.id, ref: button });
    await expect(pageTab(page, 'Agente: Clicado')).toBeVisible();

    // A pessoa minimiza a janela olhando a aba do agente: a página volta para a janela de apoio, a captura do
    // agente segue funcionando, e a página reaparece no painel quando a janela volta.
    const mainWindow = (action: 'minimize' | 'restore'): Promise<void> =>
      app.evaluate(({ BrowserWindow }, what) => {
        const main = BrowserWindow.getAllWindows().find((each) => each.isFocusable());
        if (what === 'minimize') main?.minimize();
        else main?.restore();
      }, action);
    await mainWindow('minimize');
    await expect.poll(async () => (await viewState(app)).attached).toBe(0);
    const minimized = await agent.shot(tab.id);
    expect([minimized.width, minimized.height]).toEqual([1280, 800]);
    expect(colorsIn(minimized)).toBeGreaterThan(1);
    await mainWindow('restore');
    await expect.poll(async () => (await viewState(app)).url).toBe(`${site.url}/agente`);

    // De volta à aba da pessoa: a do agente sai da janela e a captura volta ao tamanho dela.
    await pageTab(page, 'Nova aba').click();
    await expect.poll(async () => (await viewState(app)).attached).toBe(0);
    await expect(rightPanel(page).getByText(AGENT_NOTE)).toHaveCount(0);
    const shot = await agent.shot(tab.id);
    expect([shot.width, shot.height]).toEqual([1280, 800]);
    expect(colorsIn(shot)).toBeGreaterThan(1);
  });

  test('o cookie da sessão da pessoa não chega ao agente', async ({ launchApp, gitRepo }) => {
    const { app, page } = await launchApp({
      dialogPath: gitRepo.path,
      panelClaudeScript: FAKE_CLAUDE,
    });
    const name = basename(gitRepo.path);
    await addGitProject(page, name);
    await openAgentTerminal(page, name);
    await openNavigator(page);
    await go(page, app, `${site.url}/cookie`);
    await go(page, app, `${site.url}/le-cookie`);
    const read = 'document.getElementById("texto")?.textContent ?? ""';
    expect(await evalInBrowserPage<string>(app, read)).toBe('visita=1');

    const tab = await agent.open(`${site.url}/le-cookie`);
    const text = await agent.text('browser_read_text', { tabId: tab.id });
    expect(text).not.toContain('visita');
    // E o do agente não chega à pessoa.
    await agent.text('browser_navigate', { tabId: tab.id, url: `${site.url}/cookie` });
    await agent.text('browser_navigate', { tabId: tab.id, url: `${site.url}/le-cookie` });
    expect(await agent.text('browser_read_text', { tabId: tab.id })).toContain('visita=1');
    await address(page).fill(`${site.url}/le-cookie`);
    await address(page).press('Enter');
    await expect.poll(() => evalInBrowserPage<string>(app, read)).toBe('visita=1');
  });

  test('a quinta aba do agente é recusada com a mensagem do limite', async ({
    launchApp,
    gitRepo,
  }) => {
    const { page } = await launchApp({ dialogPath: gitRepo.path, panelClaudeScript: FAKE_CLAUDE });
    const name = basename(gitRepo.path);
    await addGitProject(page, name);
    await openAgentTerminal(page, name);
    const opened: AgentTab[] = [];
    for (let index = 0; index < 4; index += 1) opened.push(await agent.open(`${site.url}/`));

    const fifth = await agent.call('browser_open', { url: `${site.url}/` });
    expect(fifth).toMatchObject({ isError: true, text: LIMIT });
    expect(await agent.tabs()).toHaveLength(4);

    expect(await agent.text('browser_close', { tabId: opened[0]?.id })).toBe('Aba fechada.');
    await agent.open(`${site.url}/outra`);
    expect(await agent.tabs()).toHaveLength(4);
  });

  test('fechar o terminal tira a aba do agente, e o token antigo passa a receber 401', async ({
    launchApp,
    gitRepo,
  }) => {
    const { page } = await launchApp({ dialogPath: gitRepo.path, panelClaudeScript: FAKE_CLAUDE });
    const name = basename(gitRepo.path);
    await addGitProject(page, name);
    const pane = await openAgentTerminal(page, name);
    await agent.open(`${site.url}/agente`);
    await openNavigator(page);
    await expect(pageTab(page, /^Agente: /)).toHaveCount(1);
    const access = await agent.access();
    expect((await post(access)).status).toBe(200);

    const label = (await pane.getAttribute('aria-label')) ?? '';
    await fecharPainel(page, label.replace(/^Painel /, ''));
    await expect(pane).toHaveCount(0);

    await expect(pageTab(page, /^Agente: /)).toHaveCount(0);
    await expect(navigatorTab(page)).toHaveAccessibleName('Navegador');
    await expect.poll(async () => (await post(access)).status).toBe(401);
    expect((await post(access)).body).toBe('');
  });

  test('a página da pessoa não alcança o servidor de ferramentas', async ({
    launchApp,
    gitRepo,
  }) => {
    const { app, page } = await launchApp({
      dialogPath: gitRepo.path,
      panelClaudeScript: FAKE_CLAUDE,
    });
    const name = basename(gitRepo.path);
    await addGitProject(page, name);
    await openAgentTerminal(page, name);
    const tab = await agent.open(`${site.url}/agente`);
    const access = await agent.access();
    await openNavigator(page);
    await go(page, app, `${site.url}/`);

    // Uma página, mesmo com o token certo na mão, manda `Origin` e recebe a recusa; sem o token, também.
    const attempt = (headers: string): string =>
      `fetch(${JSON.stringify(access.url)}, { method: 'POST', headers: ${headers}, body: '{}' })` +
      `.then((r) => 'status ' + r.status, () => 'falhou')`;
    const withToken = JSON.stringify({
      authorization: `Bearer ${access.token}`,
      'content-type': 'application/json',
    });
    for (const headers of ['{}', withToken]) {
      const outcome = await evalInBrowserPage<string>(app, attempt(headers));
      expect(['falhou', 'status 401', 'status 403']).toContain(outcome);
    }
    // De fora do app, o mesmo pedido com `Origin` recebe 403 sem corpo, com o token certo.
    expect(await post(access, { origin: site.url })).toEqual({ status: 403, body: '' });
    expect(await post({ ...access, token: 'errado' })).toEqual({ status: 401, body: '' });

    // E nada mudou nas abas do agente.
    expect(await agent.tabs()).toEqual([
      { id: tab.id, url: `${site.url}/agente`, title: 'Página do agente', loading: false },
    ]);
  });

  test('alert() e mailto: não abrem diálogo, e o descarte aparece no console do agente', async ({
    launchApp,
    gitRepo,
  }) => {
    const { app, page } = await launchApp({
      dialogPath: gitRepo.path,
      panelClaudeScript: FAKE_CLAUDE,
    });
    const name = basename(gitRepo.path);
    await addGitProject(page, name);
    await openAgentTerminal(page, name);
    const tab = await agent.open(`${site.url}/dialogos`);
    const windows = (): Promise<number> =>
      app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length);
    const before = await windows();

    const alertButton = await agent.ref(tab.id, 'button "Alertar"');
    await agent.text('browser_click', { tabId: tab.id, ref: alertButton });
    // O script da página seguiu depois do `alert()`: ninguém ficou esperando um diálogo.
    await expect.poll(async () => (await agent.tabs())[0]?.title).toBe('Depois do alerta');

    const link = await agent.ref(tab.id, 'link "Escrever"');
    await agent.text('browser_click', { tabId: tab.id, ref: link });
    await expect
      .poll(() => agent.text('browser_console', { tabId: tab.id }))
      .toContain('descartado sem abrir: mailto:');
    const log = await agent.text('browser_console', { tabId: tab.id });
    expect(log).toContain('diálogo descartado: alert');
    expect(log).not.toContain('alguem@example.com');
    expect((await agent.tabs())[0]?.url).toBe(`${site.url}/dialogos`);
    expect(await windows()).toBe(before);
  });

  test('fechar a janela principal com aba de agente aberta encerra o app', async ({
    launchApp,
    gitRepo,
  }) => {
    const { app, page } = await launchApp({
      dialogPath: gitRepo.path,
      panelClaudeScript: FAKE_CLAUDE,
    });
    const name = basename(gitRepo.path);
    await addGitProject(page, name);
    await openAgentTerminal(page, name);
    await agent.open(`${site.url}/agente`);
    const access = await agent.access();
    expect(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length)).toBe(2);

    // O app aberto pelo Playwright só termina o processo depois que o teste o solta; o que se confere aqui é que
    // ele decidiu sair (`quit`), o que não acontece se a janela de apoio ficar para trás.
    let log = '';
    app.process().stderr?.on('data', (chunk: Buffer) => {
      log += chunk.toString();
    });
    await app
      .evaluate(({ app: electron, BrowserWindow }) => {
        electron.once('quit', () => console.error('E2E: o app saiu'));
        BrowserWindow.getAllWindows()
          .find((each) => each.isFocusable())
          ?.close();
      })
      .catch(() => undefined);
    await expect.poll(() => log, { timeout: 30_000 }).toContain('E2E: o app saiu');
    // O servidor de ferramentas foi junto.
    await expect(post(access)).rejects.toThrow();
  });
});

test.describe('janela de apoio das páginas de agente', () => {
  test('desenha a página fora da tela, sem tomar o foco, com a janela principal à vista e minimizada', async ({
    launchApp,
  }) => {
    const { app } = await launchApp();
    const result = await app.evaluate(
      async ({ BrowserWindow, WebContentsView, nativeImage }, options) => {
        const main = BrowserWindow.getAllWindows()[0];
        if (main === undefined) throw new Error('sem janela principal');
        main.focus();
        const support = new BrowserWindow({ ...options });
        support.showInactive();
        // Sessão própria, como a das páginas de agente: as regras da janela do app não valem para ela.
        const view = new WebContentsView({
          webPreferences: { partition: 'navegador-agente-teste', sandbox: true },
        });
        support.contentView.addChildView(view);
        view.setBounds({ x: 0, y: 0, width: options.width, height: options.height });
        const contents = view.webContents;
        await contents.loadURL(
          'data:text/html,' + encodeURIComponent('<body style="margin:0;background:#c00"></body>'),
        );
        contents.debugger.attach('1.3');
        const shot = async (): Promise<string> => {
          const reply = (await contents.debugger.sendCommand('Page.captureScreenshot', {
            format: 'png',
          })) as { data: string };
          const image = nativeImage.createFromBuffer(Buffer.from(reply.data, 'base64'));
          const size = image.getSize();
          return `${size.width}x${size.height} ${[...image.toBitmap().subarray(0, 4)].join(',')}`;
        };
        const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
        await wait(300);
        const shown = await shot();
        const focusedIsSupport = BrowserWindow.getFocusedWindow() === support;
        const bounds = support.getBounds();
        main.minimize();
        await wait(500);
        const minimized = await shot();
        main.restore();
        support.destroy();
        return { shown, minimized, focusedIsSupport, x: bounds.x, y: bounds.y };
      },
      SUPPORT_WINDOW_OPTIONS,
    );

    // Vermelho, em BGRA.
    expect(result.shown).toBe('1280x800 0,0,204,255');
    expect(result.minimized).toBe('1280x800 0,0,204,255');
    expect(result.focusedIsSupport).toBe(false);
    expect(result.x).toBe(-30000);
    expect(result.y).toBe(-30000);
  });
});
