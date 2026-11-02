import { expect, type Locator, type Page } from '@playwright/test';

// Passos comuns dos testes pela interface real, na janela estilo IDE: a barra lateral (adicionar e abrir
// projeto), a aba do projeto com as visões, e a missão com o bloco "Sua decisão".

/** Nome da barra lateral (o explorador à esquerda). */
export const SIDEBAR_NAME = 'Projetos e missões';

/** Os campos do formulário "Nova missão". */
export type MissionForm = {
  title: string;
  objective: string;
  criterion: string;
};

/** As visões da aba do projeto, pelo nome da aba. */
export type ProjectViewName = 'Terminais' | 'Missões' | 'Progresso' | 'Worktrees' | 'Configurações';

/** A barra lateral. */
export function sidebarOf(page: Page): Locator {
  return page.getByRole('complementary', { name: SIDEBAR_NAME });
}

/** A barra de status, no rodapé. */
export function statusBarOf(page: Page): Locator {
  return page.getByRole('contentinfo', { name: 'Barra de status' });
}

/** O link do projeto na lista da barra lateral (leva à aba do projeto). */
export function projectLink(page: Page, projectName: string): Locator {
  return sidebarOf(page).getByRole('link', { name: projectName, exact: true });
}

/** A aba de uma visão na barra de visões do projeto. */
export function viewTab(page: Page, view: ProjectViewName): Locator {
  return page.getByRole('tablist', { name: 'Visões do projeto' }).getByRole('tab', {
    name: view,
    exact: true,
  });
}

/** O resumo (cabeçalho) da missão aberta: título, situação e Mais ações. */
export function missionSummary(page: Page): Locator {
  return page.getByRole('region', { name: 'Resumo da missão' });
}

/** O bloco "Sua decisão" da missão aberta. */
export function decisionBlock(page: Page): Locator {
  return page.getByRole('region', { name: 'Sua decisão' });
}

/**
 * Cadastra a pasta que o seletor de teste devolve, pelo botão "Adicionar projeto" da barra lateral, e espera
 * o projeto aparecer na lista dela.
 */
export async function addGitProject(page: Page, projectName: string): Promise<void> {
  await sidebarOf(page).getByRole('button', { name: 'Adicionar projeto' }).click();
  await expect(projectLink(page, projectName)).toBeVisible();
}

/**
 * Abre a aba do projeto pela barra lateral e vai à visão pedida (as Missões, por padrão). Confere o nome do
 * projeto no cabeçalho e a branch na barra de status.
 */
export async function openProject(
  page: Page,
  projectName: string,
  view: ProjectViewName = 'Missões',
): Promise<void> {
  await projectLink(page, projectName).click();
  await expect(page.getByRole('heading', { level: 1, name: projectName })).toBeVisible();
  await expect(statusBarOf(page).getByText(`${projectName} · main`)).toBeVisible();
  if (view !== 'Terminais') await viewTab(page, view).click();
  await expect(viewTab(page, view)).toHaveAttribute('aria-selected', 'true');
}

/**
 * Cria a missão pelo formulário compacto da visão Missões. Ela nasce em rascunho, sem plano, e a missão abre
 * no centro da aba do projeto.
 */
export async function createMission(page: Page, mission: MissionForm): Promise<void> {
  // O cabeçalho do projeto vem antes do estado vazio da lista, que repete o botão: vale o primeiro.
  await page.getByRole('button', { name: 'Nova missão' }).first().click();
  const form = page.getByRole('form', { name: 'Nova missão' });
  await form.getByLabel('Título').fill(mission.title);
  await form.getByLabel('Objetivo').fill(mission.objective);
  await form.getByLabel('Critérios de aceite').fill(mission.criterion);
  await form.getByLabel('Altera código').check();
  await form.getByRole('button', { name: 'Criar', exact: true }).click();
  await expect(page.getByRole('heading', { level: 1, name: mission.title })).toBeVisible();
}

/**
 * Clica em Orquestrar no bloco "Sua decisão" e espera o plano ficar pronto para a aprovação. Sem planejador
 * configurado, o plano sai com um passo por critério de aceite.
 */
export async function orchestrate(page: Page): Promise<void> {
  await expect(missionSummary(page).getByText('Rascunho', { exact: true })).toBeVisible();
  await decisionBlock(page).getByRole('button', { name: 'Orquestrar' }).click();
  await expect(
    missionSummary(page).getByText('Aguarda aprovação do plano', { exact: true }),
  ).toBeVisible();
}

/** A árvore de arquivos da aba Arquivos do painel direito. */
export function filesTree(page: Page): Locator {
  return page.getByRole('tree', { name: 'Arquivos do projeto' });
}

/**
 * Abre um arquivo pela árvore do painel direito, só com o teclado: cada pasta do caminho (relativo, em POSIX)
 * recebe o foco e é expandida com Enter, se estiver recolhida, e o arquivo é aberto com Enter. Espera a aba do
 * arquivo aparecer ao lado de "Terminais".
 */
export async function openFileFromPanel(page: Page, caminho: string): Promise<void> {
  const partes = caminho.split('/');
  const tree = filesTree(page);
  for (const [indice, nome] of partes.entries()) {
    // Pelo nome visível e pelo nível: o nome acessível de uma pasta aberta inclui o que ela contém (aria-owns).
    const item = tree
      .locator(`.files-tree__item[aria-level="${indice + 1}"]`)
      .filter({ has: page.getByText(nome, { exact: true }) });
    await item.focus();
    const ultimo = indice === partes.length - 1;
    if (ultimo || (await item.getAttribute('aria-expanded')) !== 'true') {
      await page.keyboard.press('Enter');
    }
  }
  // A aba do arquivo leva o caminho relativo no `title`.
  await expect(
    page
      .getByRole('tablist', { name: 'Arquivos abertos' })
      .locator(`[role="tab"][title="${caminho}"]`),
  ).toHaveAttribute('aria-selected', 'true');
}
