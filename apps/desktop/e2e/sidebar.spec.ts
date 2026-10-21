import { basename } from 'node:path';
import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';

// Barra lateral de projetos e missões (Tarefa 4 do plano da interface), na janela real. A barra rola,
// e um contorno de foco de 2px com recuo de 2px sairia da borda da rolagem. Por isso os itens têm
// `outline-offset: -2px`: este teste anda pelo teclado por cada item da barra e mede que o contorno
// cabe dentro do retângulo da barra.

const BAR_NAME = 'Projetos e missões';

type FocusedItem = { label: string; style: string; width: number; inside: boolean };

/** O item com foco, se ele está dentro da barra: o nome, o estilo do contorno e se ele cabe na barra. */
async function focusedItemInBar(page: Page): Promise<FocusedItem | null> {
  return page.evaluate(() => {
    const bar = document.querySelector<HTMLElement>('aside[aria-label="Projetos e missões"]');
    const element = document.activeElement;
    if (bar === null || !(element instanceof HTMLElement) || !bar.contains(element)) return null;

    const style = getComputedStyle(element);
    const width = Number.parseFloat(style.outlineWidth);
    const offset = Number.parseFloat(style.outlineOffset);
    const box = element.getBoundingClientRect();
    const frame = bar.getBoundingClientRect();
    // O contorno vai de `offset` até `offset + width` para fora da borda do item (negativo é para dentro).
    const outside = Math.max(0, offset + width);
    const inside =
      box.top - outside >= frame.top &&
      box.bottom + outside <= frame.bottom &&
      box.left - outside >= frame.left &&
      box.right + outside <= frame.right;
    return { label: (element.textContent ?? '').trim(), style: style.outlineStyle, width, inside };
  });
}

test('o contorno de foco de cada item da barra cabe dentro dela', async ({
  launchApp,
  gitRepo,
}) => {
  const projectName = basename(gitRepo.path);
  const { page } = await launchApp({ dialogPath: gitRepo.path });

  // Cadastra o projeto pelo seletor e abre o detalhe dele (a barra passa a listar o projeto).
  await page
    .getByRole('navigation', { name: 'Principal' })
    .getByRole('link', { name: 'Projetos' })
    .click();
  await page.getByRole('button', { name: 'Adicionar projeto' }).click();
  const card = page
    .getByRole('list', { name: 'Projetos cadastrados' })
    .getByRole('listitem')
    .filter({ has: page.getByRole('heading', { name: projectName }) });
  await card.getByRole('link', { name: projectName }).click();
  await expect(page.getByText('Branch: main')).toBeVisible();

  // Cria uma missão pelo formulário: o workspace abre e a barra passa a listar a missão do projeto.
  const missionTitle = 'Missão da barra';
  await page.getByRole('button', { name: 'Criar missão' }).click();
  const form = page.getByRole('form', { name: 'Nova missão' });
  await form.getByLabel('Título').fill(missionTitle);
  await form.getByLabel('Objetivo').fill('Conferir a barra lateral.');
  await form.getByLabel('Critérios de aceite').fill('A barra mostra a missão');
  await form.getByLabel('Esta missão altera código').check();
  await form.getByRole('button', { name: 'Criar missão' }).click();
  await expect(page.getByRole('heading', { level: 1, name: missionTitle })).toBeVisible();

  const bar = page.getByRole('complementary', { name: BAR_NAME });
  await expect(bar.getByRole('link', { name: missionTitle })).toBeVisible();
  await expect(bar.getByRole('button', { name: '+ Nova missão' })).toBeVisible();

  // Tab a partir da navegação até a barra, e depois por cada item dela, até o foco sair.
  const visited: string[] = [];
  for (let press = 0; press < 20; press += 1) {
    await page.keyboard.press('Tab');
    const item = await focusedItemInBar(page);
    if (item === null) {
      if (visited.length > 0) break;
      continue;
    }
    visited.push(item.label);
    expect(item.style, `o foco de "${item.label}" tem contorno sólido`).toBe('solid');
    expect(item.width, `o foco de "${item.label}" tem contorno`).toBeGreaterThan(0);
    expect(item.inside, `o contorno de "${item.label}" cabe dentro da barra`).toBe(true);
  }

  expect(visited).toEqual([projectName, '+ Novo projeto', missionTitle, '+ Nova missão']);
});
