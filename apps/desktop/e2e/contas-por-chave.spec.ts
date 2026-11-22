import type { Locator, Page } from '@playwright/test';
import { readFileSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { expect, FAKE_ACCOUNT_CLI, test } from './fixtures';
import { expectNoViolations, watchCsp } from './git-fixtures';
import { addGitProject, openProject } from './missions';
import { expectTerminalToContain } from './terminals';

// A conta por chave de API, na janela real: criar a conta, colar a chave pela área de transferência (um arquivo, no
// teste), abrir painéis nela, trocar a chave, trancar o cofre e remover a chave. O `claude` do painel é um programa
// falso que diz se recebeu a chave e mostra só os 4 últimos caracteres. Só chaves e senha falsas.

const FAKE_CLAUDE = join(import.meta.dirname, 'fixtures', 'fake-claude-chave.mjs');
const KEY_1 = 'sk-ant-api03-CHAVE-FALSA-do-e2e-um-0123456789abcdefghijklmnUMUM';
const KEY_2 = 'sk-ant-api03-CHAVE-FALSA-do-e2e-dois-0123456789abcdefghijkDOIS';
const ACCOUNT = 'API de teste';

async function openSettings(page: Page): Promise<void> {
  await page.locator('.sidebar__settings').click();
  await expect(page.getByRole('heading', { level: 1, name: 'Configurações' })).toBeVisible();
}

/** A linha da conta, na seção do Claude Code. */
function rowOf(page: Page): Locator {
  return page
    .getByRole('region', { name: 'Claude Code' })
    .locator('li.acct')
    .filter({ has: page.locator('.acct__name-text', { hasText: ACCOUNT }) });
}

/** Os painéis do Claude Code que mostram esta conta na etiqueta do cabeçalho. */
function panesOf(page: Page, account: string): Locator {
  return page
    .getByRole('region', { name: /^Painel Claude Code/ })
    .filter({ has: page.locator('.pane__account', { hasText: account }) });
}

/** Abre um painel do Claude Code pelo menu, na conta pedida. */
async function openClaudeIn(page: Page, account: string): Promise<void> {
  await page.getByRole('button', { name: 'Abrir terminal' }).click();
  await page.getByRole('menuitem', { name: /Claude Code/ }).click();
  await page
    .getByRole('listbox', { name: 'Conta do Claude Code' })
    .getByRole('option', { name: new RegExp(account) })
    .click();
}

/** Manda o programa falso sair e espera o painel dizer que a sessão terminou (`ended` painéis nesse estado). */
async function quitProgram(page: Page, view: Locator, ended: number): Promise<void> {
  await view.click();
  await page.keyboard.type('sair');
  await page.keyboard.press('Enter');
  await expect(page.getByText('A sessão terminou.')).toHaveCount(ended, { timeout: 20_000 });
}

/** A chave falsa nunca aparece no texto da página. */
async function expectNoKeyOnPage(page: Page): Promise<void> {
  const text = await page.evaluate(() => document.body.innerText);
  for (const key of [KEY_1, KEY_2]) {
    expect(text).not.toContain(key);
    expect(text).not.toContain(key.slice(0, -4));
  }
}

test('a conta por chave guarda a chave, abre painéis com ela, tranca o cofre e remove a chave', async ({
  launchApp,
  gitRepo,
  dataDir,
}) => {
  const clipboardFile = join(dataDir, 'area-de-transferencia.txt');
  writeFileSync(clipboardFile, '');
  const projectName = basename(gitRepo.path);
  const launched = await launchApp({
    dialogPath: gitRepo.path,
    accountCliScript: FAKE_ACCOUNT_CLI,
    panelClaudeScript: FAKE_CLAUDE,
    clipboardFile,
    vaultPassword: 'senha-falsa-do-cofre-e2e',
  });
  const { page } = launched;
  const consoleCsp = await watchCsp(page);

  // 1. A conta API nova começa sem chave.
  await openSettings(page);
  const claude = page.getByRole('region', { name: 'Claude Code' });
  await claude.getByRole('button', { name: 'Adicionar conta' }).click();
  await claude.getByRole('radio', { name: 'Chave de API' }).click();
  await claude.getByRole('textbox', { name: 'Nome da conta' }).fill(ACCOUNT);
  await page.keyboard.press('Enter');
  const row = rowOf(page);
  await expect(row).toContainText('Sem chave');
  await expect(row.locator('.api-badge')).toHaveText('API');

  // 2. Colar: a primeira chave cria a senha do cofre (gancho), a linha mostra o fim da chave e o arquivo esvazia.
  writeFileSync(clipboardFile, KEY_1);
  await row.getByRole('button', { name: 'Colar chave da área de transferência' }).click();
  await expect(row.getByRole('status')).toContainText('…UMUM');
  await expect(row).toContainText('Chave guardada');
  await expect(row).toContainText('chave terminada em …UMUM');
  expect(readFileSync(clipboardFile, 'utf8')).toBe('');
  await expectNoKeyOnPage(page);

  // 3. O painel da conta API recebe a chave; o da Principal, não.
  await addGitProject(page, projectName);
  await openProject(page, projectName, 'Terminais');
  await openClaudeIn(page, ACCOUNT);
  const first = panesOf(page, ACCOUNT).nth(0).locator('.terminal-view');
  await expectTerminalToContain(first, 'chave: presente, fim=UMUM', { timeout: 30_000 });
  await openClaudeIn(page, 'Principal');
  const main = panesOf(page, 'Principal').locator('.terminal-view');
  await expectTerminalToContain(main, 'chave: ausente', { timeout: 30_000 });

  // 4. Trocar a chave: o painel novo recebe a nova; o aberto continua com a antiga.
  await openSettings(page);
  writeFileSync(clipboardFile, KEY_2);
  await row.getByRole('button', { name: 'Trocar chave' }).click();
  await expect(row.getByRole('group', { name: /continuam com a chave antiga/ })).toBeVisible();
  await row
    .getByRole('group', { name: /continuam com a chave antiga/ })
    .getByRole('button', { name: 'Trocar chave' })
    .click();
  await expect(row).toContainText('chave terminada em …DOIS');
  expect(readFileSync(clipboardFile, 'utf8')).toBe('');
  await openProject(page, projectName, 'Terminais');
  await openClaudeIn(page, ACCOUNT);
  await expect(panesOf(page, ACCOUNT)).toHaveCount(2);
  const second = panesOf(page, ACCOUNT).nth(1).locator('.terminal-view');
  await expectTerminalToContain(second, 'chave: presente, fim=DOIS', { timeout: 30_000 });
  await expectTerminalToContain(first, 'chave: presente, fim=UMUM');

  // 5. Com o cofre trancado, abrir um painel pede a senha (o gancho responde) e abre com a chave.
  await openSettings(page);
  const vaultBar = page.getByRole('group', { name: 'Cofre das chaves de API' });
  await vaultBar.getByRole('button', { name: 'Trancar cofre' }).click();
  await expect(vaultBar).toContainText('Cofre trancado');
  await expect(row).toContainText('Cofre trancado');
  await openProject(page, projectName, 'Terminais');
  await openClaudeIn(page, ACCOUNT);
  await expect(panesOf(page, ACCOUNT)).toHaveCount(3);
  const third = panesOf(page, ACCOUNT).nth(2).locator('.terminal-view');
  await expectTerminalToContain(third, 'chave: presente, fim=DOIS', { timeout: 30_000 });

  // Os programas saem antes de remover a chave e de o app fechar.
  await quitProgram(page, third, 1);
  await quitProgram(page, second, 2);
  await quitProgram(page, first, 3);
  await quitProgram(page, main, 4);

  // 6. Remover a chave: a linha volta a "Sem chave", a conta fica desativada no menu e reiniciar o painel falha.
  await openSettings(page);
  await row.getByRole('button', { name: 'Remover chave' }).click();
  await row
    .getByRole('group', { name: /Remover a chave apaga/ })
    .getByRole('button', { name: 'Remover chave' })
    .click();
  await expect(row).toContainText('Sem chave');
  await openProject(page, projectName, 'Terminais');
  await panesOf(page, ACCOUNT).nth(0).getByRole('button', { name: 'Iniciar de novo' }).click();
  await expect(panesOf(page, ACCOUNT).nth(0).getByRole('alert')).toHaveText(
    'A conta não tem uma chave de API guardada.',
  );
  await page.getByRole('button', { name: 'Abrir terminal' }).click();
  await page.getByRole('menuitem', { name: /Claude Code/ }).click();
  const option = page
    .getByRole('listbox', { name: 'Conta do Claude Code' })
    .getByRole('option', { name: new RegExp(ACCOUNT) });
  await expect(option).toHaveAttribute('aria-disabled', 'true');
  await expect(option).toContainText('Sem chave');
  await page.keyboard.press('Escape');

  // 7. Em todo o caminho, nenhuma violação de CSP e nenhuma chave no texto da página.
  await expectNoKeyOnPage(page);
  await expectNoViolations(page, consoleCsp, { allowXterm: true });
  await launched.close();
});
