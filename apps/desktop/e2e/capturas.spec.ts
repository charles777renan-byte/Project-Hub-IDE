import { mkdirSync } from 'node:fs';
import { basename, join } from 'node:path';
import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';
import {
  addGitProject,
  createMission,
  decisionBlock,
  openProject,
  orchestrate,
  statusBarOf,
  viewTab,
} from './missions';
import { expectTerminalToContain } from './terminals';

// Capturas de tela das telas principais, para a pessoa que revisa o visual. Não é teste de comportamento: só
// roda com `E2E_CAPTURAS=1` (a pasta de saída vem de `E2E_CAPTURAS_DIR`, e o padrão é `out/capturas`). Sem a
// variável, o teste é pulado e o CI não grava nada.

const ENABLED = process.env['E2E_CAPTURAS'] === '1';
test.skip(!ENABLED, 'Capturas de tela: defina E2E_CAPTURAS=1 para gravar.');
test.skip(process.platform !== 'win32', 'o shell do teste é o PowerShell');

const OUTPUT =
  process.env['E2E_CAPTURAS_DIR'] ?? join(import.meta.dirname, '..', 'out', 'capturas');
const FAKE_PLANNER = join(import.meta.dirname, 'fixtures', 'fake-claude-planner.mjs');

const MISSION = {
  title: 'Orquestrar o login',
  objective: 'Planejar e fazer o login do aplicativo.',
  criterion: 'A pessoa consegue entrar com e-mail e senha',
};

/** Grava a tela inteira da janela em `<pasta>/<nome>.png`. */
async function shoot(page: Page, name: string): Promise<void> {
  mkdirSync(OUTPUT, { recursive: true });
  await page.screenshot({ path: join(OUTPUT, `${name}.png`) });
}

test('capturas: Início, Terminais, Missões, Nova missão, missão planejada e janela estreita', async ({
  launchApp,
  gitRepo,
}) => {
  test.setTimeout(180_000);
  const projectName = basename(gitRepo.path);
  const { app, page } = await launchApp({ dialogPath: gitRepo.path, plannerScript: FAKE_PLANNER });
  // Uma janela de tamanho conhecido, para as capturas serem comparáveis entre as rodadas.
  await app.evaluate(({ BrowserWindow }) => {
    BrowserWindow.getAllWindows()[0]?.setSize(1360, 840);
  });

  await addGitProject(page, projectName);
  await openProject(page, projectName, 'Terminais');

  // Terminais: um PowerShell aberto, com o prompt na tela.
  const pane = page.getByRole('region', { name: 'Painel PowerShell' });
  await page.getByRole('button', { name: 'Abrir terminal' }).click();
  await page.getByRole('menuitem', { name: /PowerShell/ }).click();
  await expect(pane).toHaveCount(1);
  await expectTerminalToContain(pane.locator('.terminal-view'), 'PS ', { timeout: 30_000 });
  await shoot(page, '2-projeto-terminais');
  await pane.getByRole('button', { name: 'Fechar painel', exact: true }).click();
  await expect(pane).toHaveCount(0);

  // Missões vazia e o formulário Nova missão aberto.
  await viewTab(page, 'Missões').click();
  await page.getByRole('button', { name: 'Nova missão' }).first().click();
  await expect(page.getByRole('form', { name: 'Nova missão' })).toBeVisible();
  await shoot(page, '4-nova-missao');
  await page.getByRole('button', { name: 'Cancelar', exact: true }).click();

  // A missão planejada: quadro do orquestrador, tabela das tarefas e o bloco "Sua decisão".
  await createMission(page, MISSION);
  await orchestrate(page);
  await expect(page.getByRole('region', { name: 'Quadro do orquestrador' })).toBeVisible();
  await shoot(page, '5-missao-planejada');
  // O mesmo corpo rolado até a tabela das tarefas e o bloco "Sua decisão".
  await page.getByRole('table', { name: 'Etapas do plano' }).scrollIntoViewIfNeeded();
  await decisionBlock(page).scrollIntoViewIfNeeded();
  await page.waitForTimeout(300);
  await shoot(page, '5b-missao-tarefas-e-decisao');
  await page.getByRole('region', { name: 'Quadro do orquestrador' }).scrollIntoViewIfNeeded();

  // Janela estreita (900px) com a mesma missão.
  await app.evaluate(({ BrowserWindow }) => {
    BrowserWindow.getAllWindows()[0]?.setSize(900, 700);
  });
  await expect(statusBarOf(page)).toBeVisible();
  await page.waitForTimeout(600);
  await shoot(page, '6-missao-janela-estreita');
  await app.evaluate(({ BrowserWindow }) => {
    BrowserWindow.getAllWindows()[0]?.setSize(1360, 840);
  });

  // Missões do projeto, com a missão e o progresso na lista.
  await page.getByRole('link', { name: '← Missões' }).click();
  await expect(page.getByRole('link', { name: MISSION.title, exact: true })).toBeVisible();
  await page.waitForTimeout(400);
  await shoot(page, '3-projeto-missoes');

  // Reabrir a missão planejada: o bloco "Sua decisão" já vem à vista, sem rolar.
  await page.getByRole('link', { name: MISSION.title, exact: true }).click();
  await expect(decisionBlock(page)).toBeInViewport();
  await page.waitForTimeout(400);
  await shoot(page, '5c-missao-reaberta');

  // Início, com a missão na lista e o contador "aguarda você" aceso.
  await page.getByRole('link', { name: 'Início', exact: true }).click();
  // A missão que espera a pessoa aparece uma vez, na faixa "Precisa de você" (a banda Missões não a repete).
  await expect(
    page
      .getByRole('region', { name: 'Precisa de você' })
      .getByRole('link', { name: MISSION.title, exact: true }),
  ).toBeVisible();
  await page.waitForTimeout(800);
  await shoot(page, '1-inicio');
});
