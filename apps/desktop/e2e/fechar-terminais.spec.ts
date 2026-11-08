import { basename } from 'node:path';
import type { Locator, Page } from '@playwright/test';
import { expect, test } from './fixtures';
import { addGitProject, openProject, viewTab } from './missions';
import { expectOpenSessions, expectTerminalToContain } from './terminals';

// "Fechar todos os terminais" (menu Mais ações do projeto) e a preferência de perguntar antes de fechar um terminal
// com agente rodando (Configurações), pela janela do Electron construído, com sessões reais do PowerShell. Só roda no
// Windows, onde o shell do teste é o PowerShell.
//
// Não há aqui o teste da caixa "Não perguntar de novo" num painel de agente: ela só aparece em painel de Claude Code,
// Codex etc. com a sessão rodando, e esses painéis executam o CLI real da máquina (resolvido pelo PATH). O CLI falso
// dos E2E (`fixtures/fake-claude-agent.mjs`, `agentScript` do `launchApp`) só toma o lugar do `claude` das missões, e a
// sessão de missão fecha sem pergunta. Executar o `claude` ou o `codex` reais gastaria a cota de quem roda a suíte.
// A caixa fica coberta pelos testes de componente (PaneView.test.tsx, close-confirm.test.ts).
test.skip(process.platform !== 'win32', 'o shell do teste é o PowerShell');

/** Painéis do PowerShell abertos no workspace. */
function shellPanes(page: Page): Locator {
  return page.getByRole('region', { name: 'Painel PowerShell' });
}

/** Cadastra o projeto e abre a aba dele na visão Terminais, ainda vazia. */
async function addProjectAndOpenWorkspace(page: Page, projectName: string): Promise<void> {
  await addGitProject(page, projectName);
  await openProject(page, projectName, 'Terminais');
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

/** O "Mais ações" do cabeçalho do projeto (os painéis têm o deles, "Mais ações do painel"). */
function projectMoreActions(page: Page): Locator {
  return page.getByRole('button', { name: 'Mais ações', exact: true });
}

/** O item "Fechar todos os terminais…" do menu do cabeçalho. */
function closeAllItem(page: Page): Locator {
  return page.getByRole('menuitem', { name: 'Fechar todos os terminais…', exact: true });
}

/** Abre o menu Mais ações do projeto e escolhe "Fechar todos os terminais…". */
async function askToCloseAll(page: Page): Promise<void> {
  await projectMoreActions(page).click();
  await closeAllItem(page).click();
}

/** A faixa de pergunta do workspace, achada pelo texto da pergunta (que é também o nome do grupo). */
function closeAllQuestion(page: Page, question: string): Locator {
  return page.locator('.workspace__confirm').getByRole('group', { name: question, exact: true });
}

/** Mensagens do console que acusam violação da CSP (o <style> inline do xterm, que o app já contorna, não conta). */
function cspViolations(messages: string[]): string[] {
  return messages.filter(
    (text) => text.includes('Content Security Policy') && !text.includes('Applying inline style'),
  );
}

test('fechar todos: a faixa pergunta com a contagem, Voltar mantém os painéis e confirmar encerra tudo', async ({
  launchApp,
  gitRepo,
}) => {
  const projectName = basename(gitRepo.path);
  const { page } = await launchApp({ dialogPath: gitRepo.path });
  const messages: string[] = [];
  page.on('console', (message) => messages.push(`${message.type()}: ${message.text()}`));
  await addProjectAndOpenWorkspace(page, projectName);

  // Sem painel nenhum, o item existe no menu mas está desabilitado.
  await projectMoreActions(page).click();
  await expect(closeAllItem(page)).toHaveAttribute('aria-disabled', 'true');
  await page.keyboard.press('Escape');
  await expect(page.getByRole('menu')).toHaveCount(0);

  await openShell(page);
  await openShell(page);
  await openShell(page);
  const panes = shellPanes(page);
  await expect(panes).toHaveCount(3);
  await expectOpenSessions(page, 3);

  const question = closeAllQuestion(page, 'Fechar os 3 painéis? 3 sessões serão encerradas.');
  const confirm = page.locator('.workspace__confirm');
  await expect(confirm).toHaveCount(0);

  // Mais ações → Fechar todos os terminais…: a pergunta aparece na faixa do workspace, com a contagem certa.
  await askToCloseAll(page);
  await expect(question).toBeVisible();
  await expect(confirm.getByText('Fechar os 3 painéis? 3 sessões serão encerradas.')).toBeVisible();
  // O foco vai ao "Voltar", a saída segura.
  await expect(question.getByRole('button', { name: 'Voltar', exact: true })).toBeFocused();

  // Voltar: a faixa some e os três painéis seguem, com as sessões vivas.
  await question.getByRole('button', { name: 'Voltar', exact: true }).click();
  await expect(confirm).toHaveCount(0);
  await expect(panes).toHaveCount(3);
  await expectOpenSessions(page, 3);

  // De novo, e agora confirma: os painéis saem, o workspace volta ao estado vazio e nenhuma sessão fica aberta.
  await askToCloseAll(page);
  await expect(question).toBeVisible();
  await question.getByRole('button', { name: 'Fechar todos', exact: true }).click();
  await expect(page.getByText('Nenhum terminal aberto')).toBeVisible({ timeout: 15_000 });
  await expect(page.getByRole('region', { name: /^Painel / })).toHaveCount(0);
  await expect(confirm).toHaveCount(0);
  await expectOpenSessions(page, 0);

  // Sem painel de novo, o item volta a ficar desabilitado.
  await projectMoreActions(page).click();
  await expect(closeAllItem(page)).toHaveAttribute('aria-disabled', 'true');
  await page.keyboard.press('Escape');

  // Nenhuma violação de CSP no estado vazio, na pergunta e no fechamento (as mensagens vêm desde o início).
  const csp = cspViolations(messages);
  expect(csp, csp.slice(0, 3).join(' | ')).toEqual([]);
});

test('Configurações: a preferência de perguntar antes de fechar fica depois de recarregar, e fechar todos pergunta mesmo com ela desligada', async ({
  launchApp,
  gitRepo,
}) => {
  const projectName = basename(gitRepo.path);
  const { page } = await launchApp({ dialogPath: gitRepo.path });
  const messages: string[] = [];
  page.on('console', (message) => messages.push(`${message.type()}: ${message.text()}`));
  await addProjectAndOpenWorkspace(page, projectName);

  const storedValue = () =>
    page.evaluate(() => window.localStorage.getItem('project-hub:perguntar-ao-fechar-terminal'));
  const preference = page.getByRole('checkbox', {
    name: 'Perguntar antes de fechar um terminal com agente rodando',
  });

  // O padrão é perguntar: a caixa vem marcada e nada foi guardado.
  await viewTab(page, 'Configurações').click();
  await expect(viewTab(page, 'Configurações')).toHaveAttribute('aria-selected', 'true');
  await expect(preference).toBeChecked();
  expect(await storedValue()).toBeNull();

  // Desmarcar guarda `false` e a caixa fica desmarcada.
  await preference.uncheck();
  await expect(preference).not.toBeChecked();
  expect(await storedValue()).toBe('false');

  // Recarregar a janela mantém a escolha (volta pela aba do projeto, se a janela não abrir nela).
  await page.reload();
  await expect(page.getByRole('heading', { level: 1, name: projectName })).toBeVisible();
  if ((await viewTab(page, 'Configurações').count()) === 0) {
    await page.getByRole('navigation', { name: 'Workspaces abertos' }).getByRole('link').click();
  }
  await viewTab(page, 'Configurações').click();
  await expect(viewTab(page, 'Configurações')).toHaveAttribute('aria-selected', 'true');
  await expect(preference).not.toBeChecked();
  expect(await storedValue()).toBe('false');

  // Com a pergunta de fechar um terminal desligada, "Fechar todos" ainda pergunta (é a ação em massa).
  await viewTab(page, 'Terminais').click();
  await expect(viewTab(page, 'Terminais')).toHaveAttribute('aria-selected', 'true');
  await openShell(page);
  await askToCloseAll(page);
  const question = closeAllQuestion(page, 'Fechar o painel? 1 sessão será encerrada.');
  await expect(question).toBeVisible();
  await expect(shellPanes(page)).toHaveCount(1);
  await question.getByRole('button', { name: 'Fechar todos', exact: true }).click();
  await expect(page.getByText('Nenhum terminal aberto')).toBeVisible({ timeout: 15_000 });
  await expectOpenSessions(page, 0);

  // Marcar de novo volta a perguntar: o valor guardado deixa de ser `false`.
  await viewTab(page, 'Configurações').click();
  await preference.check();
  await expect(preference).toBeChecked();
  expect(await storedValue()).toBe('true');

  const csp = cspViolations(messages);
  expect(csp, csp.slice(0, 3).join(' | ')).toEqual([]);
});
