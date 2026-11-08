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
async function addProjects(
  page: Page,
  dataDir: string,
  names: readonly string[] = NAMES,
): Promise<void> {
  const paths = names.map((name) => {
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
async function openWorkspaces(page: Page, names: readonly string[] = NAMES): Promise<void> {
  for (const name of names) {
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

test('com a janela estreita e muitas abas, o botão "Abas fora de vista" lista as escondidas e traz a escolhida para a vista', async ({
  launchApp,
  dataDir,
}) => {
  const many = Array.from({ length: 8 }, (_, index) => `Projeto de nome comprido ${index + 1}`);
  const { app, page } = await launchApp();
  await addProjects(page, dataDir, many);
  await openWorkspaces(page, many);
  await expect(tabs(page)).toHaveCount(many.length);

  await app.evaluate(({ BrowserWindow }) => {
    BrowserWindow.getAllWindows()[0]?.setSize(900, 700);
  });

  const trigger = page.getByRole('button', { name: 'Abas fora de vista' });
  await expect(trigger).toBeVisible();
  const strip = page.getByRole('navigation', { name: 'Workspaces abertos' });
  await expect(strip).toHaveAttribute('data-fade-end', 'true');

  // A primeira aba (a mais à esquerda) está fora de vista depois de abrir a última; a lista traz só as escondidas.
  await trigger.click();
  const items = page.getByRole('menuitem');
  const hiddenCount = await items.count();
  expect(hiddenCount).toBeGreaterThan(0);
  expect(hiddenCount).toBeLessThan(many.length);
  const target = items.first();
  const targetName = (await target.textContent()) ?? '';
  await target.click();

  // A aba escolhida passa a caber inteira na faixa.
  const inside = await strip.evaluate((nav, name) => {
    const link = Array.from(nav.querySelectorAll('a')).find((item) => item.textContent === name);
    if (link === undefined) return false;
    const box = link.getBoundingClientRect();
    const area = nav.getBoundingClientRect();
    return box.left >= area.left - 1 && box.right <= area.right + 1;
  }, targetName);
  expect(inside).toBe(true);
});
