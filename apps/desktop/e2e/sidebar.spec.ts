import { basename } from 'node:path';
import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';
import { orchestrate } from './missions';

// Barra lateral (Tarefa 4 do plano da interface e Tarefa 7 do plano do workspace), na janela real. Cada
// seção rola sozinha, e um contorno de foco de 2px com recuo de 2px sairia da borda da rolagem. Por isso
// os itens têm `outline-offset: -2px`: este teste anda pelo teclado por cada item da barra e mede que o
// contorno cabe dentro do retângulo da barra e da seção que rola em que o item está.

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
    // O item tem de caber na barra e, quando está numa lista que rola, na janela de rolagem dela.
    const frames = [bar.getBoundingClientRect()];
    const scroller = element.closest('.sidebar__scroll');
    if (scroller !== null) frames.push(scroller.getBoundingClientRect());
    // O contorno pinta de `offset` até `offset + width` para fora da borda do item. Com `offset: -2px` e
    // 2px de largura, a borda de fora do anel coincide com a borda do item: o anel pinta por dentro dele.
    // Por isso o retângulo do anel é o do item expandido por `offset + width` (zero aqui), e é ele que
    // tem de caber na barra e na janela de rolagem. A tolerância de 0,5px cobre só a rolagem fracionária.
    const reach = offset + width;
    const ring = {
      top: box.top - reach,
      bottom: box.bottom + reach,
      left: box.left - reach,
      right: box.right + reach,
    };
    const tolerance = 0.5;
    const inside = frames.every(
      (frame) =>
        ring.top >= frame.top - tolerance &&
        ring.bottom <= frame.bottom + tolerance &&
        ring.left >= frame.left - tolerance &&
        ring.right <= frame.right + tolerance,
    );
    // O nome do item sai do texto sem os trechos `aria-hidden` (a dica "Ctrl K" da busca, por exemplo).
    const copy = element.cloneNode(true) as HTMLElement;
    copy.querySelectorAll('[aria-hidden="true"]').forEach((node) => node.remove());
    const label = element.getAttribute('aria-label') ?? (copy.textContent ?? '').trim();
    return { label, style: style.outlineStyle, width, inside };
  });
}

test('o contorno de foco de cada item da barra cabe dentro dela', async ({
  launchApp,
  gitRepo,
}) => {
  const projectName = basename(gitRepo.path);
  const { page } = await launchApp({ dialogPath: gitRepo.path });
  const navigation = page.getByRole('navigation', { name: 'Principal' });

  // Cadastra o projeto pelo seletor (a barra passa a listar o projeto).
  await navigation.getByRole('link', { name: 'Projetos' }).click();
  await page.getByRole('button', { name: 'Adicionar projeto' }).click();
  const card = page
    .getByRole('list', { name: 'Projetos cadastrados' })
    .getByRole('listitem')
    .filter({ has: page.getByRole('heading', { name: projectName }) });
  await expect(card).toBeVisible();

  const bar = page.getByRole('complementary', { name: BAR_NAME });
  // Do catálogo para o detalhe do projeto.
  await navigation.getByRole('link', { name: 'Projetos' }).click();
  await card.getByRole('link', { name: projectName }).click();
  await expect(page.getByText('Branch: main')).toBeVisible();

  // Cria uma missão pelo formulário: o workspace abre com a missão em rascunho. Orquestrar gera o plano, e a
  // missão, com o plano à espera de aprovação, entra no aviso "Precisa de você".
  const missionTitle = 'Missão da barra';
  await page.getByRole('main').getByRole('button', { name: 'Nova missão' }).click();
  const form = page.getByRole('form', { name: 'Nova missão' });
  await form.getByLabel('Título').fill(missionTitle);
  await form.getByLabel('Objetivo').fill('Conferir a barra lateral.');
  await form.getByLabel('Critérios de aceite').fill('A barra mostra a missão');
  await form.getByLabel('Esta missão altera código').check();
  await form.getByRole('button', { name: 'Criar missão' }).click();
  await expect(page.getByRole('heading', { level: 1, name: missionTitle })).toBeVisible();
  await orchestrate(page);

  // A missão, com o plano à espera de aprovação, sobe para o aviso "Precisa de você", e o botão Nova missão
  // fica no rodapé da barra.
  const attention = bar.getByRole('region', { name: 'Precisa de você' });
  await expect(attention.getByText(missionTitle)).toBeVisible();
  await expect(attention.getByText(/Aguarda aprovação do plano/)).toBeVisible();
  await expect(bar.getByRole('button', { name: '+ Nova missão' })).toBeVisible();

  // A barra só rola quando o conteúdo passa da altura dela. Com poucos itens ela não rola, e um contorno
  // que saísse da borda da rolagem não seria medido. Por isso a altura da barra é limitada aqui, e a
  // guarda abaixo confirma que a barra de fato rola antes da medição.
  await bar.evaluate((element) => {
    (element as HTMLElement).style.maxHeight = '240px';
  });
  expect(await bar.evaluate((element) => element.scrollHeight > element.clientHeight)).toBe(true);

  // Tab a partir do começo da página até a barra, e depois por cada item dela, até o foco sair.
  const visited: string[] = [];
  for (let press = 0; press < 40; press += 1) {
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

  // A ordem da tela: a busca, o aviso (Ir), a navegação, a troca Lista/Grade, o projeto e o rodapé.
  expect(visited).toEqual([
    'Buscar projeto ou agente',
    `Ir para ${missionTitle}`,
    'Início',
    'Projetos',
    'Lista',
    'Grade',
    `Sessões de ${projectName}`,
    projectName,
    '+ Projeto',
    '+ Nova missão',
  ]);
});
