import { basename, join } from 'node:path';
import { expect, test } from './fixtures';
import { addGitProject, openProject, sidebarOf } from './missions';
import { expectTerminalToContain } from './terminals';

// O Claude aberto pelo menu "Abrir terminal" que pede permissão aparece como "Aguardando" no cabeçalho do painel e
// na barra lateral, e volta ao normal quando a ferramenta termina. O `claude` é trocado por um CLI falso
// (`fake-claude-pedido.mjs`), que dispara os mesmos hooks que o Claude Code dispararia, pelo script real do app.

const FAKE_CLAUDE = join(import.meta.dirname, 'fixtures', 'fake-claude-pedido.mjs');

test('Claude avulso: pedir permissão vira "Aguardando", e a resposta devolve o estado', async ({
  launchApp,
  gitRepo,
}) => {
  const projectName = basename(gitRepo.path);
  const { page, close } = await launchApp({
    dialogPath: gitRepo.path,
    panelClaudeScript: FAKE_CLAUDE,
  });

  await addGitProject(page, projectName);
  await openProject(page, projectName, 'Terminais');
  await page.getByRole('button', { name: 'Abrir terminal' }).click();
  await page.getByRole('menuitem', { name: /Claude Code/ }).click();

  const pane = page.getByRole('region', { name: /^Painel Claude Code/ });
  const view = pane.locator('.terminal-view');
  await expectTerminalToContain(view, 'claude-falso: pronto', { timeout: 30_000 });

  // A barra lateral lista a sessão; antes do pedido, ninguém aguarda.
  const bar = sidebarOf(page);
  await bar.getByRole('button', { name: `Sessões de ${projectName}` }).click();
  const card = bar.locator('.sidebar__card');
  await expect(card).toHaveCount(1, { timeout: 15_000 });
  await expect(pane.locator('.pane__head .state-mark--waiting')).toHaveCount(0);
  await expect(card).not.toContainText('aguardando você');

  // O Claude pede permissão: o painel e o cartão passam a dizer que ele aguarda (a lista é relida a cada 2 s).
  await view.click();
  await page.keyboard.type('pedir');
  await page.keyboard.press('Enter');
  await expectTerminalToContain(view, 'claude-falso: permitir-comando?', { timeout: 15_000 });
  await expect(pane.locator('.pane__head .state-mark--waiting')).toHaveCount(1, {
    timeout: 15_000,
  });
  await expect(pane.locator('.pane__head .state-mark--waiting')).toContainText('Aguardando');
  await expect(card).toContainText('aguardando você');
  const shot = process.env['AGUARDANDO_SHOT'];
  if (shot !== undefined) await page.screenshot({ path: shot });

  // A pessoa responde e a ferramenta termina: o estado volta.
  await view.click();
  await page.keyboard.type('s');
  await page.keyboard.press('Enter');
  await expectTerminalToContain(view, 'claude-falso: ferramenta-terminou', { timeout: 15_000 });
  await expect(pane.locator('.pane__head .state-mark--waiting')).toHaveCount(0, {
    timeout: 15_000,
  });
  await expect(card).not.toContainText('aguardando você');

  // Encerra o processo falso antes de fechar o app.
  await view.click();
  await page.keyboard.type('sair');
  await page.keyboard.press('Enter');
  await expectTerminalToContain(view, 'processo encerrado', { timeout: 15_000 });

  await close();
});
