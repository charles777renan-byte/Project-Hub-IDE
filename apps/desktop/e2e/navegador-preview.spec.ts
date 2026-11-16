import { writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import type { ElectronApplication, Locator, Page } from '@playwright/test';
import {
  createDevProject,
  createStaticProject,
  DEV_HEADING,
  DEV_SCRIPT,
  STATIC_HEADING,
  writeDevScript,
  writeStaticIndex,
} from './dev-project';
import { expect, test } from './fixtures';
import { expectNoViolations, watchCsp } from './git-fixtures';
import { evalInBrowserPage, viewState } from './local-site';
import { addGitProject, openProject } from './missions';
import { expectOpenSessions, fecharPainel } from './terminals';

// O preview na janela real do Electron construído: a aba Navegador reconhece o projeto e nada sobe sem a pessoa
// pedir. Site estático: com um clique, o app serve a pasta e recarrega ao salvar. Projeto com servidor: a pessoa
// aprova o comando uma vez, o servidor sobe num painel de terminal e a página abre quando ele anuncia o endereço. Tudo com projetos
// descartáveis (dev-project.ts): nada é instalado e nenhum teste usa a internet nem a pasta de dados da pessoa.

const CHANGED = 'O comando do preview mudou';

const rightPanel = (page: Page): Locator =>
  page.getByRole('complementary', { name: 'Painel direito' });
const address = (page: Page): Locator =>
  rightPanel(page).getByRole('textbox', { name: 'Endereço' });
const pageTabs = (page: Page): Locator =>
  rightPanel(page).getByRole('tablist', { name: 'Abas do navegador' }).getByRole('tab');
const viewport = (page: Page): Locator => rightPanel(page).locator('.browser__viewport');
/** O cartão do preview, pelo título dele. */
const card = (page: Page, title = 'Preview deste projeto'): Locator =>
  rightPanel(page).getByRole('region', { name: title, exact: true });
const anyCard = (page: Page): Locator => rightPanel(page).locator('.browser__preview');
/** Os painéis de terminal que o preview abriu, pelo título do cabeçalho. */
const previewPanes = (page: Page): Locator =>
  page.locator('.pane__title').filter({ hasText: 'Preview ·' });

async function openNavigator(page: Page): Promise<void> {
  await rightPanel(page)
    .getByRole('tablist', { name: 'Painéis laterais' })
    .getByRole('tab', { name: 'Navegador' })
    .click();
  await expect(address(page)).toBeVisible();
}

/** O endereço da página à vista, ou '' sem página. */
const shownUrl = async (app: ElectronApplication): Promise<string> =>
  (await viewState(app)).url ?? '';

/** O texto do `#texto` da página à vista. Sem página, ou no meio de uma recarga, ''. */
const heading = (app: ElectronApplication): Promise<string> =>
  evalInBrowserPage<string>(app, 'document.getElementById("texto")?.textContent ?? ""').catch(
    () => '',
  );

/** Se o foco do app está dentro de um painel de terminal. */
const focusInPane = (page: Page): Promise<boolean> =>
  page.evaluate(() => (document.activeElement?.closest('.pane') ?? null) !== null);

test('preview: site estático abre quando a pessoa pede, recarrega ao salvar e não entrega arquivo oculto', async ({
  launchApp,
  gitRepo,
}) => {
  const secret = 'SEGREDO=valor-do-teste';
  createStaticProject(gitRepo.path);
  writeFileSync(join(gitRepo.path, '.env'), `${secret}\n`);

  const { app, page } = await launchApp({ dialogPath: gitRepo.path });
  const consoleCsp = await watchCsp(page);
  const name = basename(gitRepo.path);
  await addGitProject(page, name);
  await openProject(page, name);
  await openNavigator(page);

  // Abrir a aba não sobe nada: o cartão oferece o site, e nenhuma página abre antes do clique.
  const offer = card(page);
  await expect(offer).toBeVisible();
  await expect(offer.getByRole('button', { name: 'Abrir o site' })).toBeVisible();
  expect((await viewState(app)).attached).toBe(0);
  await expect(address(page)).toHaveValue('');

  // "Abrir o site": o app serve a pasta em 127.0.0.1 e a página abre.
  await offer.getByRole('button', { name: 'Abrir o site' }).click();
  await expect
    .poll(() => shownUrl(app), { timeout: 30_000 })
    .toMatch(/^http:\/\/127\.0\.0\.1:\d+\/$/);
  await expect.poll(() => heading(app)).toBe(STATIC_HEADING);
  await expect(anyCard(page)).toHaveCount(0);
  await expect(previewPanes(page)).toHaveCount(0);
  const origin = new URL(await shownUrl(app)).origin;
  await expect(address(page)).toHaveValue(`${origin}/`);

  // Salvar o arquivo recarrega a página, sem ninguém pedir.
  writeStaticIndex(gitRepo.path, 'Texto novo');
  await expect.poll(() => heading(app), { timeout: 30_000 }).toBe('Texto novo');

  // Arquivo oculto e a pasta do Git: 404, para qualquer programa que peça.
  for (const path of ['/.env', '/.git/config', '/.git/HEAD']) {
    const response = await fetch(`${origin}${path}`);
    expect(response.status, path).toBe(404);
    expect(await response.text(), path).not.toContain(secret);
  }

  // Pela barra de endereço: estado de erro ou a página de 404, nunca o conteúdo.
  const target = `${origin}/.env`;
  await address(page).fill(target);
  await address(page).press('Enter');
  await expect
    .poll(async () => {
      const state = await viewState(app);
      return state.attached === 0 || state.url === target;
    })
    .toBe(true);
  if ((await viewState(app)).attached === 0) {
    await expect(viewport(page).getByRole('alert')).toBeVisible();
  } else {
    const text = await evalInBrowserPage<string>(app, 'document.documentElement.innerText');
    expect(text).not.toContain(secret);
  }
  await expect(rightPanel(page)).not.toContainText(secret);

  await expectNoViolations(page, consoleCsp);
});

test('preview: servidor de desenvolvimento pede uma vez, sobe num painel sem roubar o foco, e para quando o comando muda', async ({
  launchApp,
  gitRepo,
}) => {
  test.skip(process.platform !== 'win32', 'o shell do teste é o PowerShell');
  test.setTimeout(240_000);
  createDevProject(gitRepo.path);

  const { app, page } = await launchApp({ dialogPath: gitRepo.path });
  const consoleCsp = await watchCsp(page);
  const name = basename(gitRepo.path);
  await addGitProject(page, name);
  await openProject(page, name, 'Terminais');
  await openNavigator(page);

  try {
    // Primeira vez: o cartão mostra o comando e o que ele roda, e nada sobe antes da resposta.
    const ask = card(page);
    await expect(ask).toBeVisible();
    await expect(ask.getByText('npm run dev', { exact: true })).toBeVisible();
    await expect(ask.getByText(DEV_SCRIPT, { exact: true })).toBeVisible();
    await expect(previewPanes(page)).toHaveCount(0);
    await expectOpenSessions(page, 0);
    expect((await viewState(app)).attached).toBe(0);

    // "Usar este comando": um painel novo no workspace, com o foco fora do terminal, e a página abre.
    await address(page).focus();
    await ask.getByRole('button', { name: 'Usar este comando' }).click();
    await expect(previewPanes(page)).toHaveCount(1, { timeout: 30_000 });
    await expect(previewPanes(page)).toHaveText(`Preview · ${name}`);
    expect(await focusInPane(page)).toBe(false);

    await expect
      .poll(() => shownUrl(app), { timeout: 90_000 })
      .toMatch(/^http:\/\/localhost:\d+\/$/);
    await expect.poll(() => heading(app)).toBe(DEV_HEADING);
    await expect(anyCard(page)).toHaveCount(0);
    expect(await focusInPane(page)).toBe(false);
    const devUrl = await shownUrl(app);
    await expectOpenSessions(page, 1);

    // Segunda vez: sem pergunta e sem outro painel. O servidor já está de pé, e a aba nova abre o mesmo endereço.
    await rightPanel(page).getByRole('button', { name: 'Nova aba', exact: true }).click();
    await expect(pageTabs(page)).toHaveCount(2);
    await expect.poll(() => shownUrl(app), { timeout: 30_000 }).toBe(devUrl);
    await expect.poll(() => heading(app)).toBe(DEV_HEADING);
    await expect(anyCard(page)).toHaveCount(0);
    await expect(previewPanes(page)).toHaveCount(1);
    await expectOpenSessions(page, 1);

    // O comando mudou no repositório: a aba nova mostra o antes e o agora, e nada navega nem sobe.
    writeDevScript(gitRepo.path, 'node server.js --outro');
    await rightPanel(page).getByRole('button', { name: 'Nova aba', exact: true }).click();
    await expect(pageTabs(page)).toHaveCount(3);
    const changed = card(page, CHANGED);
    await expect(changed).toBeVisible({ timeout: 30_000 });
    await expect(changed.getByRole('group', { name: 'Antes' })).toContainText(DEV_SCRIPT);
    await expect(changed.getByRole('group', { name: 'Agora' })).toContainText(
      'node server.js --outro',
    );
    await expect(address(page)).toHaveValue('');
    expect((await viewState(app)).attached).toBe(0);
    await expect(previewPanes(page)).toHaveCount(1);
    await expectOpenSessions(page, 1);

    // O terminal do preview traz o <style> do xterm, o único descarte da conferência.
    await expectNoViolations(page, consoleCsp, { allowXterm: true });
  } finally {
    // O servidor para com o painel dele, mesmo se o teste falhou no meio: sem isso, o processo ficaria com a
    // pasta do projeto aberta na limpeza.
    if ((await previewPanes(page).count()) > 0) {
      await fecharPainel(page, 'PowerShell');
      await expect(previewPanes(page)).toHaveCount(0);
      await expectOpenSessions(page, 0);
    }
  }
});

test('preview: projeto sem servidor nem index.html mostra a área vazia de sempre', async ({
  launchApp,
  gitRepo,
}) => {
  const { app, page } = await launchApp({ dialogPath: gitRepo.path });
  const name = basename(gitRepo.path);
  await addGitProject(page, name);
  await openProject(page, name);
  await openNavigator(page);

  await expect(viewport(page)).toContainText('Digite uma URL para começar');
  await expect(viewport(page).getByRole('button', { name: 'Só abrir um endereço' })).toBeVisible();
  await expect(anyCard(page)).toHaveCount(0);
  await expect(pageTabs(page)).toHaveText(['Nova aba']);
  expect((await viewState(app)).attached).toBe(0);

  // "Só abrir um endereço" troca o aviso pelo campo do endereço fixo.
  await viewport(page).getByRole('button', { name: 'Só abrir um endereço' }).click();
  await expect(card(page).getByRole('textbox', { name: 'Endereço local' })).toBeFocused();
});
