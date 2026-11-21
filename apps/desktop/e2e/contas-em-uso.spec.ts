import type { Locator, Page } from '@playwright/test';
import { readdirSync } from 'node:fs';
import { basename, join } from 'node:path';
import { expect, FAKE_ACCOUNT_CLI, test } from './fixtures';
import { addGitProject, openProject } from './missions';
import { expectTerminalToContain } from './terminals';

// A conta em uso, na janela real: o painel abre na conta escolhida, volta nela depois de fechar e reabrir o app, e
// diz que a conta foi removida quando ela some. O `claude` do painel é um CLI falso que mostra a pasta de conta que
// recebeu; o dos comandos de conta é o `fake-account-cli.mjs`. Nenhum programa de verdade roda.

const FAKE_CLAUDE = join(import.meta.dirname, 'fixtures', 'fake-claude-conta.mjs');
const OPTIONS = { accountCliScript: FAKE_ACCOUNT_CLI, panelClaudeScript: FAKE_CLAUDE };

async function openSettings(page: Page): Promise<void> {
  await page.locator('.sidebar__settings').click();
  await expect(page.getByRole('heading', { level: 1, name: 'Configurações' })).toBeVisible();
}

/** O painel do Claude Code que mostra esta conta na etiqueta do cabeçalho. */
function paneOf(page: Page, account: string): Locator {
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

test('o painel abre na conta escolhida, reabre nela e avisa quando a conta é removida', async ({
  launchApp,
  gitRepo,
  dataDir,
}) => {
  const projectName = basename(gitRepo.path);
  const first = await launchApp({ dialogPath: gitRepo.path, ...OPTIONS });
  const { page } = first;

  // Uma conta extra, ainda sem login: ela pode ser escolhida mesmo assim.
  await openSettings(page);
  const claude = page.getByRole('region', { name: 'Claude Code' });
  await claude.getByRole('button', { name: 'Adicionar conta' }).click();
  await claude.getByRole('textbox', { name: 'Nome da conta' }).fill('Trabalho');
  await page.keyboard.press('Enter');
  await expect(claude.locator('.acct__name-text', { hasText: 'Trabalho' })).toBeVisible();
  const [folder] = readdirSync(join(dataDir, 'accounts', 'claude'));
  expect(folder).toBeDefined();

  await addGitProject(page, projectName);
  await openProject(page, projectName, 'Terminais');

  // Cada painel recebe a pasta da conta dele: a Principal não recebe pasta nenhuma, e a extra recebe a dela.
  await openClaudeIn(page, 'Principal');
  await expectTerminalToContain(
    paneOf(page, 'Principal').locator('.terminal-view'),
    'conta-falsa: pasta=(principal)',
    { timeout: 30_000 },
  );
  await openClaudeIn(page, 'Trabalho');
  const work = paneOf(page, 'Trabalho').locator('.terminal-view');
  await expectTerminalToContain(work, 'conta-falsa: pasta=', { timeout: 30_000 });
  await expectTerminalToContain(work, folder ?? '');
  // Os programas saem antes de o app fechar, como nos outros testes com o Claude falso.
  await quitProgram(page, paneOf(page, 'Trabalho').locator('.terminal-view'), 1);
  await quitProgram(page, paneOf(page, 'Principal').locator('.terminal-view'), 2);
  await first.close();

  // De volta, o painel da conta nova segue nela, e iniciar abre o programa na mesma pasta.
  const second = await launchApp(OPTIONS);
  const again = second.page;
  await openProject(again, projectName, 'Terminais');
  const pane = paneOf(again, 'Trabalho');
  await expect(pane).toHaveCount(1, { timeout: 30_000 });
  await pane.getByRole('button', { name: 'Iniciar Claude Code' }).click();
  const view = pane.locator('.terminal-view');
  await expectTerminalToContain(view, folder ?? '', { timeout: 30_000 });

  // O programa sai; com a sessão parada, a conta pode ser removida.
  await quitProgram(again, view, 1);

  await openSettings(again);
  const row = again
    .getByRole('region', { name: 'Claude Code' })
    .locator('li.acct')
    .filter({ has: again.locator('.acct__name-text', { hasText: 'Trabalho' }) });
  await row.getByRole('button', { name: 'Mais ações da conta Trabalho' }).click();
  await again.getByRole('menuitem', { name: 'Remover conta' }).click();
  await row.getByRole('button', { name: 'Remover conta' }).click();
  await expect(row).toHaveCount(0);

  await openProject(again, projectName, 'Terminais');
  await expect(again.locator('.pane__account--removed')).toHaveText('A conta foi removida', {
    timeout: 15_000,
  });
  await second.close();
});
