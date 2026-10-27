import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';

// A ordem das abas da barra superior pela janela do Electron construído: arrastar, Alt com as setas e a ordem
// que sobrevive a reabrir o app. Os projetos são pastas comuns do teste; abrir um workspace não pede Git nem terminal.

const NAMES = ['Alfa', 'Beta', 'Gama'];

type Hub = {
  projects: { add(input: { path: string }): Promise<{ ok: boolean; error?: { message: string } }> };
};

/** Cadastra as pastas pela API da janela e recarrega, para o menu da barra ver os projetos novos. */
async function addProjects(page: Page, dataDir: string): Promise<void> {
  const paths = NAMES.map((name) => {
    const path = join(dataDir, 'projetos', name);
    mkdirSync(path, { recursive: true });
    return path;
  });
  await page.evaluate(async (folders) => {
    const hub = (window as unknown as { projectHub: Hub }).projectHub;
    for (const path of folders) {
      const result = await hub.projects.add({ path });
      if (!result.ok) throw new Error(result.error?.message ?? 'falha ao cadastrar');
    }
  }, paths);
  await page.reload();
  await expect(page.getByRole('button', { name: 'Abrir workspace' })).toBeVisible();
}

/** Abre o workspace de cada projeto pelo menu "Abrir workspace" da barra, na ordem dos nomes. */
async function openWorkspaces(page: Page): Promise<void> {
  for (const name of NAMES) {
    await page.getByRole('button', { name: 'Abrir workspace' }).click();
    await page.getByRole('menuitem', { name, exact: true }).click();
  }
}

/** As abas da barra, na ordem em que aparecem. */
const tabs = (page: Page) =>
  page.getByRole('navigation', { name: 'Workspaces abertos' }).getByRole('link');

test('arrastar e Alt com as setas ordenam as abas, e a ordem volta igual depois de reabrir o app', async ({
  launchApp,
  dataDir,
}) => {
  const first = await launchApp();
  await addProjects(first.page, dataDir);
  await openWorkspaces(first.page);
  await expect(tabs(first.page)).toHaveText(NAMES);

  // Arrasta a última aba para antes da primeira.
  await tabs(first.page)
    .nth(2)
    .dragTo(tabs(first.page).nth(0), { targetPosition: { x: 5, y: 10 } });
  await expect(tabs(first.page)).toHaveText(['Gama', 'Alfa', 'Beta']);

  // Alt com a seta esquerda move a aba com o foco, e o foco fica nela.
  await tabs(first.page).nth(2).focus();
  await first.page.keyboard.press('Alt+ArrowLeft');
  await expect(tabs(first.page)).toHaveText(['Gama', 'Beta', 'Alfa']);
  const focused = await first.page.evaluate(() => document.activeElement?.textContent);
  expect(focused).toBe('Beta');

  await first.close();

  // A ordem gravada no banco volta na janela nova.
  const second = await launchApp();
  await expect(tabs(second.page)).toHaveText(['Gama', 'Beta', 'Alfa']);
});
