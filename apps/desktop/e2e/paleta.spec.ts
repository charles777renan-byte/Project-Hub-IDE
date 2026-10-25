import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';

// Paleta de comandos (Ctrl+K, components/PaletaComandos.tsx) na janela real, sob a CSP do app. O <dialog>
// modal e o cmdk não podem montar <style> nem disparar violação de CSP. O foco entra na busca ao abrir e
// volta a quem o tinha ao fechar, e Enter leva à tela escolhida.

/**
 * Passa a anotar as violações de CSP da página em `window.cspViolations`. O ouvinte entra antes de qualquer
 * script da página (addInitScript + reload), como em vertical-slice.spec.ts.
 */
async function watchCspViolations(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const violations: string[] = [];
    Object.assign(window, { cspViolations: violations });
    document.addEventListener('securitypolicyviolation', (event) => {
      violations.push(`${event.violatedDirective} ${event.blockedURI}`);
    });
  });
  await page.reload();
}

/**
 * Violações de CSP da página, e quantos <style> o documento tem. Abrir a paleta não pode somar nenhum: o
 * <style> inline seria bloqueado, como o do menu do Radix (ver MenuAcoes). A tela inicial não tem xterm,
 * então nenhuma violação se descarta.
 */
async function cspProblems(page: Page): Promise<{ styles: number; others: string[] }> {
  return page.evaluate(() => {
    const w = window as unknown as { cspViolations: string[] };
    return {
      styles: document.querySelectorAll('style').length,
      others: w.cspViolations.filter((item) => !item.startsWith('style-src-elem inline')),
    };
  });
}

test('a paleta abre com Ctrl+K, leva à tela escolhida e fecha com Escape, sem violar a CSP', async ({
  launchApp,
}) => {
  const launched = await launchApp();
  const { page } = launched;
  await watchCspViolations(page);

  const navigation = page.getByRole('navigation', { name: 'Principal' });
  await expect(navigation).toBeVisible();
  const paleta = page.getByRole('dialog', { name: 'Paleta de comandos' });
  await expect(paleta).toBeHidden();

  // Foco num link da navegação: é para onde o foco tem de voltar ao fechar.
  const projetos = navigation.getByRole('link', { name: 'Projetos' });
  await projetos.focus();
  const stylesAntes = (await cspProblems(page)).styles;

  await page.keyboard.press('Control+K');
  await expect(paleta).toBeVisible();
  await expect(paleta.getByRole('combobox')).toBeFocused();
  expect(await cspProblems(page)).toEqual({ styles: stylesAntes, others: [] });

  await page.keyboard.type('Ir para Projetos');
  await page.keyboard.press('Enter');
  await expect(paleta).toBeHidden();
  await expect(page.getByRole('heading', { level: 1, name: 'Projetos' })).toBeVisible();

  // Segunda vez, pela Início: Escape fecha sem navegar e o foco volta ao link de origem.
  const inicio = navigation.getByRole('link', { name: 'Início' });
  await inicio.focus();
  await page.keyboard.press('Control+K');
  await expect(paleta).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(paleta).toBeHidden();
  await expect(inicio).toBeFocused();
  await expect(page.getByRole('heading', { level: 1, name: 'Projetos' })).toBeVisible();

  expect(await cspProblems(page)).toEqual({ styles: stylesAntes, others: [] });
  await launched.close();
});
