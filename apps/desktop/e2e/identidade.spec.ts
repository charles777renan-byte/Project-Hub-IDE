import { basename } from 'node:path';
import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';

// Identidade visual (Tarefa 10), na janela real do Electron construído: em cada tela principal não há
// violação de CSP (fora o <style> do xterm, coberto por regras em app.css) e o teclado percorre os
// controles com um anel de foco visível em cada um. Só roda no Windows, onde o shell do teste é o PowerShell.
test.skip(process.platform !== 'win32', 'o shell do teste é o PowerShell');

const BAR_NAME = 'Projetos e missões';
const MAX_TABS = 60;

const MISSION = {
  title: 'Verificar a identidade visual',
  objective: 'Abrir a missão pelo formulário para conferir o foco.',
  criterion: 'A tela da missão mostra o anel de foco',
};

/** O ouvinte entra antes de qualquer script da página (addInitScript + reload), como em security.spec.ts. */
async function installViolationListener(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const violations: string[] = [];
    Object.assign(window, { cspViolations: violations });
    document.addEventListener('securitypolicyviolation', (event) => {
      violations.push(`${event.violatedDirective} ${event.blockedURI}`);
    });
  });
  await page.reload();
  await expect(page.getByRole('navigation', { name: 'Principal' })).toBeVisible();
}

/**
 * Violações de CSP da página. O único descarte é o <style> inline do xterm: a violação `style-src-elem inline`
 * só é ignorada quando todo <style> da página traz regras `.xterm`. Um <style> de outra origem, ou qualquer
 * outra diretiva (script, imagem, conexão), continua aparecendo.
 */
async function cspViolations(page: Page): Promise<{ foreignStyles: string[]; others: string[] }> {
  return page.evaluate(() => {
    const w = window as unknown as { cspViolations: string[] };
    const foreignStyles = [...document.querySelectorAll('style')]
      .map((style) => style.textContent ?? '')
      .filter((text) => !text.includes('.xterm'));
    const others = w.cspViolations.filter((item) => !item.startsWith('style-src-elem inline'));
    return { foreignStyles, others };
  });
}

async function expectNoViolations(page: Page): Promise<void> {
  expect(await cspViolations(page)).toEqual({ foreignStyles: [], others: [] });
}

type FocusReport = {
  /** Quantos controles receberam foco pelo Tab. */
  count: number;
  /** Controles focados sem anel visível, com a descrição de cada um. */
  missing: string[];
};

/**
 * Percorre a tela com o Tab até o foco voltar a um elemento já visitado (ou sair do documento) e confere
 * o anel de cada elemento focado: contorno sólido de largura > 0. O xterm tem o próprio contorno apagado e
 * o foco é marcado pelo cartão `.pane:focus-within` (box-shadow inset de 2px na cor do foco). O xterm também
 * captura o Tab (vai para o shell), então ali o foco segue para o próximo controle por script.
 */
async function tabThroughControls(page: Page): Promise<FocusReport> {
  await page.evaluate(() => {
    (document.activeElement as HTMLElement | null)?.blur();
    Object.assign(window, { focusSeen: new Set<Element>() });
  });
  const missing: string[] = [];
  let count = 0;
  for (let step = 0; step < MAX_TABS; step += 1) {
    await page.keyboard.press('Tab');
    const result = await page.evaluate(() => {
      const seen = (window as unknown as { focusSeen: Set<Element> }).focusSeen;
      const element = document.activeElement;
      if (element === null || element === document.body || seen.has(element)) {
        return { done: true as const };
      }
      seen.add(element);
      const describe = (target: Element) =>
        `${target.tagName.toLowerCase()}${target.id ? `#${target.id}` : ''}${
          typeof target.className === 'string' && target.className
            ? `.${target.className.trim().split(/\s+/).join('.')}`
            : ''
        } "${(target.getAttribute('aria-label') ?? target.textContent ?? '').trim().slice(0, 40)}"`;

      const probe = document.createElement('span');
      probe.style.color = 'var(--focus)';
      document.body.append(probe);
      const focusColor = getComputedStyle(probe).color;
      probe.remove();

      const style = getComputedStyle(element);
      const outlineWidth = Number.parseFloat(style.outlineWidth);
      const outlineOk =
        style.outlineStyle !== 'none' && style.outlineStyle !== 'hidden' && outlineWidth > 0;
      let ringOk = outlineOk;
      let nextXterm = false;
      if (!outlineOk && element.classList.contains('xterm-helper-textarea')) {
        // O cartão do painel com foco dentro: 2px na cor do foco (uma sombra inset, sem desfoque).
        const card = element.closest('.pane');
        const shadow = card === null ? '' : getComputedStyle(card).boxShadow;
        ringOk = shadow.includes(focusColor) && shadow.includes('2px') && shadow.includes('inset');
        nextXterm = true;
      }
      if (nextXterm) {
        // O Tab dentro do xterm vai para o shell: segue para o próximo controle tabulável por script.
        const tabbables = [
          ...document.querySelectorAll<HTMLElement>(
            'a[href], button, input, select, textarea, [tabindex]',
          ),
        ].filter(
          (item) =>
            item.tabIndex >= 0 &&
            !(item as HTMLButtonElement).disabled &&
            item.getClientRects().length > 0,
        );
        const index = tabbables.indexOf(element as HTMLElement);
        const next = tabbables[index + 1];
        if (next === undefined) {
          (element as HTMLElement).blur();
        } else {
          next.focus();
        }
      }
      return { done: false as const, ringOk, label: describe(element) };
    });
    if (result.done) break;
    count += 1;
    if (!result.ringOk) missing.push(result.label);
  }
  return { count, missing };
}

async function expectVisibleFocus(page: Page, minimum: number): Promise<void> {
  const report = await tabThroughControls(page);
  expect(report.count, 'o Tab percorre os controles da tela').toBeGreaterThanOrEqual(minimum);
  expect(report.missing, 'controles sem anel de foco visível').toEqual([]);
}

async function addProject(page: Page, projectName: string): Promise<void> {
  await page
    .getByRole('navigation', { name: 'Principal' })
    .getByRole('link', { name: 'Projetos' })
    .click();
  await page.getByRole('button', { name: 'Adicionar projeto' }).click();
  await expect(page.getByRole('heading', { name: projectName })).toBeVisible();
}

/** Abre mais um PowerShell pela barra e espera o prompt da sessão nova. */
async function openShell(page: Page): Promise<void> {
  const panes = page.getByRole('region', { name: 'Painel PowerShell' });
  const before = await panes.count();
  await page
    .getByRole('toolbar', { name: 'Abrir terminal' })
    .getByRole('button', { name: 'PowerShell' })
    .click();
  await expect(panes).toHaveCount(before + 1);
  await expect(panes.nth(before).locator('.xterm-rows')).toContainText('PS ', {
    timeout: 30_000,
  });
}

/** Fecha todos os painéis (cada um encerra a sessão dele, com confirmação) e espera o estado vazio. */
async function endShell(page: Page): Promise<void> {
  const panes = page.getByRole('region', { name: 'Painel PowerShell' });
  for (let left = await panes.count(); left > 0; left -= 1) {
    await panes.first().getByRole('button', { name: 'Fechar painel', exact: true }).click();
    await panes
      .first()
      .getByRole('group', { name: /^Fechar o painel/ })
      .getByRole('button', { name: 'Fechar painel', exact: true })
      .click();
    await expect(panes).toHaveCount(left - 1, { timeout: 15_000 });
  }
  await expect(page.getByText('Nenhum terminal aberto')).toBeVisible({ timeout: 15_000 });
}

test('Início: sem violação de CSP e com foco visível em cada controle', async ({ launchApp }) => {
  const { page } = await launchApp();
  await installViolationListener(page);
  await page
    .getByRole('navigation', { name: 'Principal' })
    .getByRole('link', { name: 'Início' })
    .click();
  await expect(page.getByRole('main')).toBeVisible();

  await expectNoViolations(page);
  await expectVisibleFocus(page, 3);
  await expectNoViolations(page);
});

test('o filtro de CSP do teste não esconde violações que não são do xterm', async ({
  launchApp,
}) => {
  const { page } = await launchApp();
  await installViolationListener(page);
  await expectNoViolations(page);

  // Controle positivo: um <style> inline alheio e uma imagem externa são violações reais e aparecem.
  await page.evaluate(() => {
    const style = document.createElement('style');
    style.textContent = '.alheio { color: red; }';
    document.head.append(style);
    const image = document.createElement('img');
    image.src = 'https://example.invalid/x.png';
    document.body.append(image);
  });
  await expect
    .poll(async () => {
      const found = await cspViolations(page);
      return found.foreignStyles.length > 0 && found.others.some((v) => v.startsWith('img-src'));
    })
    .toBe(true);

  // E o <style> do xterm (com regras `.xterm`) é o único descarte permitido.
  await page.evaluate(() => {
    for (const style of document.querySelectorAll('style')) style.remove();
    const w = window as unknown as { cspViolations: string[] };
    w.cspViolations.length = 0;
    const style = document.createElement('style');
    style.textContent = '.xterm { color: red; }';
    document.head.append(style);
  });
  await expect
    .poll(() => page.evaluate(() => document.querySelectorAll('style').length))
    .toBeGreaterThan(0);
  expect(await cspViolations(page)).toEqual({ foreignStyles: [], others: [] });
});

test('Projetos: sem violação de CSP e com foco visível em cada controle', async ({
  launchApp,
  gitRepo,
}) => {
  const projectName = basename(gitRepo.path);
  const { page } = await launchApp({ dialogPath: gitRepo.path });
  await installViolationListener(page);
  await addProject(page, projectName);

  await expectNoViolations(page);
  await expectVisibleFocus(page, 5);
  await expectNoViolations(page);
});

test('Missão criada pelo formulário: sem violação de CSP e com foco visível', async ({
  launchApp,
  gitRepo,
}) => {
  const projectName = basename(gitRepo.path);
  const { page } = await launchApp({ dialogPath: gitRepo.path });
  await installViolationListener(page);
  await addProject(page, projectName);
  await page.getByRole('main').getByRole('link', { name: projectName }).click();
  await expect(page.getByText('Branch: main')).toBeVisible();

  await page.getByRole('button', { name: 'Criar missão' }).click();
  const form = page.getByRole('form', { name: 'Nova missão' });
  // O formulário aberto também é uma tela: o foco passa por campos, caixa e botões.
  await form.getByLabel('Título').fill(MISSION.title);
  await form.getByLabel('Objetivo').fill(MISSION.objective);
  await form.getByLabel('Critérios de aceite').fill(MISSION.criterion);
  await form.getByLabel('Esta missão altera código').check();
  await expectVisibleFocus(page, 5);

  await form.getByRole('button', { name: 'Criar missão' }).click();
  await expect(page.getByRole('heading', { level: 1, name: MISSION.title })).toBeVisible();
  await expect(
    page.getByRole('main').getByText('Aguarda aprovação do plano', { exact: true }),
  ).toBeVisible();

  await expectNoViolations(page);
  await expectVisibleFocus(page, 5);
  await expectNoViolations(page);
});

test('Workspace com o PowerShell: sem violação de CSP e com foco visível, até no xterm', async ({
  launchApp,
  gitRepo,
}) => {
  const projectName = basename(gitRepo.path);
  const { page } = await launchApp({ dialogPath: gitRepo.path });
  await installViolationListener(page);
  await addProject(page, projectName);
  await page
    .getByRole('complementary', { name: BAR_NAME })
    .getByRole('link', { name: projectName, exact: true })
    .click();
  // O workspace novo, vazio e com a barra: sem violação e com foco visível nos botões da barra.
  await expect(page.getByRole('toolbar', { name: 'Abrir terminal' })).toBeVisible();
  await expect(page.getByText('Nenhum terminal aberto')).toBeVisible();
  await expectNoViolations(page);
  await expectVisibleFocus(page, 3);
  await expectNoViolations(page);

  await openShell(page);

  try {
    await expectNoViolations(page);
    // O foco do xterm: o cartão do painel ganha o anel inset de 2px na cor do foco.
    await page.locator('.xterm-helper-textarea').focus();
    const card = await page.evaluate(() => {
      const probe = document.createElement('span');
      probe.style.color = 'var(--focus)';
      document.body.append(probe);
      const color = getComputedStyle(probe).color;
      probe.remove();
      const pane = document.activeElement?.closest('.pane');
      return { color, shadow: pane === null ? '' : getComputedStyle(pane!).boxShadow };
    });
    expect(card.shadow).toContain(card.color);
    expect(card.shadow).toContain('2px');
    expect(card.shadow).toContain('inset');

    await expectVisibleFocus(page, 8);
    await expectNoViolations(page);

    // Com três painéis (um à esquerda, dois à direita) a tela também fica sem violação e com foco visível.
    await openShell(page);
    await openShell(page);
    await expectNoViolations(page);
    await expectVisibleFocus(page, 12);
    await expectNoViolations(page);
  } finally {
    await endShell(page);
  }
});
