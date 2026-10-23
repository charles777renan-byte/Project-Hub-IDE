import { basename } from 'node:path';
import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';

// O workspace pela janela do Electron construído: painéis, sessões reais no processo de terminais (PowerShell),
// o xterm, a barra lateral e a CSP real. Só roda no Windows, onde o shell do teste é o PowerShell.
test.skip(process.platform !== 'win32', 'o shell do teste é o PowerShell');

const BAR_NAME = 'Projetos e missões';

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
  await expect(page.getByRole('button', { name: 'Iniciar PowerShell' })).toBeVisible();
}

/** Inicia o PowerShell no painel dele, digita um comando e espera a saída `ola-4`. */
async function runHello(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Iniciar PowerShell' }).click();
  const screen = page.locator('.xterm-rows');
  await expect(screen).toContainText('PS ', { timeout: 30_000 });
  await page.locator('.xterm-helper-textarea').focus();
  await page.keyboard.type('Write-Output "ola-$(2+2)"');
  await page.keyboard.press('Enter');
  await expect(screen).toContainText('ola-4', { timeout: 15_000 });
}

/**
 * Encerra o shell do painel e espera o painel voltar ao lançador. Todo teste que inicia um shell termina
 * assim: o processo de terminais só sai por ociosidade (3 s) quando não há sessão viva, e com um shell vivo
 * ele segue de pé depois do app e segura a pasta do repositório e o fechamento do app pelo Playwright.
 */
async function endShell(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Encerrar', exact: true }).click();
  await page
    .getByRole('group', { name: /^Encerrar a sessão/ })
    .getByRole('button', { name: 'Encerrar', exact: true })
    .click();
  await expect(page.getByRole('button', { name: 'Iniciar PowerShell' })).toBeVisible({
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

test('o workspace mostra três painéis com os lançadores', async ({ launchApp, gitRepo }) => {
  const projectName = basename(gitRepo.path);
  const { page } = await launchApp({ dialogPath: gitRepo.path });
  await addProjectAndOpenWorkspace(page, projectName);

  await expect(page.getByRole('region', { name: /^Painel / })).toHaveCount(3);
  for (const label of ['Claude Code', 'Codex']) {
    const panel = page.getByRole('region', { name: `Painel ${label}` });
    // A disponibilidade depende da máquina: ou o botão está habilitado, ou o motivo aparece.
    const start = panel.getByRole('button', { name: `Iniciar ${label}` });
    await expect(start).toBeVisible();
    if (!(await start.isEnabled())) {
      await expect(panel.getByText('não foi encontrado no PATH')).toBeVisible();
    }
  }
  await expect(page.getByRole('button', { name: 'Iniciar PowerShell' })).toBeEnabled();
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
  await expect(page.getByRole('button', { name: 'Iniciar PowerShell' })).toHaveCount(0);
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

test('a divisória da raiz e a aba abertas voltam iguais depois de fechar e reabrir o app', async ({
  launchApp,
  gitRepo,
}) => {
  const projectName = basename(gitRepo.path);
  const first = await launchApp({ dialogPath: gitRepo.path });
  await addProjectAndOpenWorkspace(first.page, projectName);
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

  // O shell é iniciado e encerrado antes de fechar: com um shell vivo o processo de terminais não sai por
  // ociosidade e o `app.close()` do Playwright não termina (ver `endShell`). Sem sessão, ele sai em 3 s.
  await first.page.getByRole('button', { name: 'Iniciar PowerShell' }).click();
  await expect(first.page.locator('.xterm-rows')).toContainText('PS ', { timeout: 30_000 });
  await endShell(first.page);
  const startedAt = Date.now();
  await first.close();
  console.log(`[medida] fechamento do app sem sessão viva: ${Date.now() - startedAt} ms`);

  // O processo de terminais do teste encerra em 3 s sem o app; a sessão volta como painel vazio.
  const second = await launchApp();
  await expect(second.page.getByRole('region', { name: /^Painel / })).toHaveCount(3, {
    timeout: 30_000,
  });
  await expect(second.page.getByRole('button', { name: 'Iniciar PowerShell' })).toBeVisible();
  await expect(
    second.page.getByRole('navigation', { name: 'Workspaces abertos' }).getByRole('link'),
  ).toHaveAttribute('aria-current', 'page');
  const after = await rootFirstWidth(second.page);
  expect(Math.abs(after.first / after.total - movedShare)).toBeLessThan(0.01);
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
  await addProjectAndOpenWorkspace(page, projectName);
  await runHello(page);

  await expect(page.locator('canvas')).toHaveCount(0);
  // O xterm tenta montar um <style> inline, que a CSP bloqueia; as regras dele estão em app.css. Qualquer
  // outra violação (script, imagem, conexão, a biblioteca de painéis) é falha.
  const csp = messages.filter(
    (text) => text.includes('Content Security Policy') && !text.includes('Applying inline style'),
  );
  expect(csp, csp.slice(0, 3).join(' | ')).toEqual([]);
  await endShell(page);
});
