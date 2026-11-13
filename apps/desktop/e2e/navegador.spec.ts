import { basename } from 'node:path';
import type { ElectronApplication, Locator, Page } from '@playwright/test';
import { createTempRepo } from '@project-hub/test-utils';
import { expect, test } from './fixtures';
import { expectNoViolations, watchCsp } from './git-fixtures';
import { evalInBrowserPage, pressInBrowserPage, startLocalSite, viewState } from './local-site';
import { addGitProject, openProject, projectLink } from './missions';

// O navegador interno na janela real do Electron construído: a aba Navegador do painel direito, as páginas em
// views do processo principal, a sessão separada por projeto e o que fica guardado entre aberturas. Tudo com dados
// descartáveis e um site local (local-site.ts): nenhum teste usa a internet nem a pasta de dados da pessoa.

const BLOCKED = 'Este tipo de endereço não abre aqui.';
const REFUSED =
  'O servidor recusou a conexão. Se for o seu servidor local, veja se ele está rodando.';

const rightPanel = (page: Page): Locator =>
  page.getByRole('complementary', { name: 'Painel direito' });
const panelTab = (page: Page, name: string): Locator =>
  rightPanel(page).getByRole('tablist', { name: 'Painéis laterais' }).getByRole('tab', { name });
const address = (page: Page): Locator =>
  rightPanel(page).getByRole('textbox', { name: 'Endereço' });
const pageTabs = (page: Page): Locator =>
  rightPanel(page).getByRole('tablist', { name: 'Abas do navegador' }).getByRole('tab');
const barButton = (page: Page, name: string): Locator =>
  rightPanel(page).getByRole('button', { name, exact: true });
const viewport = (page: Page): Locator => rightPanel(page).locator('.browser__viewport');

/** Abre a aba Navegador do painel direito do projeto aberto. */
async function openNavigator(page: Page): Promise<void> {
  await panelTab(page, 'Navegador').click();
  await expect(address(page)).toBeVisible();
}

/** Digita o endereço e espera a página dele estar na janela. */
async function go(page: Page, app: ElectronApplication, url: string): Promise<void> {
  await address(page).fill(url);
  await address(page).press('Enter');
  await expect.poll(async () => (await viewState(app)).url).toBe(url);
}

/** O texto do elemento `#texto` da página à vista. */
const pageText = (app: ElectronApplication): Promise<string> =>
  evalInBrowserPage<string>(app, 'document.getElementById("texto")?.textContent ?? ""');

test('navegador: navegar, voltar, avançar, recarregar, abas, endereço barrado e servidor parado', async ({
  launchApp,
  gitRepo,
}) => {
  const site = await startLocalSite();
  let stopped = false;
  try {
    const { app, page } = await launchApp({ dialogPath: gitRepo.path });
    const consoleCsp = await watchCsp(page);
    const name = basename(gitRepo.path);
    await addGitProject(page, name);
    await openProject(page, name);
    await openNavigator(page);

    // Aba nova: sem endereço, sem página.
    await expect(pageTabs(page)).toHaveText(['Nova aba']);
    await expect(viewport(page)).toContainText('Digite uma URL para começar');
    expect((await viewState(app)).attached).toBe(0);

    await go(page, app, `${site.url}/`);
    await expect(pageTabs(page)).toHaveText(['Site de teste']);
    await expect(address(page)).toHaveValue(`${site.url}/`);

    await go(page, app, `${site.url}/outra`);
    await expect(pageTabs(page)).toHaveText(['Outra página']);
    await barButton(page, 'Voltar').click();
    await expect(address(page)).toHaveValue(`${site.url}/`);
    await barButton(page, 'Avançar').click();
    await expect(address(page)).toHaveValue(`${site.url}/outra`);
    await barButton(page, 'Recarregar').click();
    await expect(address(page)).toHaveValue(`${site.url}/outra`);
    await expect(pageTabs(page)).toHaveText(['Outra página']);

    // Endereços que não abrem: o aviso aparece e a página continua onde estava.
    for (const blocked of ['file:///C:/Windows/win.ini', 'javascript:alert(1)']) {
      await address(page).fill(blocked);
      await address(page).press('Enter');
      await expect(rightPanel(page).getByRole('status')).toHaveText(BLOCKED);
      expect((await viewState(app)).url).toBe(`${site.url}/outra`);
      await address(page).press('Escape');
      await expect(address(page)).toHaveValue(`${site.url}/outra`);
    }

    // Abas: abrir, fechar, e fechar a última deixa uma aba vazia.
    await barButton(page, 'Nova aba').click();
    await expect(pageTabs(page)).toHaveText(['Outra página', 'Nova aba']);
    await expect(rightPanel(page).locator('.browser__notice')).toBeEmpty();
    await barButton(page, 'Fechar aba Nova aba').click();
    await expect(pageTabs(page)).toHaveText(['Outra página']);
    await barButton(page, 'Fechar aba Outra página').click();
    await expect(pageTabs(page)).toHaveText(['Nova aba']);
    await expect.poll(async () => (await viewState(app)).attached).toBe(0);

    // Servidor parado: a área diz por que não abriu e oferece tentar de novo.
    await go(page, app, `${site.url}/`);
    await site.close();
    stopped = true;
    await barButton(page, 'Recarregar').click();
    await expect(viewport(page).getByRole('alert')).toContainText(REFUSED);
    await expect(viewport(page).getByRole('button', { name: 'Tentar de novo' })).toBeVisible();
    await expect.poll(async () => (await viewState(app)).attached).toBe(0);

    await expectNoViolations(page, consoleCsp);
  } finally {
    if (!stopped) await site.close();
  }
});

test('navegador: janela nova vira aba, e a página não alcança o app', async ({
  launchApp,
  gitRepo,
}) => {
  const site = await startLocalSite();
  try {
    const { app, page } = await launchApp({ dialogPath: gitRepo.path });
    const name = basename(gitRepo.path);
    await addGitProject(page, name);
    await openProject(page, name);
    await openNavigator(page);
    await go(page, app, `${site.url}/`);

    // A ponte do preload é da janela do app: a página não a tem.
    expect(await evalInBrowserPage<string>(app, 'typeof window.projectHub')).toBe('undefined');
    expect(await evalInBrowserPage<string>(app, 'typeof require')).toBe('undefined');

    const before = (await viewState(app)).windows;
    await evalInBrowserPage(app, 'document.getElementById("nova").click()');
    await expect(pageTabs(page)).toHaveCount(2);
    await expect.poll(async () => (await viewState(app)).url).toBe(`${site.url}/outra`);
    expect((await viewState(app)).windows).toBe(before);
    expect((await viewState(app)).attached).toBe(1);
  } finally {
    await site.close();
  }
});

test('navegador: cada projeto tem a sua sessão, e abas e cookies voltam ao reabrir o app', async ({
  launchApp,
  gitRepo,
  gitEnv,
}) => {
  const site = await startLocalSite();
  // O segundo projeto: outro repositório descartável, cadastrado pela ponte do app (o seletor de teste só devolve um).
  const previous = Object.keys(gitEnv).map((key) => [key, process.env[key]] as const);
  Object.assign(process.env, gitEnv);
  const second = createTempRepo();
  for (const [key, value] of previous) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  let closeApp: (() => Promise<void>) | undefined;
  try {
    const first = await launchApp({ dialogPath: gitRepo.path });
    closeApp = first.close;
    const { app, page } = first;
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

    await openProject(page, nameA);
    await openNavigator(page);
    await go(page, app, `${site.url}/cookie`);
    expect(await pageText(app)).toBe('gravado');

    // O outro projeto não vê o cookie.
    await openProject(page, nameB);
    await openNavigator(page);
    await expect(pageTabs(page)).toHaveText(['Nova aba']);
    await go(page, app, `${site.url}/le-cookie`);
    expect(await pageText(app)).toBe('');

    // De volta ao primeiro, o cookie é dele.
    await openProject(page, nameA);
    await expect(pageTabs(page)).toHaveText(['Cookie gravado']);
    await go(page, app, `${site.url}/le-cookie`);
    expect(await pageText(app)).toBe('visita=1');

    await first.close();
    closeApp = undefined;

    // Reabrindo com a mesma pasta de dados: a aba volta com o endereço dela, e o cookie continua lá.
    const again = await launchApp({ dialogPath: gitRepo.path });
    closeApp = again.close;
    await openProject(again.page, nameA);
    await openNavigator(again.page);
    await expect(address(again.page)).toHaveValue(`${site.url}/le-cookie`);
    await expect.poll(async () => (await viewState(again.app)).url).toBe(`${site.url}/le-cookie`);
    await expect.poll(() => pageText(again.app)).toBe('visita=1');
    await again.close();
    closeApp = undefined;
  } finally {
    await closeApp?.().catch(() => undefined);
    second.cleanup();
    await site.close();
  }
});

test('navegador: a página segue a área, some sob o menu, e o painel expande', async ({
  launchApp,
  gitRepo,
}) => {
  const site = await startLocalSite();
  try {
    const { app, page } = await launchApp({ dialogPath: gitRepo.path });
    const name = basename(gitRepo.path);
    await addGitProject(page, name);
    await openProject(page, name);
    await openNavigator(page);
    await go(page, app, `${site.url}/`);

    /** A view está exatamente sobre a área reservada (1px de tolerância). */
    const expectOverArea = async () => {
      await expect
        .poll(async () => {
          const { bounds } = await viewState(app);
          const box = await viewport(page).boundingBox();
          if (bounds === null || box === null) return 'sem medida';
          const off = Math.max(
            Math.abs(bounds.x - box.x),
            Math.abs(bounds.y - box.y),
            Math.abs(bounds.width - box.width),
            Math.abs(bounds.height - box.height),
          );
          return off <= 1 ? 'ok' : `diferença de ${off}px`;
        })
        .toBe('ok');
    };
    await expectOverArea();

    // Outra aba do painel: a página sai da janela. De volta: está lá.
    await panelTab(page, 'Arquivos').click();
    await expect.poll(async () => (await viewState(app)).attached).toBe(0);
    await panelTab(page, 'Navegador').click();
    await expect.poll(async () => (await viewState(app)).attached).toBe(1);
    await expectOverArea();

    // Menu aberto por cima da área: a página dá lugar à imagem parada.
    await barButton(page, 'Mais ações').click();
    await expect(rightPanel(page).getByRole('menu', { name: 'Mais ações' })).toBeVisible();
    await expect.poll(async () => (await viewState(app)).attached).toBe(0);
    await expect(viewport(page).locator('img')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect.poll(async () => (await viewState(app)).attached).toBe(1);
    await expect(viewport(page).locator('img')).toHaveCount(0);

    // A janela muda de tamanho: a página acompanha a área.
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.setSize(1200, 700));
    await expectOverArea();

    // Arrastar as divisórias: a página segue viva sobre a área, no meio do arraste e depois de soltar.
    for (const [label, dx] of [
      ['Redimensionar painel direito', -90],
      ['Redimensionar barra lateral', 60],
    ] as const) {
      const box = await page.getByRole('separator', { name: label }).boundingBox();
      if (box === null) throw new Error(`divisória sem medida: ${label}`);
      const x = box.x + box.width / 2;
      const y = box.y + box.height / 2;
      const before = await viewport(page).boundingBox();
      await page.mouse.move(x, y);
      await page.mouse.down();
      await page.mouse.move(x + dx / 2, y, { steps: 4 });
      await page.mouse.move(x + dx, y, { steps: 4 });
      expect((await viewState(app)).attached).toBe(1);
      await expect(viewport(page).locator('img')).toHaveCount(0);
      await expectOverArea();
      await page.mouse.up();
      await expect(viewport(page).locator('img')).toHaveCount(0);
      await expectOverArea();
      if (label === 'Redimensionar painel direito') {
        const after = await viewport(page).boundingBox();
        expect(Math.abs((after?.x ?? 0) - (before?.x ?? 0))).toBeGreaterThan(40);
      }
    }

    // Expandir: o centro sai de vista sem ser desmontado, e a página ocupa o painel largo.
    const main = page.locator('.app-main');
    const widthBefore = (await viewport(page).boundingBox())?.width ?? 0;
    await barButton(page, 'Expandir').click();
    await expect(main).toBeHidden();
    await expect(main).toBeAttached();
    await expect(barButton(page, 'Restaurar tamanho')).toBeVisible();
    await expect
      .poll(async () => (await viewport(page).boundingBox())?.width ?? 0)
      .toBeGreaterThan(widthBefore + 200);
    await expectOverArea();
    await barButton(page, 'Restaurar tamanho').click();
    await expect(main).toBeVisible();
    await expectOverArea();
  } finally {
    await site.close();
  }
});

test('navegador: com o foco na página, F6, Ctrl+L e Ctrl+Alt+B voltam para o app', async ({
  launchApp,
  gitRepo,
}) => {
  const site = await startLocalSite();
  try {
    const { app, page } = await launchApp({ dialogPath: gitRepo.path });
    const name = basename(gitRepo.path);
    await addGitProject(page, name);
    await openProject(page, name);
    await openNavigator(page);
    await go(page, app, `${site.url}/`);
    const projectId = /workspaces\/([^/?#]+)/.exec(page.url())?.[1] ?? '';
    expect(projectId).not.toBe('');
    const focusPage = () =>
      page.evaluate((id) => window.projectHub.browser.focusPage(id), projectId);

    expect((await focusPage()).ok).toBe(true);
    await pressInBrowserPage(app, 'F6');
    await expect(barButton(page, 'Voltar')).toBeFocused();

    await focusPage();
    await pressInBrowserPage(app, 'L', ['control']);
    await expect(address(page)).toBeFocused();

    // Uma tecla comum fica na página: o foco do app não muda.
    await focusPage();
    await pressInBrowserPage(app, 'A');
    await expect(address(page)).toBeFocused();

    await pressInBrowserPage(app, 'B', ['control', 'alt']);
    await expect(page.getByRole('button', { name: 'Mostrar painel direito' })).toBeVisible();
    await expect.poll(async () => (await viewState(app)).attached).toBe(0);
  } finally {
    await site.close();
  }
});
