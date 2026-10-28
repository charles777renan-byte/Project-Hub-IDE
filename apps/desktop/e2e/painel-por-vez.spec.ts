import { basename } from 'node:path';
import type { Locator, Page } from '@playwright/test';
import { expect, test } from './fixtures';
import { addGitProject, openProject } from './missions';
import { expectOpenSessions, expectTerminalToContain } from './terminals';

// O modo "um painel por vez" do workspace pela janela do Electron construído: o botão "Abas", a faixa de abas, o
// atalho Ctrl+Alt com as setas com o foco dentro do terminal (o xterm toma teclas, então só o navegador real
// prova que a captura chega antes dele) e a volta à grade. Só roda no Windows, onde o shell do teste é o PowerShell.
test.skip(process.platform !== 'win32', 'o shell do teste é o PowerShell');

const shellPanes = (page: Page): Locator => page.getByRole('region', { name: 'Painel PowerShell' });
const tabs = (page: Page): Locator =>
  page.getByRole('tablist', { name: 'Painéis abertos' }).getByRole('tab');

async function addProjectAndOpenWorkspace(page: Page, projectName: string): Promise<void> {
  await addGitProject(page, projectName);
  await openProject(page, projectName, 'Terminais');
  await expect(page.getByRole('button', { name: 'Abrir terminal' })).toBeVisible();
}

async function openShell(page: Page): Promise<void> {
  const before = await shellPanes(page).count();
  await page.getByRole('button', { name: 'Abrir terminal' }).click();
  await page.getByRole('menuitem', { name: /PowerShell/ }).click();
  await expect(shellPanes(page)).toHaveCount(before + 1);
  await expectTerminalToContain(shellPanes(page).nth(before).locator('.terminal-view'), 'PS ', {
    timeout: 30_000,
  });
}

/** Fecha todos os painéis da grade: fechar encerra a sessão, e um shell vivo seguraria a pasta e o fechamento do app. */
async function endShells(page: Page): Promise<void> {
  const total = await shellPanes(page).count();
  for (let left = total; left > 0; left -= 1) {
    await shellPanes(page)
      .nth(0)
      .getByRole('button', { name: 'Fechar painel', exact: true })
      .click();
    await expect(shellPanes(page)).toHaveCount(left - 1, { timeout: 15_000 });
    await expectOpenSessions(page, left - 1);
  }
  await expect(page.getByText('Nenhum terminal aberto')).toBeVisible({ timeout: 15_000 });
}

test('Abas mostra um painel por vez, Ctrl+Alt com as setas troca de aba com o foco no terminal, e Grade volta', async ({
  launchApp,
  gitRepo,
}) => {
  test.setTimeout(180_000);
  const { page } = await launchApp({ dialogPath: gitRepo.path });
  await addProjectAndOpenWorkspace(page, basename(gitRepo.path));
  for (let index = 0; index < 3; index += 1) await openShell(page);
  await expect(shellPanes(page)).toHaveCount(3);

  await page.getByRole('button', { name: 'Abas', exact: true }).click();
  await expect(tabs(page)).toHaveCount(3);
  await expect(shellPanes(page)).toHaveCount(1);
  const selected = () => tabs(page).and(page.getByRole('tab', { selected: true }));
  await expect(selected()).toHaveCount(1);
  const first = await tabs(page).evaluateAll((items) =>
    items.findIndex((item) => item.getAttribute('aria-selected') === 'true'),
  );

  // Com o foco dentro do terminal, a tecla não pode ir ao xterm: o painel mostrado troca.
  await shellPanes(page).locator('.xterm-helper-textarea').focus();
  await page.keyboard.press('Control+Alt+ArrowLeft');
  const after = await tabs(page).evaluateAll((items) =>
    items.findIndex((item) => item.getAttribute('aria-selected') === 'true'),
  );
  expect(after).toBe((first + 2) % 3);
  await expect(shellPanes(page)).toHaveCount(1);
  // O terminal do painel novo recebe o foco, e o shell dele segue vivo.
  await page.keyboard.type('Write-Output "aba-$(1+1)"');
  await page.keyboard.press('Enter');
  await expectTerminalToContain(shellPanes(page).locator('.terminal-view'), 'aba-2');

  // O botão do painel devolve à grade, e o layout guardado não mudou: a grade tem os três.
  await shellPanes(page).getByRole('button', { name: 'Voltar à grade' }).click();
  await expect(tabs(page)).toHaveCount(0);
  await expect(shellPanes(page)).toHaveCount(3);

  // Maximizar pelo botão do painel liga o modo de novo, e "Grade" na faixa volta.
  await shellPanes(page).nth(1).getByRole('button', { name: 'Maximizar painel' }).click();
  await expect(shellPanes(page)).toHaveCount(1);
  await page.locator('.pane-tabs').getByRole('button', { name: 'Grade', exact: true }).click();
  await expect(shellPanes(page)).toHaveCount(3);

  await endShells(page);
});
