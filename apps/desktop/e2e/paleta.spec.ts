import type { ElementHandle, Locator, Page } from '@playwright/test';
import { basename } from 'node:path';
import { expect, test } from './fixtures';
import { addGitProject } from './missions';

// Paleta de comandos (Ctrl+K, components/PaletaComandos.tsx) na janela real, sob a CSP do app. O <dialog>
// modal e o cmdk não podem montar <style> nem disparar violação de CSP. O foco entra na busca ao abrir e
// volta a quem o tinha ao fechar, e Enter leva à tela escolhida.

/**
 * Foco do DOM: o elemento é o `document.activeElement`. O `toBeFocused` do Playwright também exige que a janela
 * tenha o foco do sistema, o que depende de onde a janela de teste aparece. A paleta só promete o foco do DOM.
 */
async function expectDomFocus(page: Page, locator: Locator): Promise<void> {
  const handle: ElementHandle | null = await locator.elementHandle();
  expect(handle, 'o elemento existe').not.toBeNull();
  await expect
    .poll(() => page.evaluate((element) => document.activeElement === element, handle))
    .toBe(true);
}

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

  // A aba fixa Início (na barra superior) é onde o foco começa e para onde ele volta ao fechar.
  const inicio = page.getByRole('link', { name: 'Início', exact: true });
  await expect(inicio).toBeVisible();
  const paleta = page.getByRole('dialog', { name: 'Paleta de comandos' });
  await expect(paleta).toBeHidden();

  // Foco na aba Início: é para onde o foco tem de voltar ao fechar.
  await inicio.focus();
  const stylesAntes = (await cspProblems(page)).styles;

  await page.keyboard.press('Control+K');
  await expect(paleta).toBeVisible();
  await expectDomFocus(page, paleta.getByRole('combobox'));
  expect(await cspProblems(page)).toEqual({ styles: stylesAntes, others: [] });

  // Enter leva à tela escolhida: "Alterar meu nome" vai ao Início com o campo do nome aberto (a tela
  // Projetos não existe mais; os projetos moram na barra lateral).
  const nome = page.getByRole('form', { name: 'Seu nome' });
  await expect(nome).toHaveCount(0);
  await page.keyboard.type('Alterar meu nome');
  await page.keyboard.press('Enter');
  await expect(paleta).toBeHidden();
  await expect(nome).toBeVisible();
  await expect(page).toHaveURL(/editar-nome=1/);

  // Segunda vez, pelo Início: Escape fecha sem navegar e o foco volta ao link de origem.
  const urlAntes = page.url();
  await inicio.focus();
  await page.keyboard.press('Control+K');
  await expect(paleta).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(paleta).toBeHidden();
  await expectDomFocus(page, inicio);
  expect(page.url()).toBe(urlAntes);
  await expect(nome).toBeVisible();

  expect(await cspProblems(page)).toEqual({ styles: stylesAntes, others: [] });
  await launched.close();
});

test('a paleta anima ao abrir e ao fechar, e "Nova missão…" leva ao formulário do projeto escolhido', async ({
  launchApp,
  gitRepo,
}) => {
  const projectName = basename(gitRepo.path);
  const launched = await launchApp({ dialogPath: gitRepo.path });
  const { page } = launched;
  await watchCspViolations(page);
  await addGitProject(page, projectName);
  const paleta = page.getByRole('dialog', { name: 'Paleta de comandos' });

  // Abrir: a caixa entra com paleta-in (a regra vale enquanto ela está aberta, então não depende do quadro).
  await page.keyboard.press('Control+K');
  await expect(paleta).toBeVisible();
  expect(await paleta.evaluate((dialog) => getComputedStyle(dialog).animationName)).toBe(
    'paleta-in',
  );

  // Fechar: a paleta fica na tela com data-motion="leaving" e paleta-out até a saída acabar, e só então some.
  // O observador entra antes do Escape (o evaluate termina primeiro) e guarda o que viu em `window`.
  await paleta.evaluate((dialog) => {
    const w = window as unknown as { saidaDaPaleta?: string };
    new MutationObserver((_, observer) => {
      if (dialog.getAttribute('data-motion') !== 'leaving') return;
      observer.disconnect();
      w.saidaDaPaleta = getComputedStyle(dialog).animationName;
    }).observe(dialog, { attributes: true, attributeFilter: ['data-motion'] });
  });
  await page.keyboard.press('Escape');
  await expect
    .poll(() =>
      page.evaluate(() => (window as unknown as { saidaDaPaleta?: string }).saidaDaPaleta),
    )
    .toBe('paleta-out');
  await expect(paleta).toBeHidden();

  // "Nova missão…" troca a lista pelos projetos; Enter no projeto abre o formulário dele.
  await page.keyboard.press('Control+K');
  await expect(paleta).toBeVisible();
  await page.keyboard.type('Nova missão…');
  await expect(paleta.getByRole('option', { name: 'Nova missão…' })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  await page.keyboard.press('Enter');
  const busca = paleta.getByRole('combobox');
  await expect(busca).toHaveAttribute('placeholder', 'Em qual projeto?');
  await expect(paleta.getByRole('button', { name: 'Voltar para todos os comandos' })).toBeVisible();
  await page.keyboard.type(projectName);
  await page.keyboard.press('Enter');
  await expect(paleta).toBeHidden();
  await expect(page.getByRole('form', { name: 'Nova missão' })).toBeVisible();

  expect((await cspProblems(page)).others).toEqual([]);
  await launched.close();
});
