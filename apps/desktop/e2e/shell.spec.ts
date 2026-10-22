import { expect, test } from './fixtures';

/**
 * Casca do app na janela real (Tarefa 3 do plano da interface): a página não rola (quem rola é a área
 * abaixo da barra superior), e o anel de foco do link da navegação cabe inteiro dentro da navegação, que
 * pode ter rolagem e cortaria o que passasse da borda.
 */
test('o documento não rola e o anel de foco da navegação não é cortado', async ({ launchApp }) => {
  const { page } = await launchApp();

  const scroll = await page.evaluate(() => ({
    scrollHeight: document.documentElement.scrollHeight,
    innerHeight: window.innerHeight,
  }));
  expect(scroll.scrollHeight).toBeLessThanOrEqual(scroll.innerHeight);

  // A barra superior vem antes da navegação: o primeiro Tab cai no botão de abrir workspace.
  await page.keyboard.press('Tab');
  await expect(page.getByRole('button', { name: 'Abrir workspace' })).toBeFocused();
  await page.keyboard.press('Tab');
  const link = page.getByRole('navigation', { name: 'Principal' }).getByRole('link', {
    name: 'Início',
  });
  await expect(link).toBeFocused();

  const ring = await link.evaluate((element) => {
    const style = getComputedStyle(element);
    const width = Number.parseFloat(style.outlineWidth);
    const offset = Number.parseFloat(style.outlineOffset);
    const box = element.getBoundingClientRect();
    const nav = element.closest('nav')?.getBoundingClientRect();
    // O anel vai de `offset` até `offset + width` para fora da borda do link (negativo é para dentro).
    const outside = Math.max(0, offset + width);
    return {
      style: style.outlineStyle,
      width,
      top: box.top - outside,
      bottom: box.bottom + outside,
      left: box.left - outside,
      right: box.right + outside,
      nav,
    };
  });
  expect(ring.style).toBe('solid');
  expect(ring.width).toBeGreaterThan(0);
  expect(ring.nav).toBeDefined();
  expect(ring.top).toBeGreaterThanOrEqual(ring.nav!.top);
  expect(ring.bottom).toBeLessThanOrEqual(ring.nav!.bottom);
  expect(ring.left).toBeGreaterThanOrEqual(ring.nav!.left);
  expect(ring.right).toBeLessThanOrEqual(ring.nav!.right);
});
