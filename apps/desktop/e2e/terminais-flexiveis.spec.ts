import { basename } from 'node:path';
import type { Locator, Page } from '@playwright/test';
import { expect, test } from './fixtures';
import { addGitProject, openProject } from './missions';
import { expectOpenSessions, expectTerminalToContain, fecharPainel } from './terminals';

// Os terminais flexíveis pela janela do Electron construído: arrastar um painel pela alça do cabeçalho para a borda de
// outro muda o layout sem recriar o terminal (a saída que estava na tela continua lá e a sessão segue viva). Só roda
// no Windows, onde o shell do teste é o PowerShell.
test.skip(process.platform !== 'win32', 'o shell do teste é o PowerShell');

const shellPanes = (page: Page): Locator => page.getByRole('region', { name: 'Painel PowerShell' });
const slots = (page: Page): Locator => page.locator('.pane-tree__leaf[data-leaf-id]');
const slotOf = (page: Page, leafId: string): Locator =>
  page.locator(`.pane-tree__leaf[data-leaf-id="${leafId}"]`);

async function openShell(page: Page): Promise<void> {
  const before = await shellPanes(page).count();
  await page.getByRole('button', { name: 'Abrir terminal' }).click();
  await page.getByRole('menuitem', { name: /PowerShell/ }).click();
  await expect(shellPanes(page)).toHaveCount(before + 1);
  await expectTerminalToContain(shellPanes(page).nth(before).locator('.terminal-view'), 'PS ', {
    timeout: 30_000,
  });
}

async function boxOf(
  locator: Locator,
): Promise<{ x: number; y: number; width: number; height: number }> {
  const box = await locator.boundingBox();
  if (box === null) throw new Error('O elemento não tem caixa na tela.');
  return box;
}

/** Desce o ponteiro na alça do painel e o leva, em passos, até o ponto pedido, sem soltar. */
async function dragGripTo(page: Page, leafId: string, x: number, y: number): Promise<void> {
  const grip = await boxOf(slotOf(page, leafId).locator('.pane__grip'));
  await page.mouse.move(grip.x + grip.width / 2, grip.y + grip.height / 2);
  await page.mouse.down();
  await page.mouse.move(x, y, { steps: 12 });
}

test('arrastar um terminal para a borda de baixo de outro empilha os dois, sem reiniciar a sessão nem perder o que estava na tela', async ({
  launchApp,
  gitRepo,
}) => {
  test.setTimeout(180_000);
  const projectName = basename(gitRepo.path);
  const { app, page } = await launchApp({ dialogPath: gitRepo.path });
  await app.evaluate(({ BrowserWindow }) => {
    BrowserWindow.getAllWindows()[0]?.setSize(1360, 840);
  });
  await addGitProject(page, projectName);
  await openProject(page, projectName, 'Terminais');
  // Com a barra lateral e o painel direito abertos sobra pouca largura: a área precisa caber dois painéis lado a lado.
  await page.getByRole('button', { name: 'Ocultar barra lateral' }).click();
  await page.getByRole('button', { name: 'Ocultar painel direito' }).click();

  await openShell(page);
  await openShell(page);
  await expectOpenSessions(page, 2);
  const [first, second] = await slots(page).evaluateAll((elements) =>
    elements.map((element) => (element as HTMLElement).dataset.leafId ?? ''),
  );
  if (first === undefined || second === undefined) throw new Error('Faltam painéis na grade.');

  // Uma marca na tela do primeiro terminal: se ele fosse recriado, ou a sessão reiniciada, ela sumiria.
  await slotOf(page, first).locator('.xterm-helper-textarea').focus();
  await page.keyboard.type('Write-Output "marca-$(40+2)"');
  await page.keyboard.press('Enter');
  await expectTerminalToContain(slotOf(page, first).locator('.terminal-view'), 'marca-42');

  // Lado a lado: o primeiro à esquerda do segundo, na mesma linha.
  const before = {
    first: await boxOf(slotOf(page, first)),
    second: await boxOf(slotOf(page, second)),
  };
  expect(before.first.x).toBeLessThan(before.second.x);
  expect(Math.abs(before.first.y - before.second.y)).toBeLessThanOrEqual(1);

  // Esc no meio do arrasto cancela: a prévia some e nada muda.
  await dragGripTo(
    page,
    first,
    before.second.x + before.second.width / 2,
    before.second.y + before.second.height - 12,
  );
  await expect(page.locator('.pane-drop')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator('.pane-drop')).toHaveCount(0);
  await page.mouse.up();
  expect((await boxOf(slotOf(page, first))).x).toBeCloseTo(before.first.x, 0);

  // Agora de verdade: junto da borda de baixo do segundo, a prévia tracejada cobre a metade de baixo dele e o
  // fantasma leva o número e o programa do painel arrastado.
  await dragGripTo(
    page,
    first,
    before.second.x + before.second.width / 2,
    before.second.y + before.second.height - 12,
  );
  const preview = await boxOf(page.locator('.pane-drop'));
  expect(preview.y).toBeGreaterThan(before.second.y + before.second.height / 2 - 2);
  expect(Math.abs(preview.width - before.second.width)).toBeLessThanOrEqual(2);
  await expect(page.locator('.pane-ghost')).toContainText('1');
  await expect(page.locator('.pane-ghost')).toContainText('PowerShell');
  await page.mouse.up();
  await expect(page.locator('.pane-drop')).toHaveCount(0);
  await expect(page.locator('.pane-ghost')).toHaveCount(0);

  // Empilhados: o segundo em cima, o primeiro embaixo, os dois com a largura toda da área.
  await expect
    .poll(async () => (await boxOf(slotOf(page, first))).y - (await boxOf(slotOf(page, second))).y)
    .toBeGreaterThan(100);
  const after = {
    first: await boxOf(slotOf(page, first)),
    second: await boxOf(slotOf(page, second)),
  };
  expect(Math.abs(after.first.x - after.second.x)).toBeLessThanOrEqual(1);
  expect(after.first.width).toBeGreaterThan(before.first.width * 1.5);
  expect(Math.abs(after.first.height - after.second.height)).toBeLessThanOrEqual(2);

  // O terminal é o mesmo: a marca continua na tela, as duas sessões seguem vivas e ele ainda responde.
  await expectTerminalToContain(slotOf(page, first).locator('.terminal-view'), 'marca-42');
  await expectOpenSessions(page, 2);
  await slotOf(page, first).locator('.xterm-helper-textarea').focus();
  await page.keyboard.type('Write-Output "depois-$(1+1)"');
  await page.keyboard.press('Enter');
  await expectTerminalToContain(slotOf(page, first).locator('.terminal-view'), 'depois-2');

  // O aviso de desfazer devolve o layout de antes (lado a lado), de novo sem mexer nos terminais.
  await page.getByRole('button', { name: 'Desfazer' }).click();
  await expect
    .poll(async () =>
      Math.abs((await boxOf(slotOf(page, first))).y - (await boxOf(slotOf(page, second))).y),
    )
    .toBeLessThanOrEqual(1);
  expect((await boxOf(slotOf(page, first))).x).toBeLessThan((await boxOf(slotOf(page, second))).x);
  await expectTerminalToContain(slotOf(page, first).locator('.terminal-view'), 'depois-2');
  await expectOpenSessions(page, 2);

  // Fechar os painéis encerra as sessões: um shell vivo seguraria a pasta do projeto e o fechamento do app.
  for (let left = 2; left > 0; left -= 1) {
    await fecharPainel(page, 'PowerShell');
    await expectOpenSessions(page, left - 1);
  }
  await expect(page.getByText('Nenhum terminal aberto')).toBeVisible({ timeout: 15_000 });
});
