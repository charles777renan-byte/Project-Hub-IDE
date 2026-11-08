import { basename } from 'node:path';
import { expect, test } from './fixtures';
import { expectNoViolations, watchCsp } from './git-fixtures';
import { addGitProject, openProject } from './missions';
import { PAYLOAD, seedSessions } from './sessoes-fixtures';

// A aba Sessões do painel direito na janela real, com sessões de Claude Code, Codex e Antigravity semeadas nas pastas
// de teste (`sessoes-fixtures.ts`). A faixa conta os três programas e o arquivo ilegível, a busca acha uma sessão, o
// detalhe mostra prompt e turnos, o Antigravity não oferece retomada (e diz por quê), um texto com HTML aparece como
// texto, e a CSP segue sem violação. Retomar não é clicado aqui: abriria um terminal com o programa de verdade. Essa
// ponte está coberta pelos testes do canal e do workspace.

test('aba Sessões: faixa dos três programas, busca, detalhe, retomada desligada e texto como texto', async ({
  launchApp,
  gitRepo,
  claudeConfigDir,
  codexHome,
  antigravityHistory,
}) => {
  const projectName = basename(gitRepo.path);
  const { page } = await launchApp({ dialogPath: gitRepo.path });
  const consoleCsp = await watchCsp(page);
  await addGitProject(page, projectName);
  seedSessions({ projectPath: gitRepo.path, claudeConfigDir, codexHome, antigravityHistory });
  await openProject(page, projectName, 'Terminais');

  const panel = page.getByRole('complementary', { name: 'Painel direito' });
  await panel.getByRole('tab', { name: 'Sessões' }).click();
  const tab = panel.locator('.sessions-tab');

  // A faixa: cinco arquivos lidos no total, por programa, e o ilegível do Codex.
  await expect(tab.getByText('Verificação concluída · 5 arquivos')).toBeVisible({
    timeout: 15_000,
  });
  await expect(tab.getByText('Claude Code · 2 de 2')).toBeVisible();
  await expect(tab.getByText('Codex · 1 de 2')).toBeVisible();
  await expect(tab.getByText('Antigravity CLI · 1 de 1')).toBeVisible();
  await expect(tab.getByText('1 ilegível')).toBeVisible();
  await expect(tab.getByText('5 sessões')).toBeVisible();

  // Busca: "login" acha só a sessão do Claude com o subagente, e o cartão conta o subagente.
  const busca = tab.getByRole('searchbox', { name: 'Buscar sessões' });
  await busca.fill('login');
  await expect(tab.getByText('1 de 5 sessões')).toBeVisible();
  const claudeA = tab.getByRole('button', { name: /Corrige o login com Google/ });
  await expect(claudeA).toContainText('1 subagente');
  await claudeA.click();

  // Detalhe do Claude com resposta: prompt com Copiar, último texto e os turnos, com a fala do usuário primeiro.
  await expect(
    tab.getByRole('heading', { name: 'Corrige o login com Google', level: 3 }),
  ).toBeVisible();
  await expect(tab.getByText('Primeiro prompt')).toBeVisible();
  await expect(tab.getByRole('button', { name: 'Copiar' })).toBeVisible();
  const turnos = tab.locator('.sessions-tab__section', { hasText: 'Últimos turnos' });
  await expect(turnos.locator('.sessions-tab__turn-role').first()).toHaveText('Você');
  await expect(turnos.getByText('Pronto, o login voltou a funcionar')).toBeVisible();
  await expect(tab.getByRole('button', { name: 'Retomar em Worktree' })).toBeVisible();

  // Claude sem resposta do agente: a seção do último texto mostra "sem dado", e a seção não some.
  await tab.getByRole('button', { name: 'Voltar à lista' }).click();
  await busca.fill('pasta de testes');
  await expect(tab.getByText('1 de 5 sessões')).toBeVisible();
  await tab.getByRole('button', { name: /Organiza a pasta de testes/ }).click();
  const semResposta = tab.locator('.sessions-tab__section', { hasText: 'Último texto do agente' });
  await expect(semResposta.getByText('sem dado')).toBeVisible();

  // Antigravity: sem forma de retomada, o botão fica desligado e o motivo aparece embaixo dele.
  await tab.getByRole('button', { name: 'Voltar à lista' }).click();
  await busca.fill('tema escuro');
  await expect(tab.getByText('1 de 5 sessões')).toBeVisible();
  await tab.getByRole('button', { name: /Ajusta o tema escuro/ }).click();
  await expect(tab.getByRole('button', { name: 'Retomar em Worktree' })).toBeDisabled();
  await expect(
    tab.getByText('Antigravity CLI não tem comando para retomar uma sessão.'),
  ).toBeVisible();

  // Um texto com HTML: aparece como texto na lista, e nenhuma imagem nem script roda.
  await tab.getByRole('button', { name: 'Voltar à lista' }).click();
  await busca.fill('');
  await expect(tab.getByText('5 sessões')).toBeVisible();
  await expect(tab.getByText(PAYLOAD, { exact: true })).toBeVisible();
  await expect(tab.locator('img')).toHaveCount(0);
  expect(
    await page.evaluate(() => (window as unknown as { __xss?: unknown }).__xss),
  ).toBeUndefined();

  await expectNoViolations(page, consoleCsp);
});
