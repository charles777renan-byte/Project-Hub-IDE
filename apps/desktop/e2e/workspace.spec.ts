import { writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import type { Locator, Page } from '@playwright/test';
import { expect, test } from './fixtures';
import { addGitProject, openProject, projectLink, sidebarOf, statusBarOf } from './missions';
import { decodePng, pixelAt } from './png';
import {
  expectOpenSessions,
  E2E_HOOK_KEY,
  expectTerminalToContain,
  expectWebglCanvas,
  fecharPainel,
  terminalForeground,
  skipWithoutWebgl2,
  terminalRowBox,
} from './terminals';

// O workspace pela janela do Electron construído: painéis, sessões reais no processo de terminais (PowerShell),
// o xterm, a barra lateral e a CSP real. Só roda no Windows, onde o shell do teste é o PowerShell.
// O terminal desenha em WebGL (canvas): o texto dele é lido do buffer do xterm, por `./terminals`.
test.skip(process.platform !== 'win32', 'o shell do teste é o PowerShell');

/** Painéis do PowerShell abertos no workspace (cada sessão em andamento tem o nome do programa). */
function shellPanes(page: Page): Locator {
  return page.getByRole('region', { name: 'Painel PowerShell' });
}

/** A aba fixa Início, na barra superior. */
const homeTab = (page: Page): Locator => page.getByRole('link', { name: 'Início', exact: true });

/**
 * Cadastra o projeto pelo seletor da barra lateral (a pasta vem de `dialogPath`) e abre a aba do projeto na
 * visão Terminais, a padrão.
 */
async function addProjectAndOpenWorkspace(page: Page, projectName: string): Promise<void> {
  await addGitProject(page, projectName);
  await openProject(page, projectName, 'Terminais');
  // O workspace novo abre vazio, com a barra para abrir terminais.
  await expect(page.getByRole('button', { name: 'Abrir terminal' })).toBeVisible();
  await expect(page.getByText('Nenhum terminal aberto')).toBeVisible();
}

/** Abre mais um painel do PowerShell pela barra e espera o prompt da sessão nova aparecer nele. */
async function openShell(page: Page): Promise<void> {
  const before = await shellPanes(page).count();
  await page.getByRole('button', { name: 'Abrir terminal' }).click();
  await page.getByRole('menuitem', { name: /PowerShell/ }).click();
  await expect(shellPanes(page)).toHaveCount(before + 1);
  await expectTerminalToContain(shellPanes(page).nth(before).locator('.terminal-view'), 'PS ', {
    timeout: 30_000,
  });
}

/** Abre o PowerShell pela barra, digita um comando e espera a saída `ola-4` (o workspace tem só esse painel). */
async function runHello(page: Page): Promise<void> {
  await openShell(page);
  await page.locator('.xterm-helper-textarea').focus();
  await page.keyboard.type('Write-Output "ola-$(2+2)"');
  await page.keyboard.press('Enter');
  await expectTerminalToContain(page.locator('.terminal-view'), 'ola-4');
}

/** Fecha o painel de índice `index` pelo menu ⋯ (shell comum: sem confirmação); o painel some da tela. */
async function closePane(page: Page, index: number): Promise<void> {
  const panes = shellPanes(page);
  const before = await panes.count();
  await fecharPainel(page, 'PowerShell', { indice: index });
  await expect(panes).toHaveCount(before - 1, { timeout: 15_000 });
  await expectOpenSessions(page, before - 1);
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
  // O estado vazio mostra o fundo topográfico animado (o mesmo do Início), só dentro do cartão vazio.
  await expect(page.locator('.workspace__empty canvas')).toHaveCount(1);
  await expect(
    page.getByText('Escolha um programa na barra acima para abrir um terminal.'),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Abrir terminal' }).click();
  for (const label of ['Claude Code', 'Codex']) {
    const open = page.getByRole('menuitem', { name: new RegExp(label) });
    await expect(open).toBeVisible();
    // A disponibilidade depende da máquina: ou o item está habilitado, ou aparece como "Não instalado".
    if ((await open.getAttribute('aria-disabled')) === 'true') {
      await expect(open).toContainText('Não instalado');
    }
  }
  await expect(page.getByRole('menuitem', { name: /PowerShell/ })).toHaveAttribute(
    'aria-disabled',
    'false',
  );
  await page.keyboard.press('Escape');
  await expect(page.getByRole('menu')).toHaveCount(0);
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
  await expect(page.locator('.terminal-view')).toHaveCount(3);

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
    await expectTerminalToContain(panes.nth(index).locator('.terminal-view'), `vivo-${index}-2`);
  }
  await endShell(page);
});

test('fechar um painel na hora encerra a sessão e os outros ocupam o espaço; fechar todos volta ao estado vazio', async ({
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

  const bar = sidebarOf(page);
  await bar.getByRole('button', { name: `Sessões de ${projectName}` }).click();
  // Só o cartão de cada sessão: Abrir e Encerrar aparecem com o mouse sobre o cartão e não contam aqui.
  const sessions = bar.locator('.sidebar__card');
  await expect(sessions).toHaveCount(3);

  // Fechar sai na hora, sem confirmação: o painel some, a sessão dele termina e os dois restantes ficam lado a lado.
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
  await expectTerminalToContain(shellPanes(page).nth(1).locator('.terminal-view'), 'antes-6');

  await page.reload();
  await expect(homeTab(page)).toBeVisible();
  // A aba do workspace continua aberta; se a janela não voltar nela, abre pela aba.
  const tab = page.getByRole('navigation', { name: 'Workspaces abertos' }).getByRole('link');
  await expect(tab).toBeVisible();
  if ((await shellPanes(page).count()) === 0) await tab.click();
  await expect(shellPanes(page)).toHaveCount(3, { timeout: 30_000 });
  await expect(page.locator('.terminal-view')).toHaveCount(3);
  await expectTerminalToContain(shellPanes(page).nth(1).locator('.terminal-view'), 'antes-6');
  // As sessões seguem vivas: o painel responde a um comando novo.
  await shellPanes(page).nth(2).locator('.xterm-helper-textarea').focus();
  await page.keyboard.type('Write-Output "depois-$(4+4)"');
  await page.keyboard.press('Enter');
  await expectTerminalToContain(shellPanes(page).nth(2).locator('.terminal-view'), 'depois-8');
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
  const screen = page.locator('.terminal-view');

  // Vai para o Início e volta pela aba do workspace: o processo não reinicia.
  await homeTab(page).click();
  await expect(page.locator('.terminal-view')).toHaveCount(0);
  await page.getByRole('navigation', { name: 'Workspaces abertos' }).getByRole('link').click();
  await expectTerminalToContain(screen, 'ola-4');

  // Fecha a aba e reabre por "+": a sessão continua com o mesmo texto.
  await page.getByRole('button', { name: `Fechar workspace ${projectName}` }).click();
  await expect(page.getByRole('navigation', { name: 'Workspaces abertos' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Abrir workspace' }).click();
  await page.getByRole('menuitem', { name: projectName }).click();
  await expectTerminalToContain(page.locator('.terminal-view'), 'ola-4');
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
  // A linha da saída tem só `ola-4` (a do comando digitado traz `ola-$(2+2)`). O terminal em WebGL não
  // tem uma div por linha: a posição vem do buffer e da altura da célula.
  // Duplo clique no começo da linha (o centro dela é vazio, e ali não há palavra para selecionar).
  const row = await terminalRowBox(page.locator('.terminal-view'), /^ola-4$/);
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
  await expect(second.page.getByRole('button', { name: 'Abrir terminal' })).toBeVisible();
  await expect(
    second.page.getByRole('navigation', { name: 'Workspaces abertos' }).getByRole('link'),
  ).toHaveAttribute('aria-current', 'page');
  const after = await rootFirstWidth(second.page);
  expect(Math.abs(after.first / after.total - movedShare)).toBeLessThan(0.01);

  // Fechar um painel sem sessão não pede confirmação; o último deixa o estado vazio.
  await fecharPainel(second.page, 'PowerShell');
  await expect(shellPanes(second.page)).toHaveCount(1);
  await fecharPainel(second.page, 'PowerShell');
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

  const bar = sidebarOf(page);
  await bar.getByRole('button', { name: `Sessões de ${projectName}` }).click();
  // O cartão, e não os botões Abrir e Encerrar: o clique no centro do cartão leva ao terminal.
  const session = bar.locator('.sidebar__card');
  await expect(session).toHaveCount(1);

  // Sai do workspace; clicar na sessão leva ao workspace com o terminal no painel.
  await homeTab(page).click();
  await expect(page.locator('.terminal-view')).toHaveCount(0);
  await session.click();
  await expectTerminalToContain(page.locator('.terminal-view'), 'ola-4');
  await endShell(page);
});

test('a barra de status diz qual terminal tem o teclado e a parte Foco some ao focar a barra lateral', async ({
  launchApp,
  gitRepo,
}) => {
  const projectName = basename(gitRepo.path);
  const { page } = await launchApp({ dialogPath: gitRepo.path });
  await addProjectAndOpenWorkspace(page, projectName);
  await openShell(page);

  const status = statusBarOf(page);
  const focus = status.getByText(/^Foco: .+ · Ctrl\+Shift\+Tab sai do terminal$/);
  // Clicar no terminal leva o teclado a ele: a barra diz qual é e como sair.
  await shellPanes(page).first().locator('.terminal-view').click();
  await expect(focus).toBeVisible();
  // O painel com o teclado ganha a tinta de lima no cabeçalho (o fundo deixa de ser o do cartão).
  const head = shellPanes(page).first().locator('.pane__head--live');
  const background = () => head.evaluate((element) => getComputedStyle(element).backgroundColor);
  const tinted = await background();

  // Ctrl+Shift+Tab sai do terminal para o cartão: o painel segue com o teclado (Foco e tinta ficam), mas a dica de
  // sair some, já que a pessoa acabou de sair.
  const title = (await shellPanes(page).first().locator('.pane__title').textContent()) ?? '';
  await page.keyboard.press('Control+Shift+Tab');
  await expect(status.getByText(`Foco: ${title}`, { exact: true })).toBeVisible();
  await expect(focus).toHaveCount(0);
  expect(await background()).toBe(tinted);

  // Focar a barra lateral tira o teclado do terminal: a parte Foco some, e a tinta também.
  await projectLink(page, projectName).focus();
  await expect(focus).toHaveCount(0);
  await expect(status.getByText(/Foco:/)).toHaveCount(0);
  expect(await background()).not.toBe(tinted);

  // Voltar ao terminal traz o Foco de volta.
  await shellPanes(page).first().locator('.terminal-view').click();
  await expect(focus).toBeVisible();
  await endShell(page);
});

test('o workspace com painéis não tem fundo topográfico nem violação de CSP', async ({
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

  // O fundo topográfico (canvas) não existe no workspace. O único canvas permitido é o do renderizador WebGL
  // do xterm, dentro do terminal.
  expect(
    await page.evaluate(
      () =>
        [...document.querySelectorAll('canvas')].filter((c) => c.closest('.terminal-view') === null)
          .length,
    ),
  ).toBe(0);
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

const ESC = '\u001b';
const ORANGE = `${ESC}[38;2;215;119;87m`;
const GRAY = `${ESC}[38;2;153;153;153m`;
/**
 * Amostra do cabeçalho de um agente de linha de comando: um mascote de blocos e meios-blocos em laranja de
 * 24 bits, com o corpo sobre fundo preto, e o texto ao lado em cinza de 24 bits.
 */
const LOGO_SAMPLE =
  [
    `${ORANGE} ▐${ESC}[48;2;0;0;0m▛███▛█${ESC}[m   ${ESC}[1mClaude Code${ESC}[22m ${GRAY}v2.1.310`,
    `${ORANGE}▝▜${ESC}[48;2;0;0;0m█████${ESC}[49m█▀  ${GRAY}Haiku 5.5 with xhigh effort · Claude Pro`,
    `${ORANGE} ▝▝   ▝▝   ${GRAY}~\\OneDrive\\Documentos\\Project Hub${ESC}[m`,
  ].join('\r\n') + '\r\n';

test('o terminal desenha o mascote em blocos contínuos, com as cores de 24 bits, e sem violação de CSP', async ({
  launchApp,
  gitRepo,
  dataDir,
}, testInfo) => {
  const projectName = basename(gitRepo.path);
  const { page } = await launchApp({ dialogPath: gitRepo.path });
  // Sem WebGL na página (máquina sem GPU) o xterm segue no DOM, que não desenha blocos nem aplica a cor pela CSP:
  // o teste pula, antes de abrir shell. Com WebGL na página e sem canvas no terminal, ele falha.
  await skipWithoutWebgl2(page);
  const messages: string[] = [];
  page.on('console', (message) => messages.push(`${message.type()}: ${message.text()}`));
  await addProjectAndOpenWorkspace(page, projectName);
  await openShell(page);
  const view = page.locator('.terminal-view');
  const violations = () =>
    messages.filter((text) => text.includes('Content Security Policy')).length;
  const violationsBefore = violations();

  // O PowerShell imprime a amostra por um arquivo: os bytes chegam ao xterm pelo pty de verdade (ConPTY).
  const sample = join(dataDir, 'amostra.ansi');
  writeFileSync(sample, LOGO_SAMPLE, 'utf8');
  await page.locator('.xterm-helper-textarea').focus();
  await page.keyboard.type(
    `[Console]::OutputEncoding=[Text.Encoding]::UTF8; [Console]::Write([IO.File]::ReadAllText('${sample.replaceAll("'", "''")}', [Text.Encoding]::UTF8))`,
  );
  await page.keyboard.press('Enter');
  await expectTerminalToContain(view, 'Haiku 5.5 with xhigh effort');

  // As cores chegam ao buffer do xterm em 24 bits (o ConPTY não as rebaixa), qualquer que seja o renderizador.
  expect(await terminalForeground(view, '▛')).toEqual({ rgb: true, color: 0xd77757 });
  expect(await terminalForeground(view, '·')).toEqual({ rgb: true, color: 0x999999 });

  await expectWebglCanvas(view);
  expect(await view.locator('.xterm-rows').count()).toBe(0);

  // O mascote: as colunas 3 a 5 das duas primeiras linhas são blocos cheios, então a região é laranja de ponta
  // a ponta, sem buraco entre as linhas nem entre as colunas. A coluna 0 da primeira linha é vazia (controle).
  const top = await terminalRowBox(view, /▐▛███▛█/);
  if (top === null) throw new Error('A linha do mascote não está na tela.');
  const margin = 2;
  const solid = decodePng(
    await page.screenshot({
      clip: {
        x: top.x + top.cellWidth * 3 + margin,
        y: top.y + margin,
        width: top.cellWidth * 3 - margin * 2,
        height: top.height * 2 - margin * 2,
      },
    }),
  );
  const empty = decodePng(
    await page.screenshot({
      clip: {
        x: top.x + margin,
        y: top.y + margin,
        width: top.cellWidth - margin * 2,
        height: top.height - margin * 2,
      },
    }),
  );
  const isOrange = (pixels: ReturnType<typeof decodePng>, x: number, y: number) => {
    const [r, g, b] = pixelAt(pixels, x, y);
    return Math.abs(r - 215) <= 12 && Math.abs(g - 119) <= 12 && Math.abs(b - 87) <= 12;
  };
  let notOrange = 0;
  for (let y = 0; y < solid.height; y += 1) {
    for (let x = 0; x < solid.width; x += 1) if (!isOrange(solid, x, y)) notOrange += 1;
  }
  let orangeInEmpty = 0;
  for (let y = 0; y < empty.height; y += 1) {
    for (let x = 0; x < empty.width; x += 1) if (isOrange(empty, x, y)) orangeInEmpty += 1;
  }
  expect(solid.width * solid.height).toBeGreaterThan(100);
  expect(notOrange, 'pixels fora do laranja na região dos blocos cheios').toBe(0);
  expect(orangeInEmpty, 'pixels laranja numa célula vazia').toBe(0);

  const picture = testInfo.outputPath('terminal-logo.png');
  await shellPanes(page).first().screenshot({ path: picture });
  await testInfo.attach('terminal-logo', { path: picture, contentType: 'image/png' });

  // Com WebGL a cor não passa por atributo de estilo: imprimir o logo não gera nenhuma recusa nova da CSP. (No DOM
  // cada trecho colorido gera uma.)
  console.log(`[medida] recusas da CSP: ${violationsBefore} antes do logo, ${violations()} depois`);
  expect(violations()).toBe(violationsBefore);
  await endShell(page);
});

test('sem o gancho de teste o app não expõe o terminal: nada no window nem na API do preload', async ({
  launchApp,
  gitRepo,
}) => {
  const projectName = basename(gitRepo.path);
  const { page } = await launchApp({ dialogPath: gitRepo.path, terminalHook: false });
  await addProjectAndOpenWorkspace(page, projectName);
  await page.getByRole('button', { name: 'Abrir terminal' }).click();
  await page.getByRole('menuitem', { name: /PowerShell/ }).click();
  await expect(shellPanes(page)).toHaveCount(1);
  await expect(shellPanes(page).first().locator('.xterm-helper-textarea')).toBeAttached();

  const exposed = await page.evaluate((key) => {
    const api = (window as unknown as { projectHub: Record<string, object> }).projectHub;
    return {
      hook: key in window,
      windowNames: Object.getOwnPropertyNames(window).filter((name) => /e2e/i.test(name)),
      apiNames: Object.entries(api).flatMap(([group, methods]) => [group, ...Object.keys(methods)]),
    };
  }, E2E_HOOK_KEY);
  expect(exposed.hook).toBe(false);
  expect(exposed.windowNames).toEqual([]);
  expect(exposed.apiNames.filter((name) => /e2e|hook/i.test(name))).toEqual([]);
  await endShell(page);
});

/**
 * Mensagens que acusam contexto WebGL perdido: o aviso do Chromium quando passa do limite de contextos vivos
 * ("Too many active WebGL contexts") e as do xterm quando o contexto some e não volta.
 */
const WEBGL_LOSS =
  /Too many active WebGL contexts|webglcontextlost|webgl context not restored|CONTEXT_LOST_WEBGL|lost context/i;

test('remontar os terminais dezenas de vezes libera cada contexto WebGL e os painéis seguem em WebGL', async ({
  launchApp,
  gitRepo,
}) => {
  test.setTimeout(240_000);
  const projectName = basename(gitRepo.path);
  const { page } = await launchApp({ dialogPath: gitRepo.path });
  // O ouvinte entra antes de qualquer montagem, para nenhuma mensagem escapar.
  const messages: string[] = [];
  page.on('console', (message) => messages.push(`${message.type()}: ${message.text()}`));
  // O teste guarda cada contexto WebGL que a página cria. Segurar as referências tira o coletor de lixo de cena:
  // o contexto de um terminal descartado só deixa de contar se o app o liberar de propósito, e o resultado não
  // depende de quando o Chromium coletaria o lixo.
  await page.addInitScript(() => {
    const contexts = new Set<WebGL2RenderingContext>();
    Object.assign(window, { webglContexts: contexts });
    const original = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (
      this: HTMLCanvasElement,
      ...args: Parameters<typeof original>
    ) {
      const context = original.apply(this, args);
      if (args[0] === 'webgl2' && context !== null) contexts.add(context as WebGL2RenderingContext);
      return context;
    } as typeof original;
  });
  await page.reload();
  await expect(homeTab(page)).toBeVisible();
  await skipWithoutWebgl2(page);
  /** Contextos WebGL criados pela página e quantos deles seguem vivos (não perdidos). */
  const contexts = () =>
    page.evaluate(() => {
      const all = [
        ...(window as unknown as { webglContexts: Set<WebGL2RenderingContext> }).webglContexts,
      ];
      return { created: all.length, alive: all.filter((gl) => !gl.isContextLost()).length };
    });

  await addProjectAndOpenWorkspace(page, projectName);
  await openShell(page);
  await openShell(page);
  const views = page.locator('.terminal-view');
  await expect(views).toHaveCount(2);
  await expectWebglCanvas(views);

  // Sair do workspace e voltar remonta cada TerminalView (dois por rodada), sem processo novo. A rota muda pelo
  // hash, o mesmo caminho do app, sem pausa além de esperar o desmonte e a montagem acontecerem: cada rodada tem
  // de montar mesmo os dois terminais (o React não junta rodadas), e é isso que a contagem de contextos confere.
  const rounds = 40;
  await page.evaluate(
    async ({ count, panes }) => {
      const workspace = location.hash;
      const waitForViews = (expected: number) =>
        new Promise<void>((resolve, reject) => {
          const started = performance.now();
          const check = () => {
            if (document.querySelectorAll('.terminal-view').length === expected) resolve();
            else if (performance.now() - started > 10_000) {
              reject(new Error(`esperava ${expected} terminais na tela`));
            } else requestAnimationFrame(check);
          };
          check();
        });
      for (let round = 0; round < count; round += 1) {
        location.hash = '#/';
        await waitForViews(0);
        location.hash = workspace;
        await waitForViews(panes);
      }
    },
    { count: rounds, panes: 2 },
  );
  await expect(views).toHaveCount(2);
  // Mudança estrutural (abrir e fechar painel) também remonta todos os painéis, pelo caminho real do app.
  for (let cycle = 0; cycle < 2; cycle += 1) {
    await openShell(page);
    await expect(views).toHaveCount(3);
    await closePane(page, 2);
    await expect(views).toHaveCount(2);
  }

  // Com dois terminais na tela, só os contextos deles estão vivos: os de todas as montagens anteriores foram
  // liberados pelo app (sem isso passariam de 16 e o Chromium perderia o mais antigo).
  const now = await contexts();
  console.log(`[medida] contextos WebGL criados e vivos: ${JSON.stringify(now)}`);
  // A guarda de que o teste montou o que disse, medida na página: cada rodada monta dois terminais e cada terminal
  // cria um contexto, então só as rodadas já dão 80, muito além do limite de 16.
  expect(now.created).toBeGreaterThanOrEqual(rounds * 2);
  expect.soft(now.alive, 'contextos WebGL vivos com dois terminais na tela').toBeLessThanOrEqual(2);

  // Fora do workspace nenhum terminal está montado, e nenhum contexto segue vivo.
  await homeTab(page).click();
  await expect(views).toHaveCount(0);
  expect
    .soft((await contexts()).alive, 'contextos WebGL vivos sem nenhum terminal na tela')
    .toBe(0);
  await page.getByRole('navigation', { name: 'Workspaces abertos' }).getByRole('link').click();
  await expect(views).toHaveCount(2);

  // Pré-condição, não prova do vazamento: os painéis que sobraram desenham em WebGL (sem isso, "vivos <= 2"
  // valeria por vazio) e seguem com a sessão. Os painéis vivos são sempre os contextos mais novos, então esta
  // checagem passa também sem a correção; quem acusa o vazamento são as contagens acima e o aviso do Chromium.
  for (let index = 0; index < 2; index += 1) {
    const view = views.nth(index);
    await expect(view.locator('canvas').first()).toBeAttached();
    await expectTerminalToContain(view, 'PS ');
  }
  const loss = messages.filter((text) => WEBGL_LOSS.test(text));
  // O soltar de propósito (loseContext) não deve gerar nenhuma mensagem de contexto no console.
  const related = messages.filter((text) => /webgl|context/i.test(text));
  console.log(`[medida] mensagens de contexto no console: ${JSON.stringify(related)}`);
  expect.soft(loss).toEqual([]);
  await endShell(page);
});

test('se o contexto WebGL se perde, o terminal volta ao DOM, ajusta as colunas à célula do DOM e segue vivo', async ({
  launchApp,
  gitRepo,
}) => {
  test.setTimeout(120_000);
  const projectName = basename(gitRepo.path);
  const { page } = await launchApp({ dialogPath: gitRepo.path });
  await skipWithoutWebgl2(page);
  const messages: string[] = [];
  page.on('console', (message) => messages.push(`${message.type()}: ${message.text()}`));
  await addProjectAndOpenWorkspace(page, projectName);
  await openShell(page);
  const view = page.locator('.terminal-view');
  await expectWebglCanvas(view);

  /** Colunas do xterm, largura da área e largura da tela dele (a das células). */
  const geometry = () =>
    view.evaluate((host, key) => {
      const hook = (
        window as unknown as Record<string, { terminals: Map<Element, { cols: number }> }>
      )[key];
      const term = hook?.terminals.get(host);
      const screen = host.querySelector<HTMLElement>('.xterm-screen');
      if (term === undefined || screen === null) throw new Error('terminal sem tela');
      return { cols: term.cols, host: host.clientWidth, screen: screen.clientWidth };
    }, E2E_HOOK_KEY);
  const withWebgl = await geometry();

  // Perde o contexto como o Chromium faria. O xterm espera uns 3 s por uma restauração e então avisa o app.
  await view.evaluate(() => {
    const canvas = document.querySelector<HTMLCanvasElement>(
      '.terminal-view canvas:not(.xterm-link-layer)',
    );
    canvas?.getContext('webgl2')?.getExtension('WEBGL_lose_context')?.loseContext();
  });
  await expect(view.locator('.xterm-rows')).toHaveCount(1, { timeout: 20_000 });
  expect(await view.locator('canvas').count()).toBe(0);

  // A célula do DOM (7,8px) é mais estreita que a do WebGL (8px): as colunas aumentam e a tela volta a preencher a
  // área, sem sobrar uma faixa de mais de uma célula à direita.
  await expect.poll(async () => (await geometry()).cols).toBeGreaterThan(withWebgl.cols);
  const withDom = await geometry();
  expect(withDom.host - withDom.screen, 'faixa vazia à direita do terminal, em px').toBeLessThan(8);

  // O processo foi avisado do tamanho novo e o terminal segue funcionando.
  await page.locator('.xterm-helper-textarea').focus();
  await page.keyboard.type('Write-Output "largura-$([Console]::WindowWidth)"');
  await page.keyboard.press('Enter');
  await expectTerminalToContain(view, `largura-${withDom.cols}`);
  expect(messages.some((text) => text.includes('webgl context not restored'))).toBe(true);
  await endShell(page);
});

test('abrir muitos painéis em sequência não gera o aviso "Too many active WebGL contexts" do Chromium', async ({
  launchApp,
  gitRepo,
}) => {
  test.setTimeout(300_000);
  const projectName = basename(gitRepo.path);
  const { page } = await launchApp({ dialogPath: gitRepo.path });
  await skipWithoutWebgl2(page);
  const messages: string[] = [];
  page.on('console', (message) => messages.push(`${message.type()}: ${message.text()}`));
  await addProjectAndOpenWorkspace(page, projectName);
  // Cada painel aberto remonta os anteriores que seguem na grade. Sem soltar os contextos, ao abrir o décimo estariam
  // vivos os antigos e os novos (mais que o limite de 16 do Chromium), sem nenhum teste segurando referência: o GC
  // natural não recolhe os antigos dentro da mesma remontagem. A grade responsiva só mostra o que cabe (ao menos 340 x
  // 260 px por terminal); os outros ficam como fichas em "Fora da grade", sem terminal montado. Cada abertura remonta
  // só os mostrados, e as trocas de quem aparece (a ficha vira painel, outro vira ficha) também soltam contextos.
  const total = 10;
  const onGrid = shellPanes(page);
  const offGrid = page
    .getByRole('group', { name: 'Terminais fora da grade' })
    .locator('.off-grid__chip');
  for (let index = 0; index < total; index += 1) {
    await page.getByRole('button', { name: 'Abrir terminal' }).click();
    await page.getByRole('menuitem', { name: /PowerShell/ }).click();
    await expect
      .poll(async () => (await onGrid.count()) + (await offGrid.count()), { timeout: 30_000 })
      .toBe(index + 1);
    await expectOpenSessions(page, index + 1);
  }
  const views = page.locator('.terminal-view');
  const shown = await onGrid.count();
  expect(shown, 'a grade mostra alguns painéis e deixa os outros como fichas').toBeLessThan(total);
  expect(await offGrid.count()).toBe(total - shown);
  await expect(views).toHaveCount(shown);
  await expectWebglCanvas(views);
  // Um contexto perdido só devolve o painel ao DOM depois de o xterm esperar 3 s por uma restauração.
  await page.waitForTimeout(4_000);

  // Guarda extra: nenhum painel caiu para o DOM. Ela passa também sem a correção (os contextos
  // perdidos eram os de painéis já descartados), então não é ela que reprova o teste.
  for (let index = 0; index < shown; index += 1) {
    const view = views.nth(index);
    await expect(view.locator('canvas').first()).toBeAttached();
    expect(await view.locator('.xterm-rows').count(), `painel ${index} caiu para o DOM`).toBe(0);
  }
  // A asserção que reprova sem a correção: o Chromium avisa quando passa de 16 contextos vivos.
  const loss = messages.filter((text) => WEBGL_LOSS.test(text));
  console.log(`[medida] ${total} painéis, ${shown} na grade, avisos de contexto: ${loss.length}`);
  expect(loss, 'avisos de contexto WebGL perdido ou em excesso').toEqual([]);
  // Fechar um painel traz a primeira ficha para a grade: o laço fecha o primeiro painel até não sobrar sessão.
  for (let left = total; left > 0; left -= 1) {
    await fecharPainel(page, 'PowerShell');
    await expectOpenSessions(page, left - 1);
  }
  await expect(page.getByText('Nenhum terminal aberto')).toBeVisible({ timeout: 15_000 });
});
