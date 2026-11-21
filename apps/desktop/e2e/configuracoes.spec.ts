import type { Locator, Page } from '@playwright/test';
import { existsSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { expect, FAKE_ACCOUNT_CLI, test } from './fixtures';

// Configurações na janela real: a engrenagem, a aba, a seção Geral e as contas de um programa, do cadastro ao
// login guiado e à remoção. O `claude` e o `codex` dos comandos de conta são o CLI falso (`fake-account-cli.mjs`):
// nenhum programa de verdade roda, nenhum navegador abre e as pastas dos programas na máquina não são tocadas.
// A Principal do CLI falso mora em `<pasta de dados>/fake-principal-<programa>`.

async function openSettings(page: Page): Promise<void> {
  await page.locator('.sidebar__settings').click();
  await expect(page.getByRole('heading', { level: 1, name: 'Configurações' })).toBeVisible();
}

function accountRow(page: Page, name: string): Locator {
  return page
    .getByRole('region', { name: 'Claude Code' })
    .locator('li.acct')
    .filter({ has: page.locator('.acct__name-text', { hasText: name }) });
}

/** Responde ao programa no terminal do login: digita a linha e Enter. */
async function answerProgram(page: Page, row: Locator, line: string): Promise<void> {
  const toggle = row.getByRole('button', { name: 'Ver o terminal do programa' });
  if ((await toggle.getAttribute('aria-expanded')) !== 'true') await toggle.click();
  await row.locator('.login-terminal .xterm-helper-textarea').focus();
  await page.keyboard.type(line);
  await page.keyboard.press('Enter');
}

/** As pastas das contas extras do Claude Code no disco. */
function extraFolders(dataDir: string): string[] {
  const root = join(dataDir, 'accounts', 'claude');
  return existsSync(root) ? readdirSync(root) : [];
}

test('a engrenagem abre Configurações numa aba, e a aba fecha', async ({ launchApp }) => {
  const launched = await launchApp({ accountCliScript: FAKE_ACCOUNT_CLI });
  const { page } = launched;

  await openSettings(page);
  await expect(page.locator('.sidebar__settings')).toHaveAttribute('aria-current', 'page');
  await expect(page.getByRole('heading', { level: 2, name: 'Contas' })).toBeVisible();

  await page.getByRole('button', { name: 'Fechar Configurações' }).click();

  await expect(page.getByRole('heading', { level: 1, name: 'Configurações' })).toBeHidden();
  await expect(page.locator('.sidebar__settings')).not.toHaveAttribute('aria-current', 'page');
  await launched.close();
});

test('Geral mostra a versão e a pasta de dados', async ({ launchApp, dataDir }) => {
  const launched = await launchApp({ accountCliScript: FAKE_ACCOUNT_CLI });
  const { page } = launched;

  await openSettings(page);
  await page
    .getByRole('navigation', { name: 'Seções das configurações' })
    .getByRole('link', { name: 'Geral' })
    .click();

  await expect(page.getByRole('heading', { level: 2, name: 'Geral' })).toBeVisible();
  const rows = page.locator('.settings-row');
  await expect(rows.filter({ hasText: 'Versão' })).toContainText(/\d+\.\d+\.\d+/);
  await expect(rows.filter({ hasText: 'Pasta de dados' })).toContainText(basename(dataDir));
  await launched.close();
});

test('conta do Claude Code: adicionar, conectar pelo guia, trocar de conta, concluir e remover', async ({
  launchApp,
  dataDir,
}) => {
  // A Principal já conectada, para conferir no fim que remover uma extra não mexe nela.
  const principal = join(dataDir, 'fake-principal-claude');
  mkdirSync(principal, { recursive: true });
  writeFileSync(
    join(principal, 'login.json'),
    JSON.stringify({ email: 'principal@exemplo.test', orgName: 'Organização de teste' }),
  );

  const launched = await launchApp({ accountCliScript: FAKE_ACCOUNT_CLI });
  const { page } = launched;
  await openSettings(page);
  const claude = page.getByRole('region', { name: 'Claude Code' });
  await expect(accountRow(page, 'Principal')).toContainText('principal@exemplo.test');
  await expect(accountRow(page, 'Principal').locator('.acct__state')).toHaveText('Conectada');

  // Adicionar: a conta nasce sem login, com a pasta dela na pasta de dados.
  await claude.getByRole('button', { name: 'Adicionar conta' }).click();
  await claude.getByRole('textbox', { name: 'Nome da conta' }).fill('Trabalho');
  await page.keyboard.press('Enter');
  const row = accountRow(page, 'Trabalho');
  await expect(row.locator('.acct__state')).toHaveText('Sem login');
  expect(extraFolders(dataDir)).toHaveLength(1);

  // Conectar: o guia chega ao passo do navegador com o servidor; o guia não mostra o endereço.
  await row.getByRole('button', { name: 'Conectar' }).click();
  const current = row.locator('li[aria-current="step"]');
  await expect(current).toContainText('Entre pelo navegador');
  await expect(row.locator('.login__host')).toHaveText('claude.ai');
  expect(await row.locator('.login').innerText()).not.toContain('https://');

  // O programa pede uma linha: a conta errada primeiro.
  await answerProgram(page, row, 'outra@exemplo.test');
  await expect(row.locator('.login__identity')).toHaveText('outra@exemplo.test');

  // "Não é esta conta" sai dela e volta ao passo do navegador.
  await row.getByRole('button', { name: 'Não é esta conta' }).click();
  await expect(current).toContainText('Entre pelo navegador');
  await expect(row.locator('.login__host')).toHaveText('claude.ai');

  await answerProgram(page, row, 'trabalho@exemplo.test');
  await expect(row.locator('.login__identity')).toHaveText('trabalho@exemplo.test');
  await row.getByRole('button', { name: 'Concluir' }).click();

  await expect(row.locator('.acct__state')).toHaveText('Conectada');
  await expect(row).toContainText('trabalho@exemplo.test');
  await expect(row.locator('.login')).toHaveCount(0);

  // Remover: a pasta da conta some do disco, e a da Principal continua com o login dela.
  await row.getByRole('button', { name: 'Mais ações da conta Trabalho' }).click();
  await page.getByRole('menuitem', { name: 'Remover conta' }).click();
  await row.getByRole('button', { name: 'Remover conta' }).click();

  await expect(row).toHaveCount(0);
  expect(extraFolders(dataDir)).toEqual([]);
  expect(existsSync(join(principal, 'login.json'))).toBe(true);
  await expect(accountRow(page, 'Principal').locator('.acct__state')).toHaveText('Conectada');
  await launched.close();
});
