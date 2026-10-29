import type { Locator } from '@playwright/test';
import { expect, test } from './fixtures';
import { sidebarOf, statusBarOf } from './missions';

/**
 * Casca do app na janela real: a página não rola (quem rola é a área central), a janela tem a barra
 * superior, a barra lateral e a barra de status do rodapé, e o anel de foco dos primeiros controles cabe
 * inteiro dentro da região deles (a barra superior e a lateral podem ter rolagem e cortariam o que
 * passasse da borda).
 */

/** O anel de foco do elemento (contorno sólido) e se ele cabe dentro do retângulo de `container`. */
async function focusRing(
  control: Locator,
  containerSelector: string,
): Promise<{
  style: string;
  width: number;
  top: number;
  bottom: number;
  left: number;
  right: number;
  container: { top: number; bottom: number; left: number; right: number };
}> {
  return control.evaluate((element, selector) => {
    const style = getComputedStyle(element);
    const width = Number.parseFloat(style.outlineWidth);
    const offset = Number.parseFloat(style.outlineOffset);
    const box = element.getBoundingClientRect();
    const container = element.closest(selector)?.getBoundingClientRect();
    if (container === undefined) throw new Error(`Sem ${selector} em volta do controle.`);
    // O anel vai de `offset` até `offset + width` para fora da borda do controle (negativo é para dentro).
    const outside = Math.max(0, offset + width);
    return {
      style: style.outlineStyle,
      width,
      top: box.top - outside,
      bottom: box.bottom + outside,
      left: box.left - outside,
      right: box.right + outside,
      container: {
        top: container.top,
        bottom: container.bottom,
        left: container.left,
        right: container.right,
      },
    };
  }, containerSelector);
}

test('o documento não rola, as três barras aparecem e o anel de foco não é cortado', async ({
  launchApp,
}) => {
  const { page } = await launchApp();

  const scroll = await page.evaluate(() => ({
    scrollHeight: document.documentElement.scrollHeight,
    innerHeight: window.innerHeight,
  }));
  expect(scroll.scrollHeight).toBeLessThanOrEqual(scroll.innerHeight);

  // A barra de status fica no rodapé da janela e a lateral entre as barras: nada passa da janela.
  const status = await statusBarOf(page).boundingBox();
  const side = await sidebarOf(page).boundingBox();
  if (status === null || side === null) throw new Error('Sem caixa na tela.');
  expect(status.y + status.height).toBeLessThanOrEqual(scroll.innerHeight + 1);
  expect(status.y + status.height).toBeGreaterThanOrEqual(scroll.innerHeight - 1);
  expect(side.y + side.height).toBeLessThanOrEqual(status.y + 1);

  // A barra superior vem antes da lateral: o primeiro Tab cai no botão que oculta a lateral, depois na aba fixa
  // Início e no botão de abrir workspace; a busca da lateral vem em seguida, e depois o botão de adicionar projeto.
  await page.keyboard.press('Tab');
  await expect(page.getByRole('button', { name: 'Ocultar barra lateral' })).toBeFocused();
  await page.keyboard.press('Tab');
  const home = page.getByRole('link', { name: 'Início', exact: true });
  await expect(home).toBeFocused();
  const homeRing = await focusRing(home, '.topbar');
  await page.keyboard.press('Tab');
  await expect(page.getByRole('button', { name: 'Abrir workspace' })).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(page.getByRole('button', { name: /Buscar projeto ou agente/ })).toBeFocused();
  await page.keyboard.press('Tab');
  const add = sidebarOf(page).getByRole('button', { name: 'Adicionar projeto' });
  await expect(add).toBeFocused();
  const addRing = await focusRing(add, 'aside');

  for (const ring of [homeRing, addRing]) {
    expect(ring.style).toBe('solid');
    expect(ring.width).toBeGreaterThan(0);
    expect(ring.top).toBeGreaterThanOrEqual(ring.container.top);
    expect(ring.bottom).toBeLessThanOrEqual(ring.container.bottom);
    expect(ring.left).toBeGreaterThanOrEqual(ring.container.left);
    expect(ring.right).toBeLessThanOrEqual(ring.container.right);
  }
});

test('lateral recolhida sai da ordem de Tab e volta quando reaberta', async ({ launchApp }) => {
  const { page } = await launchApp();
  const side = page.locator('.app-side');

  // Foco num controle da lateral e Ctrl+B: ao recolher, o foco sai da lateral e não cai no body.
  await side.getByRole('button', { name: 'Adicionar projeto' }).focus();
  await page.keyboard.press('Control+b');
  await expect(side).toHaveAttribute('inert', '');
  await expect(page.locator('.topbar__sidebar-toggle')).toBeFocused();
  const foco = await page.evaluate(() => ({
    corpo: document.activeElement === document.body,
    naLateral: document.activeElement?.closest('.app-side') != null,
  }));
  expect(foco.corpo).toBe(false);
  expect(foco.naLateral).toBe(false);
  await page.keyboard.press('Control+b');
  await expect(side).not.toHaveAttribute('inert');

  await page.keyboard.press('Control+b');
  await expect(side).toHaveAttribute('inert', '');

  // Percorre bem mais controles do que a barra superior tem: nenhum pode cair dentro da lateral.
  for (let step = 0; step < 40; step += 1) {
    await page.keyboard.press('Tab');
    const focusInSide = await page.evaluate(
      () => document.activeElement?.closest('.app-side') != null,
    );
    expect(focusInSide).toBe(false);
  }

  await page.keyboard.press('Control+b');
  await expect(side).not.toHaveAttribute('inert');
});
