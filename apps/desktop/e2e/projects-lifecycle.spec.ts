import { existsSync } from 'node:fs';
import { basename } from 'node:path';
import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';

// Arquivar, remover e restaurar projetos pela janela do Electron construído: o botão, o IPC, o banco e
// a lista. Os testes de renderer usam a API falsa; estes mostram que o caminho real responde.

/** Abre Projetos e cadastra a pasta que o seletor de teste devolve. */
async function addGitProject(page: Page, projectName: string): Promise<void> {
  await page
    .getByRole('navigation', { name: 'Principal' })
    .getByRole('link', { name: 'Projetos' })
    .click();
  await page.getByRole('button', { name: 'Adicionar projeto' }).click();
  await expect(
    page
      .getByRole('list', { name: 'Projetos cadastrados' })
      .getByRole('heading', { name: projectName }),
  ).toBeVisible();
}

/** Do catálogo de projetos para o detalhe do projeto. */
async function openProject(page: Page, projectName: string): Promise<void> {
  await page
    .getByRole('navigation', { name: 'Principal' })
    .getByRole('link', { name: 'Projetos' })
    .click();
  await page.getByRole('main').getByRole('link', { name: projectName }).click();
  await expect(page.getByText('Branch: main')).toBeVisible();
}

test('arquivar tira o projeto da lista, aparece em Arquivados e Restaurar o devolve', async ({
  launchApp,
  gitRepo,
}) => {
  const projectName = basename(gitRepo.path);
  const { page } = await launchApp({ dialogPath: gitRepo.path });
  await addGitProject(page, projectName);
  await openProject(page, projectName);

  await page.getByRole('button', { name: 'Mais ações' }).click();
  await page.getByRole('menuitem', { name: 'Arquivar projeto' }).click();

  await expect(page.getByRole('heading', { level: 1, name: 'Projetos' })).toBeVisible();
  await expect(page.getByRole('alert')).toHaveCount(0);
  await expect(
    page.getByRole('list', { name: 'Projetos arquivados' }).getByText(projectName, { exact: true }),
  ).toBeVisible();
  await expect(page.getByRole('list', { name: 'Projetos cadastrados' })).toHaveCount(0);

  await page.getByRole('button', { name: `Restaurar ${projectName}` }).click();

  await expect(
    page
      .getByRole('list', { name: 'Projetos cadastrados' })
      .getByRole('heading', { name: projectName }),
  ).toBeVisible();
  await expect(page.getByRole('list', { name: 'Projetos arquivados' })).toHaveCount(0);
});

test('remover da lista pede confirmação, tira o projeto da lista e mantém a pasta', async ({
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

  await expect(page.getByRole('heading', { level: 1, name: 'Projetos' })).toBeVisible();
  await expect(
    page.getByText('Nenhum projeto ainda. Adicione uma pasta para começar.'),
  ).toBeVisible();
  await expect(page.getByRole('alert')).toHaveCount(0);
  expect(existsSync(gitRepo.path)).toBe(true);
});
