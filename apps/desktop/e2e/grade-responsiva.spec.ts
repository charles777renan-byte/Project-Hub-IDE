import { basename } from 'node:path';
import type { ElectronApplication, Locator, Page } from '@playwright/test';
import { expect, test } from './fixtures';
import { addGitProject, openProject, statusBarOf } from './missions';
import { expectOpenSessions, expectTerminalToContain, fecharPainel } from './terminals';

// O layout dos terminais numa janela de tamanho variável, pela janela do Electron construído: cada terminal mostrado
// tem ao menos 340 x 200 px; quando o layout não cabe na área entra a faixa de abas (um painel por vez), e o layout
// guardado volta quando couber. Só roda no Windows, onde o shell do teste é o PowerShell.
test.skip(process.platform !== 'win32', 'o shell do teste é o PowerShell');

const MIN_WIDTH = 340;
const MIN_HEIGHT = 200;
const GAP = 8;
/** A largura mínima de dois painéis lado a lado: abaixo dela, um layout com duas colunas não cabe. */
const TWO_COLUMNS = 2 * MIN_WIDTH + GAP;
/** Folga de arredondamento da caixa medida em px de CSS (a tela pode ter escala fracionária). */
const TOLERANCE = 1;

const shellPanes = (page: Page): Locator => page.getByRole('region', { name: 'Painel PowerShell' });
const tabs = (page: Page): Locator =>
  page.getByRole('tablist', { name: 'Painéis abertos' }).getByRole('tab');

async function addProjectAndOpenWorkspace(page: Page, projectName: string): Promise<void> {
  await addGitProject(page, projectName);
  await openProject(page, projectName, 'Terminais');
  await expect(page.getByRole('button', { name: 'Abrir terminal' })).toBeVisible();
}

/**
 * Esconde a barra lateral e o painel direito pelos botões da barra superior, como a pessoa faria. Com os dois abertos
 * sobra pouca largura para a área do workspace: os testes do layout precisam de uma área larga, e o da janela pequena
 * a estreita de propósito.
 */
async function hideSidePanels(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Ocultar barra lateral' }).click();
  await page.getByRole('button', { name: 'Ocultar painel direito' }).click();
  await expect(page.getByRole('button', { name: 'Mostrar barra lateral' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Mostrar painel direito' })).toBeVisible();
}

/** Abre mais um PowerShell pela barra. `before` é quantas sessões havia: na faixa de abas só um painel aparece. */
async function openShell(page: Page, before: number): Promise<void> {
  await page.getByRole('button', { name: 'Abrir terminal' }).click();
  await page.getByRole('menuitem', { name: /PowerShell/ }).click();
  await expectOpenSessions(page, before + 1);
  // O painel novo recebe o foco: é o ativo, na grade ou sozinho na faixa de abas.
  await expectTerminalToContain(page.locator('.pane[data-active="true"] .terminal-view'), 'PS ', {
    timeout: 30_000,
  });
}

/**
 * Fecha todos os painéis: fechar encerra a sessão, e um shell vivo seguraria a pasta do projeto e o fechamento do
 * app. O laço fecha sempre o primeiro painel na tela até o estado vazio.
 */
async function endShells(page: Page, total: number): Promise<void> {
  for (let left = total; left > 0; left -= 1) {
    await fecharPainel(page, 'PowerShell');
    await expectOpenSessions(page, left - 1);
  }
  await expect(page.getByText('Nenhum terminal aberto')).toBeVisible({ timeout: 15_000 });
}

/** Largura e altura reais de `.workspace__area`, a área que a grade mede. */
async function areaSize(page: Page): Promise<{ width: number; height: number }> {
  const box = await page.locator('.workspace__area').boundingBox();
  if (box === null) throw new Error('A área do workspace não tem caixa na tela.');
  return { width: box.width, height: box.height };
}

/**
 * Redimensiona a janela até a área do workspace ter a largura pedida. Mede a área de verdade (a barra lateral e o
 * painel direito mudam o que sobra), em vez de supor a largura do chrome: pede a diferença à janela e confere.
 */
async function resizeAreaTo(
  app: ElectronApplication,
  page: Page,
  width: number,
  height: number,
): Promise<void> {
  const current = await areaSize(page);
  const outer = await app.evaluate(({ BrowserWindow }) => {
    const [w = 0, h = 0] = BrowserWindow.getAllWindows()[0]?.getSize() ?? [];
    return { width: w, height: h };
  });
  const targetWidth = outer.width + Math.round(width - current.width);
  const targetHeight = outer.height + Math.round(height - current.height);
  await app.evaluate(
    ({ BrowserWindow }, size) => {
      BrowserWindow.getAllWindows()[0]?.setSize(size.width, size.height);
    },
    { width: targetWidth, height: targetHeight },
  );
  await expect
    .poll(async () => Math.abs((await areaSize(page)).width - width), { timeout: 10_000 })
    .toBeLessThanOrEqual(2);
}

/** Mensagens da CSP no console da página (o `<style>` inline do xterm é conhecido e fica fora, como no workspace). */
function cspViolations(messages: readonly string[]): string[] {
  return messages.filter(
    (text) => text.includes('Content Security Policy') && !text.includes('Applying inline style'),
  );
}

test('numa janela 1360 x 840, cada terminal novo divide um painel sem deixar nenhum abaixo de 340 x 200; quando não cabe mais, um painel por vez', async ({
  launchApp,
  gitRepo,
}) => {
  test.setTimeout(300_000);
  const projectName = basename(gitRepo.path);
  const { app, page } = await launchApp({ dialogPath: gitRepo.path });
  const messages: string[] = [];
  page.on('console', (message) => messages.push(`${message.type()}: ${message.text()}`));
  await app.evaluate(({ BrowserWindow }) => {
    BrowserWindow.getAllWindows()[0]?.setSize(1360, 840);
  });
  await addProjectAndOpenWorkspace(page, projectName);
  await hideSidePanels(page);
  const area = await areaSize(page);
  console.log(`[medida] área ${Math.round(area.width)} x ${Math.round(area.height)}`);

  const tablist = page.getByRole('tablist', { name: 'Painéis abertos' });
  // Abre terminais até o layout não caber: enquanto cabe, todos aparecem e nenhum fica abaixo do mínimo.
  let total = 0;
  let inGrid = 0;
  while (total < 12) {
    await openShell(page, total);
    total += 1;
    if ((await tablist.count()) > 0) break;
    inGrid = total;
    await expect(shellPanes(page)).toHaveCount(total);
    const boxes = await shellPanes(page).evaluateAll((items) =>
      items.map((item) => {
        const box = item.getBoundingClientRect();
        return { width: box.width, height: box.height };
      }),
    );
    for (const box of boxes) {
      expect(box.width).toBeGreaterThanOrEqual(MIN_WIDTH - TOLERANCE);
      expect(box.height).toBeGreaterThanOrEqual(MIN_HEIGHT - TOLERANCE);
    }
  }
  console.log(`[medida] ${inGrid} painéis couberam na grade; o ${total}º ligou a faixa de abas`);
  expect(
    inGrid,
    'ao menos quatro terminais cabem numa janela de 1360 x 840',
  ).toBeGreaterThanOrEqual(4);

  // O layout não coube mais: um painel grande, os outros nas abas, e o aviso da janela pequena.
  await expect(tablist).toBeVisible();
  await expect(tabs(page)).toHaveCount(total);
  await expect(shellPanes(page)).toHaveCount(1);
  await expect(page.getByText('Janela pequena', { exact: true })).toBeVisible();
  // O teclado está no terminal do painel mostrado, e a barra de status diz qual é.
  const focusedTitle = await page.evaluate(
    () =>
      document.activeElement?.closest('.pane')?.querySelector('.pane__title')?.textContent ?? '',
  );
  await expect(statusBarOf(page).getByText(`Foco: ${focusedTitle}`)).toBeVisible();
  await expectOpenSessions(page, total);

  expect(cspViolations(messages), cspViolations(messages).slice(0, 3).join(' | ')).toEqual([]);
  await endShells(page, total);
});

test('com a janela estreita demais para o layout a grade vira a faixa de abas com "Janela pequena", e alargar a janela devolve o layout', async ({
  launchApp,
  gitRepo,
}) => {
  test.setTimeout(240_000);
  const projectName = basename(gitRepo.path);
  const { app, page } = await launchApp({ dialogPath: gitRepo.path });
  const messages: string[] = [];
  page.on('console', (message) => messages.push(`${message.type()}: ${message.text()}`));
  await app.evaluate(({ BrowserWindow }) => {
    BrowserWindow.getAllWindows()[0]?.setSize(1360, 840);
  });
  await addProjectAndOpenWorkspace(page, projectName);
  await hideSidePanels(page);

  const total = 3;
  for (let index = 0; index < total; index += 1) await openShell(page, index);
  const wide = await areaSize(page);
  expect(wide.width, 'a área larga precisa comportar duas colunas').toBeGreaterThan(TWO_COLUMNS);
  const wideShown = total;
  await expect(shellPanes(page)).toHaveCount(wideShown);
  await expect(tabs(page)).toHaveCount(0);
  await expect(page.getByText('Janela pequena', { exact: true })).toHaveCount(0);

  // Estreita: sem largura para duas colunas, o layout não cabe e entra a faixa de abas, um painel por vez, com o
  // aviso (que não é botão).
  await resizeAreaTo(app, page, TWO_COLUMNS - 60, wide.height);
  const narrow = await areaSize(page);
  expect(narrow.width).toBeLessThan(TWO_COLUMNS);
  await expect(tabs(page)).toHaveCount(total);
  await expect(shellPanes(page)).toHaveCount(1);
  await expect(page.getByText('Janela pequena', { exact: true })).toBeVisible();
  // A janela estreita não é escolha da pessoa: "Grade", no seletor do cabeçalho, fica sem efeito.
  await expect(
    page.locator('.project-header').getByRole('button', { name: 'Grade', exact: true }),
  ).toHaveAttribute('aria-disabled', 'true');
  // O terminal mostrado segue vivo no modo estreito.
  await shellPanes(page).locator('.xterm-helper-textarea').focus();
  await page.keyboard.type('Write-Output "estreito-$(2+3)"');
  await page.keyboard.press('Enter');
  await expectTerminalToContain(shellPanes(page).locator('.terminal-view'), 'estreito-5');

  // Alargar de novo devolve a grade, sem a faixa de abas e sem o aviso.
  await resizeAreaTo(app, page, wide.width, wide.height);
  await expect(tabs(page)).toHaveCount(0);
  await expect(page.getByText('Janela pequena', { exact: true })).toHaveCount(0);
  await expect(shellPanes(page)).toHaveCount(wideShown);
  // As sessões sobreviveram ao vai e volta: nenhuma foi encerrada.
  await expectOpenSessions(page, total);

  expect(cspViolations(messages), cspViolations(messages).slice(0, 3).join(' | ')).toEqual([]);
  await endShells(page, total);
});

/** Caixa de um elemento do cabeçalho do projeto, em px de CSS. */
async function boxOf(
  locator: Locator,
): Promise<{ left: number; right: number; top: number; bottom: number }> {
  const box = await locator.boundingBox();
  if (box === null) throw new Error('elemento sem caixa');
  return { left: box.x, right: box.x + box.width, top: box.y, bottom: box.y + box.height };
}

test('com a janela menor, o cabeçalho do projeto compacta e segue numa linha só, sem sobrepor nada', async ({
  launchApp,
  gitRepo,
}) => {
  test.setTimeout(180_000);
  const projectName = basename(gitRepo.path);
  const { app, page } = await launchApp({ dialogPath: gitRepo.path });
  await app.evaluate(({ BrowserWindow }) => {
    BrowserWindow.getAllWindows()[0]?.setSize(1200, 760);
  });
  await addProjectAndOpenWorkspace(page, projectName);
  // Como na janela da pessoa: a barra lateral à vista, o painel direito escondido.
  await page.getByRole('button', { name: 'Ocultar painel direito' }).click();
  await openShell(page, 0);

  const header = page.locator('.project-header');
  const views = header.getByRole('tablist', { name: 'Visões do projeto' });
  const layout = header.getByRole('group', { name: 'Layout dos painéis' });
  const open = header.getByRole('button', { name: 'Abrir terminal' });
  const mission = header.getByRole('button', { name: 'Nova missão' });
  const more = header.getByRole('button', { name: 'Mais ações' });
  const row = [views, layout, open, mission, more];
  /** Tudo numa linha (o centro de cada um na faixa das visões) e em ordem, cada um depois do anterior. */
  const expectOneRow = async (): Promise<void> => {
    const boxes = await Promise.all(row.map((item) => boxOf(item)));
    const band = boxes[0]!;
    for (const [index, box] of boxes.entries()) {
      const middle = (box.top + box.bottom) / 2;
      expect(middle, `item ${index} na linha das visões`).toBeGreaterThan(band.top);
      expect(middle, `item ${index} na linha das visões`).toBeLessThan(band.bottom);
      if (index > 0)
        expect(box.left, `item ${index} depois do anterior`).toBeGreaterThanOrEqual(
          boxes[index - 1]!.right - 1,
        );
    }
  };

  /** A largura do cabeçalho, que decide a compactação (consulta de contêiner), e não a da janela. */
  const headerWidth = async (): Promise<number> =>
    header.evaluate((element) => {
      // A consulta de contêiner mede a caixa de conteúdo: a largura sem o padding.
      const style = getComputedStyle(element);
      return element.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight);
    });
  /** Numa linha, na régua de 28px, com o nome fora dela e cada texto secundário só onde cabe. */
  const expectRow = async (): Promise<void> => {
    await expectOneRow();
    for (const item of [header.getByRole('tab', { name: 'Terminais' }), open, mission, more]) {
      const box = await boxOf(item);
      expect(Math.round(box.bottom - box.top)).toBe(28);
    }
    await expect(header.getByRole('heading', { level: 1, name: projectName })).toHaveCount(1);
    const title = await boxOf(header.locator('.project-header__title'));
    expect(title.right - title.left).toBeLessThanOrEqual(1);
    await expect(more.locator('svg')).toBeVisible();
    const width = await headerWidth();
    const terminalLabel = open.locator('.workspace__open-label');
    const missionLabel = mission.locator('.project-header__new-label');
    if (width > 860) await expect(terminalLabel).toBeVisible();
    else await expect(terminalLabel).toBeHidden();
    const label = await boxOf(missionLabel);
    if (width > 780) expect(label.right - label.left).toBeGreaterThan(1);
    else expect(label.right - label.left).toBeLessThanOrEqual(1);
  };

  // A janela da pessoa, uma larga e a menor: sempre uma linha só, sem sobrepor nada.
  await expectRow();
  for (const [width, height] of [
    [1600, 900],
    [1040, 760],
  ] as const) {
    await app.evaluate(
      ({ BrowserWindow }, size) => {
        BrowserWindow.getAllWindows()[0]?.setSize(size.width, size.height);
      },
      { width, height },
    );
    await expect.poll(async () => Math.round(await headerWidth())).not.toBe(0);
    await page.waitForTimeout(150);
    await expectRow();
  }
  // Na menor, Nova missão é só o + lima: o nome segue no botão e na dica.
  if ((await headerWidth()) <= 780) await expect(mission).toHaveAttribute('title', 'Nova missão');

  await endShells(page, 1);
});

test('com o painel direito aberto numa janela menor, a linha do projeto não quebra: as visões rolam e o "⌄" leva às escondidas', async ({
  launchApp,
  gitRepo,
}) => {
  test.setTimeout(180_000);
  const projectName = basename(gitRepo.path);
  const { app, page } = await launchApp({ dialogPath: gitRepo.path });
  // Como na janela da pessoa: uns 920 px, com a barra lateral e o painel direito à vista.
  await app.evaluate(({ BrowserWindow }) => {
    BrowserWindow.getAllWindows()[0]?.setSize(920, 760);
  });
  await addProjectAndOpenWorkspace(page, projectName);
  await openShell(page, 0);

  const header = page.locator('.project-header');
  const views = header.getByRole('tablist', { name: 'Visões do projeto' });
  const items = [
    views,
    header.getByRole('button', { name: 'Abrir terminal' }),
    header.getByRole('button', { name: 'Nova missão' }),
    header.getByRole('button', { name: 'Mais ações' }),
  ];
  const band = await boxOf(views);
  let previousRight = -Infinity;
  for (const [index, item] of items.entries()) {
    const box = await boxOf(item);
    const middle = (box.top + box.bottom) / 2;
    expect(middle, `item ${index} na linha das visões`).toBeGreaterThan(band.top);
    expect(middle, `item ${index} na linha das visões`).toBeLessThan(band.bottom);
    expect(box.left, `item ${index} depois do anterior`).toBeGreaterThanOrEqual(previousRight - 1);
    previousRight = box.right;
  }
  // As visões que não cabem saem pela borda e o "⌄" as lista; escolher uma troca a visão.
  const more = header.getByRole('button', { name: 'Visões fora de vista' });
  await expect(more).toBeVisible();
  await expect(views).toHaveAttribute('data-fade-end', 'true');
  await more.click();
  await page.getByRole('menuitem', { name: 'Configurações' }).click();
  await expect(views.getByRole('tab', { name: 'Configurações' })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  await expect(views.getByRole('tab', { name: 'Configurações' })).toBeFocused();
  await views.getByRole('tab', { name: 'Configurações' }).press('Home');
  await expect(views.getByRole('tab', { name: 'Terminais' })).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(views.getByRole('tab', { name: 'Terminais' })).toHaveAttribute(
    'aria-selected',
    'true',
  );

  await endShells(page, 1);
});
