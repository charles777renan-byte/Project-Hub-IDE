import { existsSync } from 'node:fs';
import { basename } from 'node:path';
import { expect, test } from './fixtures';
import { addGitProject, openProject, projectLink, sidebarOf, viewTab } from './missions';

// Adicionar, arquivar, restaurar e remover projetos pela janela do Electron construído, na estrutura nova:
// "Adicionar projeto" e a seção recolhível "Arquivados" ficam na barra lateral, e Arquivar e Remover da lista
// ficam no "Mais ações" do cabeçalho da aba do projeto (com confirmação). Os testes de renderer usam a API
// falsa; estes mostram que o caminho real (botão, IPC, banco e lista) responde.

test('adicionar pela lateral lista o projeto, e as Configurações dele mostram a pasta, o Git e a branch', async ({
  launchApp,
  gitRepo,
}) => {
  const projectName = basename(gitRepo.path);
  const { page } = await launchApp({ dialogPath: gitRepo.path });
  await expect(sidebarOf(page).getByText('Nenhum projeto ainda.')).toBeVisible();

  await addGitProject(page, projectName);
  await expect(sidebarOf(page).getByText('Nenhum projeto ainda.')).toHaveCount(0);
  // Adicionar não abre a aba do projeto: só abrir (clicar na lateral) cria a aba na barra superior.
  await expect(page.getByRole('navigation', { name: 'Workspaces abertos' })).toHaveCount(0);

  await openProject(page, projectName, 'Configurações');
  // O tipo e a branch padrão do cadastro (antes no cartão da lista de Projetos).
  const facts = page.getByRole('tabpanel', { name: 'Configurações' });
  await expect(facts.getByText('Branch padrão')).toBeVisible();
  await expect(facts.getByText('main · Repositório Git', { exact: true })).toBeVisible();
  // Grupo e apelido editam em linha: só o valor e um Editar, sem campo aberto.
  await expect(facts.getByRole('button', { name: 'Editar grupo' })).toBeVisible();
  await expect(facts.getByRole('textbox')).toHaveCount(0);
  await expect(facts.getByText(projectName, { exact: true })).toBeVisible();
});

test('arquivar fecha a aba, tira o projeto da lista e o devolve com Restaurar, em Arquivados na lateral', async ({
  launchApp,
  gitRepo,
}) => {
  const projectName = basename(gitRepo.path);
  const { page } = await launchApp({ dialogPath: gitRepo.path });
  const sidebar = sidebarOf(page);
  await addGitProject(page, projectName);
  // Sem arquivados, a seção nem existe.
  await expect(sidebar.getByRole('button', { name: /^Arquivados/ })).toHaveCount(0);
  await openProject(page, projectName);
  await expect(page.getByRole('navigation', { name: 'Workspaces abertos' })).toBeVisible();

  await page.getByRole('button', { name: 'Mais ações' }).click();
  await page.getByRole('menuitem', { name: 'Arquivar projeto' }).click();
  // Arquivar pede confirmação, com a pergunta na tela.
  const question = page.getByRole('group', { name: /^Arquivar o projeto\?/ });
  await expect(question).toBeVisible();
  await question.getByRole('button', { name: 'Arquivar', exact: true }).click();

  // Volta ao Início, a aba do projeto fecha, e o projeto sai da lista e vai para Arquivados.
  await expect(page.getByRole('heading', { level: 1, name: 'Início' })).toBeVisible();
  await expect(page.getByRole('navigation', { name: 'Workspaces abertos' })).toHaveCount(0);
  await expect(page.getByRole('alert')).toHaveCount(0);
  await expect(projectLink(page, projectName)).toHaveCount(0);
  const toggle = sidebar.getByRole('button', { name: /^Arquivados/ });
  await expect(toggle).toHaveAttribute('aria-expanded', 'false');
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-expanded', 'true');
  await expect(
    sidebar.getByRole('list', { name: 'Projetos arquivados' }).getByText(projectName, {
      exact: true,
    }),
  ).toBeVisible();

  await sidebar.getByRole('button', { name: `Restaurar ${projectName}` }).click();

  // O projeto volta à lista, e a seção Arquivados some junto com o último arquivado.
  await expect(projectLink(page, projectName)).toBeVisible();
  await expect(sidebar.getByRole('list', { name: 'Projetos arquivados' })).toHaveCount(0);
  await expect(sidebar.getByRole('button', { name: /^Arquivados/ })).toHaveCount(0);
  await expect(page.getByRole('alert')).toHaveCount(0);
  // O foco não cai no corpo da página: vai para o botão Adicionar projeto, o que sobrou da lateral.
  await expect(sidebar.getByRole('button', { name: 'Adicionar projeto' })).toBeFocused();
});

test('remover da lista pede confirmação, fecha a aba, tira o projeto da lateral e mantém a pasta', async ({
  launchApp,
  gitRepo,
}) => {
  const projectName = basename(gitRepo.path);
  const { page } = await launchApp({ dialogPath: gitRepo.path });
  await addGitProject(page, projectName);
  await openProject(page, projectName);

  await page.getByRole('button', { name: 'Mais ações' }).click();
  await page.getByRole('menuitem', { name: 'Remover da lista' }).click();
  await expect(page.getByRole('button', { name: 'Remover', exact: true })).toBeVisible();

  await page.getByRole('button', { name: 'Remover', exact: true }).click();

  await expect(page.getByRole('heading', { level: 1, name: 'Início' })).toBeVisible();
  await expect(page.getByRole('navigation', { name: 'Workspaces abertos' })).toHaveCount(0);
  await expect(sidebarOf(page).getByText('Nenhum projeto ainda.')).toBeVisible();
  // Remover não arquiva: nada aparece em Arquivados.
  await expect(sidebarOf(page).getByRole('button', { name: /^Arquivados/ })).toHaveCount(0);
  await expect(page.getByRole('alert')).toHaveCount(0);
  expect(existsSync(gitRepo.path)).toBe(true);
});

test('trocar de visão muda o endereço da aba do projeto, e as rotas antigas redirecionam', async ({
  launchApp,
  gitRepo,
}) => {
  const projectName = basename(gitRepo.path);
  const { page } = await launchApp({ dialogPath: gitRepo.path });
  await addGitProject(page, projectName);
  await openProject(page, projectName, 'Terminais');
  const base = page.url().split('?')[0] ?? '';
  expect(base).toContain('/workspaces/');

  for (const [view, param] of [
    ['Missões', 'missoes'],
    ['Progresso', 'progresso'],
    ['Worktrees', 'worktrees'],
    ['Configurações', 'configuracoes'],
  ] as const) {
    await viewTab(page, view).click();
    await expect(viewTab(page, view)).toHaveAttribute('aria-selected', 'true');
    await expect(page).toHaveURL(new RegExp(`\\?visao=${param}$`));
  }

  // O endereço antigo do projeto (`#/projects/:id`) cai na visão Missões da aba, e `#/projects` no Início.
  const id = decodeURIComponent(base.split('/workspaces/')[1] ?? '');
  await page.evaluate((projectId) => {
    location.hash = `#/projects/${encodeURIComponent(projectId)}`;
  }, id);
  await expect(viewTab(page, 'Missões')).toHaveAttribute('aria-selected', 'true');
  await expect(page).toHaveURL(/\/workspaces\/.+\?visao=missoes$/);
  await page.evaluate(() => {
    location.hash = '#/projects';
  });
  await expect(page.getByRole('heading', { level: 1, name: 'Início' })).toBeVisible();
  await expect(page).toHaveURL(/#\/$/);
});
