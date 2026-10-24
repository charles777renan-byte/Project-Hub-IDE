import { basename } from 'node:path';
import type { Locator, Page } from '@playwright/test';
import { expect, test } from './fixtures';

// O workspace pela janela do Electron construído: painéis, sessões reais no processo de terminais (PowerShell),
// o xterm, a barra lateral e a CSP real. Só roda no Windows, onde o shell do teste é o PowerShell.
test.skip(process.platform !== 'win32', 'o shell do teste é o PowerShell');

const BAR_NAME = 'Projetos e missões';

/** Painéis do PowerShell abertos no workspace (cada sessão em andamento tem o nome do programa). */
function shellPanes(page: Page): Locator {
  return page.getByRole('region', { name: 'Painel PowerShell' });
}

/** Cadastra o projeto pelo seletor (a pasta vem de `dialogPath`) e abre o workspace pela barra lateral. */
async function addProjectAndOpenWorkspace(page: Page, projectName: string): Promise<void> {
  const navigation = page.getByRole('navigation', { name: 'Principal' });
  await navigation.getByRole('link', { name: 'Projetos' }).click();
  await page.getByRole('button', { name: 'Adicionar projeto' }).click();
  await expect(page.getByRole('heading', { name: projectName })).toBeVisible();
  await page
    .getByRole('complementary', { name: BAR_NAME })
    .getByRole('link', { name: projectName, exact: true })
    .click();
  // O workspace novo abre vazio, com a barra para abrir terminais.
  await expect(page.getByRole('toolbar', { name: 'Abrir terminal' })).toBeVisible();
  await expect(page.getByText('Nenhum terminal aberto')).toBeVisible();
}

/** Abre mais um painel do PowerShell pela barra e espera o prompt da sessão nova aparecer nele. */
async function openShell(page: Page): Promise<void> {
  const before = await shellPanes(page).count();
  await page
    .getByRole('toolbar', { name: 'Abrir terminal' })
    .getByRole('button', { name: 'PowerShell' })
    .click();
  await expect(shellPanes(page)).toHaveCount(before + 1);
  await expect(shellPanes(page).nth(before).locator('.xterm-rows')).toContainText('PS ', {
    timeout: 30_000,
  });
}

/** Abre o PowerShell pela barra, digita um comando e espera a saída `ola-4` (o workspace tem só esse painel). */
async function runHello(page: Page): Promise<void> {
  await openShell(page);
  const screen = page.locator('.xterm-rows');
  await page.locator('.xterm-helper-textarea').focus();
  await page.keyboard.type('Write-Output "ola-$(2+2)"');
  await page.keyboard.press('Enter');
  await expect(screen).toContainText('ola-4', { timeout: 15_000 });
}

/** Fecha o painel de índice `index` pelo botão "Fechar painel" e confirma; o painel some da tela. */
async function closePane(page: Page, index: number): Promise<void> {
  const panes = shellPanes(page);
  const before = await panes.count();
  await panes.nth(index).getByRole('button', { name: 'Fechar painel', exact: true }).click();
  await panes
    .nth(index)
    .getByRole('group', { name: /^Fechar o painel/ })
    .getByRole('button', { name: 'Fechar painel', exact: true })
    .click();
  await expect(panes).toHaveCount(before - 1, { timeout: 15_000 });
}

/**
 * Fecha todos os painéis e espera o estado vazio. Todo teste que inicia um shell termina assim: fechar o
 * painel encerra a sessão, e o processo de terminais só sai por ociosidade (3 s) quando não há sessão viva;
 * com um shell vivo ele segue de pé depois do app e segura a pasta do repositório e o fechamento do app.
 */
async function endShell(page: Page): Promise<void> {
  const total = await shellPanes(page).count();
  for (let left = total; left > 0; left -= 1) await closePane(page, 0);
  await expect(page.getByText('Nenhum terminal aberto')).toBeVisible({ timeout: 15_000 });
}

/** Digita `exit` no shell do painel `index`: a sessão termina e o painel mostra o aviso. */
async function exitShell(page: Page, index: number): Promise<void> {
  await shellPanes(page).nth(index).locator('.xterm-helper-textarea').focus();
  await page.keyboard.type('exit');
  await page.keyboard.press('Enter');
  await expect(shellPanes(page).nth(index).getByText('A sessão terminou.')).toBeVisible({
    timeout: 15_000,
  });
}

/** Largura do primeiro painel da divisória da raiz, em px, e a da própria raiz. */
async function rootFirstWidth(page: Page): Promise<{ first: number; total: number }> {
  return page.evaluate(() => {
    const group = document.querySelector<HTMLElement>('.pane-tree__group');
    const first = group?.querySelector<HTMLElement>(':scope > div > .pane-tree__panel');
    if (group === null || first === null || first === undefined) throw new Error('sem raiz');
    return {
      first: first.getBoundingClientRect().width,
      total: group.getBoundingClientRect().width,
    };
  });
}

test('o workspace novo abre vazio, com a barra para abrir um terminal de cada programa', async ({
  launchApp,
  gitRepo,
}) => {
  const projectName = basename(gitRepo.path);
  const { page } = await launchApp({ dialogPath: gitRepo.path });
  await addProjectAndOpenWorkspace(page, projectName);

  await expect(page.getByRole('region', { name: /^Painel / })).toHaveCount(0);
  await expect(
    page.getByText('Escolha um programa na barra acima para abrir um terminal.'),
  ).toBeVisible();
  const toolbar = page.getByRole('toolbar', { name: 'Abrir terminal' });
  for (const label of ['Claude Code', 'Codex']) {
    const open = toolbar.getByRole('button', { name: label });
    await expect(open).toBeVisible();
    // A disponibilidade depende da máquina: ou o botão está habilitado, ou o motivo aparece na dica.
    if (!(await open.isEnabled())) {
      await open.locator('xpath=..').focus();
      await expect(page.locator('.hint')).toContainText('não foi encontrado no PATH');
    }
  }
  await expect(toolbar.getByRole('button', { name: 'PowerShell' })).toBeEnabled();
});

test('abrir três terminais pela barra: um painel à esquerda e dois empilhados à direita, cada um com sessão viva', async ({
  launchApp,
  gitRepo,
}) => {
  const projectName = basename(gitRepo.path);
  const { page } = await launchApp({ dialogPath: gitRepo.path });
  await addProjectAndOpenWorkspace(page, projectName);

  await openShell(page);
  // Um painel só ocupa a área inteira.
  const area = await page.locator('.workspace__area').boundingBox();
  const single = await shellPanes(page).first().boundingBox();
  if (area === null || single === null) throw new Error('Sem caixa na tela.');
  expect(single.width).toBeGreaterThan(area.width * 0.95);
  expect(single.height).toBeGreaterThan(area.height * 0.9);

  await openShell(page);
  await openShell(page);
  const panes = shellPanes(page);
  await expect(panes).toHaveCount(3);
  await expect(page.locator('.xterm-rows')).toHaveCount(3);

  const left = await panes.nth(0).boundingBox();
  const topRight = await panes.nth(1).boundingBox();
  const bottomRight = await panes.nth(2).boundingBox();
  if (left === null || topRight === null || bottomRight === null) {
    throw new Error('Um painel não tem caixa na tela.');
  }
  // O primeiro fica à esquerda e ocupa a altura toda; o segundo e o terceiro dividem a coluna da direita.
  expect(left.x).toBeLessThan(topRight.x);
  expect(left.x + left.width).toBeLessThanOrEqual(topRight.x + 2);
  expect(Math.abs(topRight.x - bottomRight.x)).toBeLessThan(2);
  expect(Math.abs(topRight.width - bottomRight.width)).toBeLessThan(2);
  expect(topRight.y + topRight.height).toBeLessThanOrEqual(bottomRight.y + 2);
  expect(left.height).toBeGreaterThan(topRight.height + bottomRight.height - 4);
  expect(Math.abs(left.y - topRight.y)).toBeLessThan(2);

  // Cada painel tem uma sessão viva: o comando digitado nele responde.
  for (let index = 0; index < 3; index += 1) {
    await panes.nth(index).locator('.xterm-helper-textarea').focus();
    await page.keyboard.type(`Write-Output "vivo-${index}-$(1+1)"`);
    await page.keyboard.press('Enter');
    await expect(panes.nth(index).locator('.xterm-rows')).toContainText(`vivo-${index}-2`, {
      timeout: 15_000,
    });
  }
  await endShell(page);
});

test('fechar um painel pede confirmação, encerra a sessão e os outros ocupam o espaço; fechar todos volta ao estado vazio', async ({
  launchApp,
  gitRepo,
}) => {
  const projectName = basename(gitRepo.path);
  const { page } = await launchApp({ dialogPath: gitRepo.path });
  await addProjectAndOpenWorkspace(page, projectName);
  await openShell(page);
  await openShell(page);
  await openShell(page);
  const panes = shellPanes(page);

  const bar = page.getByRole('complementary', { name: BAR_NAME });
  await bar.getByRole('button', { name: `Sessões de ${projectName}` }).click();
  const sessions = bar.locator('.sidebar__session').getByRole('button');
  await expect(sessions).toHaveCount(3);

  // "Voltar" na confirmação desfaz o pedido: nada fecha.
  await panes.nth(2).getByRole('button', { name: 'Fechar painel', exact: true }).click();
  const question = panes.nth(2).getByRole('group', { name: /^Fechar o painel/ });
  await expect(question).toBeVisible();
  await question.getByRole('button', { name: 'Voltar' }).click();
  await expect(panes).toHaveCount(3);
  await expect(sessions).toHaveCount(3);

  // Confirmado, o painel sai, a sessão dele termina e os dois restantes ficam lado a lado.
  await closePane(page, 2);
  await expect(sessions).toHaveCount(2, { timeout: 15_000 });
  const area = await page.locator('.workspace__area').boundingBox();
  const first = await panes.nth(0).boundingBox();
  const second = await panes.nth(1).boundingBox();
  if (area === null || first === null || second === null) throw new Error('Sem caixa na tela.');
  expect(Math.abs(first.y - second.y)).toBeLessThan(2);
  expect(Math.abs(first.height - second.height)).toBeLessThan(2);
  expect(first.x + first.width).toBeLessThanOrEqual(second.x + 2);
  expect(first.width + second.width).toBeGreaterThan(area.width * 0.9);

  // Fechando o primeiro, o que sobra ocupa a área inteira.
  await closePane(page, 0);
  await expect(sessions).toHaveCount(1, { timeout: 15_000 });
  await expect
    .poll(async () => (await panes.first().boundingBox())?.width ?? 0)
    .toBeGreaterThan(area.width * 0.95);

  // O último painel fechado deixa o estado vazio de novo.
  await closePane(page, 0);
  await expect(page.getByText('Nenhum terminal aberto')).toBeVisible();
  await expect(page.getByRole('region', { name: /^Painel / })).toHaveCount(0);
  await expect(sessions).toHaveCount(0, { timeout: 15_000 });
});

test('recarregar a janela mantém os painéis e as sessões vivas', async ({ launchApp, gitRepo }) => {
  const projectName = basename(gitRepo.path);
  const { page } = await launchApp({ dialogPath: gitRepo.path });
  await addProjectAndOpenWorkspace(page, projectName);
  await openShell(page);
  await openShell(page);
  await openShell(page);
  await shellPanes(page).nth(1).locator('.xterm-helper-textarea').focus();
  await page.keyboard.type('Write-Output "antes-$(3+3)"');
  await page.keyboard.press('Enter');
  await expect(shellPanes(page).nth(1).locator('.xterm-rows')).toContainText('antes-6', {
    timeout: 15_000,
  });

  await page.reload();
  await expect(page.getByRole('navigation', { name: 'Principal' })).toBeVisible();
  // A aba do workspace continua aberta; se a janela não voltar nela, abre pela aba.
  const tab = page.getByRole('navigation', { name: 'Workspaces abertos' }).getByRole('link');
  await expect(tab).toBeVisible();
  if ((await shellPanes(page).count()) === 0) await tab.click();
  await expect(shellPanes(page)).toHaveCount(3, { timeout: 30_000 });
  await expect(page.locator('.xterm-rows')).toHaveCount(3);
  await expect(shellPanes(page).nth(1).locator('.xterm-rows')).toContainText('antes-6', {
    timeout: 15_000,
  });
  // As sessões seguem vivas: o painel responde a um comando novo.
  await shellPanes(page).nth(2).locator('.xterm-helper-textarea').focus();
  await page.keyboard.type('Write-Output "depois-$(4+4)"');
  await page.keyboard.press('Enter');
  await expect(shellPanes(page).nth(2).locator('.xterm-rows')).toContainText('depois-8', {
    timeout: 15_000,
  });
  await endShell(page);
});

test('a sessão do shell segue viva ao sair do workspace e ao fechar e reabrir a aba', async ({
  launchApp,
  gitRepo,
}) => {
  const projectName = basename(gitRepo.path);
  const { page } = await launchApp({ dialogPath: gitRepo.path });
  await addProjectAndOpenWorkspace(page, projectName);
  await runHello(page);
  const screen = page.locator('.xterm-rows');

  // Vai para o Início e volta pela aba do workspace: o processo não reinicia.
  await page
    .getByRole('navigation', { name: 'Principal' })
    .getByRole('link', { name: 'Início' })
    .click();
  await expect(page.locator('.xterm-rows')).toHaveCount(0);
  await page.getByRole('navigation', { name: 'Workspaces abertos' }).getByRole('link').click();
  await expect(screen).toContainText('ola-4');

  // Fecha a aba e reabre por "+": a sessão continua com o mesmo texto.
  await page.getByRole('button', { name: `Fechar workspace ${projectName}` }).click();
  await expect(page.getByRole('navigation', { name: 'Workspaces abertos' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Abrir workspace' }).click();
  await page.getByRole('menuitem', { name: projectName }).click();
  await expect(page.locator('.xterm-rows')).toContainText('ola-4', { timeout: 15_000 });
  await expect(page.getByText('Nenhum terminal aberto')).toHaveCount(0);
  await endShell(page);
});

test('Control+Shift+C copia a seleção do terminal para a área de transferência', async ({
  launchApp,
  gitRepo,
}) => {
  const projectName = basename(gitRepo.path);
  const { app, page } = await launchApp({ dialogPath: gitRepo.path });
  await addProjectAndOpenWorkspace(page, projectName);
  await runHello(page);

  await app.evaluate(({ clipboard }) => clipboard.writeText('antes'));
  // A linha da saída tem só `ola-4` (a do comando digitado traz `ola-$(2+2)`).
  // Duplo clique no começo da linha (o centro dela é vazio, e ali não há palavra para selecionar).
  const row = await page
    .locator('.xterm-rows > div')
    .filter({ hasText: /^ola-4$/ })
    .boundingBox();
  if (row === null) throw new Error('A linha da saída não tem caixa na tela.');
  await page.mouse.dblclick(row.x + 10, row.y + row.height / 2);
  await page.keyboard.press('Control+Shift+C');
  await expect
    .poll(() => app.evaluate(({ clipboard }) => clipboard.readText()), { timeout: 5_000 })
    .toBe('ola-4');
  await endShell(page);
});

test('os painéis e a divisória da raiz voltam iguais depois de fechar e reabrir o app', async ({
  launchApp,
  gitRepo,
}) => {
  const projectName = basename(gitRepo.path);
  const first = await launchApp({ dialogPath: gitRepo.path });
  await addProjectAndOpenWorkspace(first.page, projectName);
  await openShell(first.page);
  await openShell(first.page);
  await expect(shellPanes(first.page)).toHaveCount(2);
  const before = await rootFirstWidth(first.page);

  const separator = first.page.locator('.pane-tree__group > [role="separator"]').first();
  const box = await separator.boundingBox();
  if (box === null) throw new Error('A divisória da raiz não tem caixa na tela.');
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;
  await first.page.mouse.move(x, y);
  await first.page.mouse.down();
  await first.page.mouse.move(x + 120, y, { steps: 8 });
  await first.page.mouse.up();
  await expect
    .poll(async () => (await rootFirstWidth(first.page)).first, { timeout: 5_000 })
    .toBeGreaterThan(before.first + 60);
  const moved = await rootFirstWidth(first.page);
  const movedShare = moved.first / moved.total;
  // O ratio chega ao banco por um pedido assíncrono depois de soltar o mouse.
  await first.page.waitForTimeout(1_000);

  // Os shells terminam (`exit`) sem fechar os painéis: com um shell vivo o processo de terminais não sai
  // por ociosidade e o `app.close()` do Playwright não termina (ver `endShell`). Sem sessão, ele sai em 3 s.
  await exitShell(first.page, 0);
  await exitShell(first.page, 1);
  const startedAt = Date.now();
  await first.close();
  console.log(`[medida] fechamento do app sem sessão viva: ${Date.now() - startedAt} ms`);

  // O processo de terminais do teste encerra em 3 s sem o app: os dois painéis voltam sem sessão, como
  // lançadores vazios, e a barra continua disponível.
  const second = await launchApp();
  await expect(shellPanes(second.page)).toHaveCount(2, { timeout: 30_000 });
  await expect(second.page.getByText('Nenhuma sessão neste painel')).toHaveCount(2);
  await expect(second.page.getByRole('button', { name: 'Iniciar PowerShell' })).toHaveCount(2);
  await expect(second.page.getByRole('toolbar', { name: 'Abrir terminal' })).toBeVisible();
  await expect(
    second.page.getByRole('navigation', { name: 'Workspaces abertos' }).getByRole('link'),
  ).toHaveAttribute('aria-current', 'page');
  const after = await rootFirstWidth(second.page);
  expect(Math.abs(after.first / after.total - movedShare)).toBeLessThan(0.01);

  // Fechar um painel sem sessão não pede confirmação; o último deixa o estado vazio.
  await second.page.getByRole('button', { name: 'Fechar painel', exact: true }).first().click();
  await expect(shellPanes(second.page)).toHaveCount(1);
  await second.page.getByRole('button', { name: 'Fechar painel', exact: true }).click();
  await expect(second.page.getByText('Nenhum terminal aberto')).toBeVisible();
});

test('a barra lateral lista a sessão do workspace e leva de volta ao terminal dela', async ({
  launchApp,
  gitRepo,
}) => {
  const projectName = basename(gitRepo.path);
  const { page } = await launchApp({ dialogPath: gitRepo.path });
  await addProjectAndOpenWorkspace(page, projectName);
  await runHello(page);

  const bar = page.getByRole('complementary', { name: BAR_NAME });
  await bar.getByRole('button', { name: `Sessões de ${projectName}` }).click();
  const session = bar.locator('.sidebar__session').getByRole('button');
  await expect(session).toHaveCount(1);

  // Sai do workspace; clicar na sessão leva ao workspace com o terminal no painel.
  await page
    .getByRole('navigation', { name: 'Principal' })
    .getByRole('link', { name: 'Início' })
    .click();
  await expect(page.locator('.xterm-rows')).toHaveCount(0);
  await session.click();
  await expect(page.locator('.xterm-rows')).toContainText('ola-4', { timeout: 15_000 });
  await endShell(page);
});

test('o workspace não tem fundo topográfico nem violação de CSP', async ({
  launchApp,
  gitRepo,
}) => {
  const projectName = basename(gitRepo.path);
  const { page } = await launchApp({ dialogPath: gitRepo.path });
  const messages: string[] = [];
  page.on('console', (message) => messages.push(`${message.type()}: ${message.text()}`));
  // O estado vazio e a barra também entram na conferência (as mensagens vêm desde o início).
  await addProjectAndOpenWorkspace(page, projectName);
  await runHello(page);
  await openShell(page);
  await openShell(page);
  await expect(shellPanes(page)).toHaveCount(3);

  await expect(page.locator('canvas')).toHaveCount(0);
  // O xterm tenta montar um <style> inline, que a CSP bloqueia; as regras dele estão em app.css. Qualquer
  // outra violação (script, imagem, conexão, a biblioteca de painéis) é falha.
  const csp = messages.filter(
    (text) => text.includes('Content Security Policy') && !text.includes('Applying inline style'),
  );
  expect(csp, csp.slice(0, 3).join(' | ')).toEqual([]);
  await endShell(page);
});

test('a dica de um botão só de ícone aparece ao focar, posiciona-se e não viola a CSP', async ({
  launchApp,
}) => {
  const { page } = await launchApp();
  // O ouvinte entra antes de qualquer script da página (addInitScript + reload), como em security.spec.ts.
  await page.addInitScript(() => {
    const violations: string[] = [];
    Object.assign(window, { cspViolations: violations });
    document.addEventListener('securitypolicyviolation', (event) => {
      violations.push(`${event.violatedDirective} ${event.blockedURI}`);
    });
  });
  await page.reload();
  const add = page.getByRole('button', { name: 'Abrir workspace' });
  await expect(add).toBeVisible();

  // Foco por teclado: Tab até o botão "+".
  for (let step = 0; step < 40; step += 1) {
    if ((await add.evaluate((element) => element === document.activeElement)) === true) break;
    await page.keyboard.press('Tab');
  }
  await expect(add).toBeFocused();

  // A dica visível (a que o Radix posiciona pelo CSSOM) aparece, com o texto e dentro da janela.
  const hint = page.locator('.hint');
  await expect(hint).toBeVisible();
  await expect(hint).toHaveText('Abrir workspace');
  const box = await hint.boundingBox();
  expect(box).not.toBeNull();
  expect(box?.width ?? 0).toBeGreaterThan(0);
  // O nome acessível do botão continua o mesmo; a dica só o descreve.
  await expect(add).toHaveAccessibleName('Abrir workspace');

  // Esc fecha a dica.
  await page.keyboard.press('Escape');
  await expect(hint).toHaveCount(0);

  expect(
    await page.evaluate(() => (window as unknown as { cspViolations: string[] }).cspViolations),
  ).toEqual([]);
});
