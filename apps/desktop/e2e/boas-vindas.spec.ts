import { basename } from 'node:path';
import type { Locator, Page } from '@playwright/test';
import { expect, FAKE_ACCOUNT_CLI, test } from './fixtures';
import { addGitProject } from './missions';

// As boas-vindas na janela real: o Início sem projeto confere o Git (o de verdade, da máquina do teste), o Claude
// Code e a conta dele (o CLI falso `fake-account-cli.mjs`, sem login), e some quando o primeiro projeto entra.

function check(page: Page, name: string): Locator {
  return page
    .locator('li.welcome__check')
    .filter({ has: page.locator('.welcome__check-name', { hasText: new RegExp(`^${name}$`) }) });
}

test('o Início sem projeto dá as boas-vindas e confere o ambiente', async ({
  launchApp,
  dataDir,
}) => {
  const launched = await launchApp({ accountCliScript: FAKE_ACCOUNT_CLI });
  const { page } = launched;

  await expect(
    page.getByRole('heading', { level: 2, name: 'Boas-vindas ao Project Hub' }),
  ).toBeVisible();

  const git = check(page, 'Git');
  await expect(git).toContainText('Instalado');
  await expect(git).toContainText(/git version \d+\.\d+/);

  const claude = check(page, 'Claude Code');
  await expect(claude).toContainText('Instalado');
  await claude.getByRole('button', { name: 'Testar Claude Code' }).click();
  await expect(claude.getByRole('status')).toHaveText('Respondeu: 9.9.9 (Claude Code)');

  // O CLI falso não tem login guardado: a conta aparece sem login, e o resumo diz que falta algo.
  const account = check(page, 'Conta do Claude Code');
  await expect(account).toContainText('Sem login');
  await expect(
    page.getByText('Você pode adicionar o projeto agora e resolver o que falta depois.'),
  ).toBeVisible();

  const data = page.getByRole('region', { name: 'Onde ficam os seus dados' });
  await expect(data).toContainText(basename(dataDir));
  await expect(data).toContainText('worktrees');

  await account.getByRole('link', { name: 'Abrir Contas' }).click();
  await expect(page.getByRole('heading', { level: 2, name: 'Contas' })).toBeVisible();
  await launched.close();
});

test('com o primeiro projeto, as boas-vindas dão lugar ao Início de sempre', async ({
  launchApp,
  gitRepo,
}) => {
  const projectName = basename(gitRepo.path);
  const launched = await launchApp({
    dialogPath: gitRepo.path,
    accountCliScript: FAKE_ACCOUNT_CLI,
  });
  const { page } = launched;
  await expect(
    page.getByRole('heading', { level: 2, name: 'Boas-vindas ao Project Hub' }),
  ).toBeVisible();

  await addGitProject(page, projectName);
  await page.getByRole('link', { name: 'Início' }).first().click();

  await expect(
    page.getByRole('heading', { level: 2, name: 'Boas-vindas ao Project Hub' }),
  ).toHaveCount(0);
  await expect(page.getByRole('region', { name: 'Precisa de você' })).toBeVisible();
  await launched.close();
});
