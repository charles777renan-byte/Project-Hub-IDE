import { expect, type Page } from '@playwright/test';

// Passos comuns dos testes de missão pela interface real: cadastrar o projeto, abri-lo e criar a missão.

/** Os campos do formulário "Nova missão". */
export type MissionForm = {
  title: string;
  objective: string;
  criterion: string;
};

/** Abre Projetos e cadastra a pasta que o seletor de teste devolve. Confere nome, tipo e branch. */
export async function addGitProject(page: Page, projectName: string): Promise<void> {
  await page
    .getByRole('navigation', { name: 'Principal' })
    .getByRole('link', { name: 'Projetos' })
    .click();
  await page.getByRole('button', { name: 'Adicionar projeto' }).click();

  const card = page
    .getByRole('list', { name: 'Projetos cadastrados' })
    .getByRole('listitem')
    .filter({ has: page.getByRole('heading', { name: projectName }) });
  await expect(card.getByText('Repositório Git')).toBeVisible();
  await expect(card.getByText('Branch padrão: main')).toBeVisible();
}

/** Do catálogo de projetos para a aba Missões do projeto. */
export async function openProject(page: Page, projectName: string): Promise<void> {
  await page
    .getByRole('navigation', { name: 'Principal' })
    .getByRole('link', { name: 'Projetos' })
    .click();
  await page.getByRole('main').getByRole('link', { name: projectName }).click();
  await expect(page.getByText('Branch: main')).toBeVisible();
}

/** Cria a missão pelo formulário. Ela nasce em rascunho, sem plano, e o workspace da missão abre. */
export async function createMission(page: Page, mission: MissionForm): Promise<void> {
  await page.getByRole('main').getByRole('button', { name: 'Nova missão' }).click();
  const form = page.getByRole('form', { name: 'Nova missão' });
  await form.getByLabel('Título').fill(mission.title);
  await form.getByLabel('Objetivo').fill(mission.objective);
  await form.getByLabel('Critérios de aceite').fill(mission.criterion);
  await form.getByLabel('Esta missão altera código').check();
  await form.getByRole('button', { name: 'Criar missão' }).click();
  await expect(page.getByRole('heading', { level: 1, name: mission.title })).toBeVisible();
}

/**
 * Clica em Orquestrar no resumo da missão e espera o plano ficar pronto para a aprovação. Sem planejador
 * configurado, o plano sai com um passo por critério de aceite.
 */
export async function orchestrate(page: Page): Promise<void> {
  await expect(page.getByRole('main').getByText('Rascunho', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Orquestrar' }).click();
  await expect(
    page.getByRole('main').getByText('Aguarda aprovação do plano', { exact: true }),
  ).toBeVisible();
}
