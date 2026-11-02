import { basename } from 'node:path';
import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';
import { addGitProject, createMission, openProject, orchestrate, viewTab } from './missions';
import { expectOpenSessions, expectTerminalToContain, terminalSize } from './terminals';

// As transições das abas na janela real (styles/motion.css). O jsdom não anima, então aqui se prova que a animação
// toca (o evento `animationstart` chega com o nome esperado), que ela some com "reduzir movimento" e que o terminal
// montado por baixo não é remedido enquanto o painel aparece (o motivo de a entrada dos terminais ser só opacidade).
// Também as listas (list-motion.ts, com o AutoAnimate): quem entra e quem sai se move, sem largura nem altura.

declare global {
  interface Window {
    __animacoes?: string[];
  }
}

/** Passa a anotar o nome de cada animação CSS que começa na página. */
async function anotarAnimacoes(page: Page): Promise<void> {
  await page.evaluate(() => {
    window.__animacoes = [];
    document.addEventListener(
      'animationstart',
      (event) => window.__animacoes?.push(event.animationName),
      true,
    );
  });
}

async function animacoesDesdeAAnotacao(page: Page): Promise<string[]> {
  return page.evaluate(() => window.__animacoes ?? []);
}

test('trocar de visão e de aba do topo anima a entrada; a pílula da aba ativa acende', async ({
  launchApp,
  gitRepo,
}) => {
  const projectName = basename(gitRepo.path);
  const { page } = await launchApp({ dialogPath: gitRepo.path });
  await addGitProject(page, projectName);
  await openProject(page, projectName, 'Terminais');
  await anotarAnimacoes(page);

  // Missões é um painel que rola sozinho: sobe e aparece.
  await viewTab(page, 'Missões').click();
  await expect(viewTab(page, 'Missões')).toHaveAttribute('aria-selected', 'true');
  await expect.poll(() => animacoesDesdeAAnotacao(page)).toContain('panel-in');

  // A pílula é o ::before da aba: acesa na ativa, apagada na outra.
  await expect
    .poll(async () =>
      viewTab(page, 'Missões').evaluate((tab) => getComputedStyle(tab, '::before').opacity),
    )
    .toBe('1');
  await expect(
    viewTab(page, 'Terminais').evaluate((tab) => getComputedStyle(tab, '::before').opacity),
  ).resolves.toBe('0');

  // Voltar a Terminais só muda a opacidade (o xterm mede a área).
  await page.evaluate(() => {
    window.__animacoes = [];
  });
  await viewTab(page, 'Terminais').click();
  await expect.poll(() => animacoesDesdeAAnotacao(page)).toContain('panel-fade');
  expect(await animacoesDesdeAAnotacao(page)).not.toContain('panel-in');

  // Ir ao Início monta outra página, que aparece.
  await page.evaluate(() => {
    window.__animacoes = [];
  });
  await page.getByRole('link', { name: 'Início', exact: true }).click();
  await expect(page).toHaveURL(/#\/$/);
  await expect.poll(() => animacoesDesdeAAnotacao(page)).toContain('panel-fade');
});

test('com "reduzir movimento" nenhuma entrada anima e a pílula troca na hora', async ({
  launchApp,
  gitRepo,
}) => {
  const projectName = basename(gitRepo.path);
  const { page } = await launchApp({ dialogPath: gitRepo.path });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await addGitProject(page, projectName);
  await openProject(page, projectName, 'Terminais');
  await anotarAnimacoes(page);

  await viewTab(page, 'Missões').click();
  await expect(viewTab(page, 'Missões')).toHaveAttribute('aria-selected', 'true');
  await page.getByRole('link', { name: 'Início', exact: true }).click();
  await expect(page).toHaveURL(/#\/$/);
  // Espera mais que a duração de uma animação (180ms) antes de concluir que nenhuma começou.
  await page.waitForTimeout(400);
  expect(await animacoesDesdeAAnotacao(page)).toEqual([]);
  await expect(page.evaluate(() => document.getAnimations().length)).resolves.toBe(0);
});

/**
 * Passa a anotar cada animação da Web Animations API que toca na página (o AutoAnimate cria `new Animation` e
 * chama `play`), com a classe do alvo e as propriedades dos quadros, e as recusas da CSP.
 */
async function anotarListas(page: Page): Promise<void> {
  await page.evaluate(() => {
    const w = window as unknown as { __listas: string[][]; __csp: string[] };
    w.__listas = [];
    w.__csp = [];
    document.addEventListener('securitypolicyviolation', (event) => {
      w.__csp.push(`${event.violatedDirective} ${event.blockedURI}`);
    });
    const play = Animation.prototype.play;
    Animation.prototype.play = function (this: Animation) {
      const effect = this.effect as KeyframeEffect | null;
      const target = effect?.target;
      if (target instanceof Element && target.parentElement?.matches('.mission-progress')) {
        const keys = (effect?.getKeyframes() ?? []).flatMap((frame) =>
          Object.keys(frame).filter(
            (key) => !['offset', 'easing', 'composite', 'computedOffset'].includes(key),
          ),
        );
        w.__listas.push([...new Set(keys)].sort());
      }
      play.call(this);
    };
  });
}

test('a lista de missões anima quem entra e quem sai, só com opacidade e transform, sem recusa da CSP', async ({
  launchApp,
  gitRepo,
}) => {
  const projectName = basename(gitRepo.path);
  const { page } = await launchApp({ dialogPath: gitRepo.path });
  await addGitProject(page, projectName);
  await openProject(page, projectName);
  // Uma missão que pede a pessoa (plano à espera) e outra em rascunho, que não pede.
  await createMission(page, {
    title: 'Missão que espera',
    objective: 'Ficar à espera da aprovação do plano.',
    criterion: 'Aparece no filtro de atenção',
  });
  await orchestrate(page);
  await openProject(page, projectName);
  await createMission(page, {
    title: 'Missão em rascunho',
    objective: 'Ficar em rascunho.',
    criterion: 'Some do filtro de atenção',
  });

  await page.getByRole('link', { name: 'Início', exact: true }).click();
  const missions = page.getByRole('region', { name: 'Missões' });
  await expect(missions.getByRole('link', { name: 'Missão em rascunho' })).toBeVisible();
  await anotarListas(page);
  // O AutoAnimate só guarda a posição de um item 500 ms depois de ele aparecer (o plugin é uma função), e sem
  // a posição não anima a saída. Sem esta espera o filtro pode chegar antes e o item sai sem se apagar.
  await page.waitForTimeout(700);

  // O filtro tira o rascunho da lista (sai apagando) e a lista se reacomoda.
  await missions.getByRole('button', { name: 'Aguarda você' }).click();
  await expect(missions.getByRole('link', { name: 'Missão em rascunho' })).toHaveCount(0);
  // Limpar o filtro devolve o rascunho (entra subindo).
  await missions.getByRole('button', { name: 'Limpar filtro' }).click();
  await expect(missions.getByRole('link', { name: 'Missão em rascunho' })).toBeVisible();

  const vistas = await page.evaluate(
    () => (window as unknown as { __listas: string[][] }).__listas,
  );
  expect(vistas.length).toBeGreaterThan(0);
  expect(vistas).toContainEqual(['opacity']);
  expect(vistas).toContainEqual(['opacity', 'transform']);
  for (const keys of vistas) {
    expect(
      keys.every((key) => key === 'opacity' || key === 'transform'),
      keys.join(','),
    ).toBe(true);
  }
  expect(await page.evaluate(() => (window as unknown as { __csp: string[] }).__csp)).toEqual([]);
});

test('o terminal montado por baixo não muda de tamanho enquanto a visão Terminais reaparece', async ({
  launchApp,
  gitRepo,
}) => {
  test.skip(process.platform !== 'win32', 'o shell do teste é o PowerShell');
  test.setTimeout(120_000);
  const projectName = basename(gitRepo.path);
  const { page } = await launchApp({ dialogPath: gitRepo.path });
  await addGitProject(page, projectName);
  await openProject(page, projectName, 'Terminais');

  const pane = page.getByRole('region', { name: 'Painel PowerShell' });
  await page.getByRole('button', { name: 'Abrir terminal' }).click();
  await page.getByRole('menuitem', { name: /PowerShell/ }).click();
  await expect(pane).toHaveCount(1);
  const view = pane.locator('.terminal-view');
  await expectTerminalToContain(view, 'PS ', { timeout: 30_000 });

  try {
    const antes = await terminalSize(view);
    expect(antes).not.toBeNull();

    await viewTab(page, 'Missões').click();
    await expect(viewTab(page, 'Missões')).toHaveAttribute('aria-selected', 'true');
    await viewTab(page, 'Terminais').click();
    await expect(pane).toHaveCount(1);

    // Amostra o tamanho a cada quadro durante a entrada (180ms) e um pouco além: as colunas e as linhas nunca
    // mudam, nem um instante, porque o painel só se desvanece e o xterm não é remedido.
    const amostras = await page.evaluate(
      () =>
        new Promise<string[]>((resolve) => {
          const seen: string[] = [];
          const started = performance.now();
          const tick = () => {
            const host = document.querySelector('.terminal-view');
            const box = host?.getBoundingClientRect();
            if (box !== undefined) seen.push(`${Math.round(box.width)}x${Math.round(box.height)}`);
            if (performance.now() - started < 400) requestAnimationFrame(tick);
            else resolve(seen);
          };
          requestAnimationFrame(tick);
        }),
    );
    // A caixa da área não se mexe: nenhuma amostra difere da última (a da área já assentada).
    expect(new Set(amostras).size, `caixas vistas: ${[...new Set(amostras)].join(' | ')}`).toBe(1);

    const depois = await terminalSize(view);
    expect(depois?.cols).toBe(antes?.cols);
    expect(depois?.rows).toBe(antes?.rows);
  } finally {
    const closeButton = page
      .getByRole('region', { name: 'Painel PowerShell' })
      .getByRole('button', { name: 'Fechar painel', exact: true });
    if ((await closeButton.count()) === 0) await viewTab(page, 'Terminais').click();
    await closeButton.click();
    await expect(page.getByRole('region', { name: 'Painel PowerShell' })).toHaveCount(0);
    await expectOpenSessions(page, 0);
  }
});

test('abrir um terminal faz o painel crescer e aparecer; fechar o encolhe antes de ele sair', async ({
  launchApp,
  gitRepo,
}) => {
  test.skip(process.platform !== 'win32', 'o shell do teste é o PowerShell');
  test.setTimeout(120_000);
  const projectName = basename(gitRepo.path);
  const { page } = await launchApp({ dialogPath: gitRepo.path });
  await addGitProject(page, projectName);
  await openProject(page, projectName, 'Terminais');
  await anotarAnimacoes(page);

  const pane = page.getByRole('region', { name: 'Painel PowerShell' });
  await page.getByRole('button', { name: 'Abrir terminal' }).click();
  await page.getByRole('menuitem', { name: /PowerShell/ }).click();
  await expect(pane).toHaveCount(1);
  await expect.poll(() => animacoesDesdeAAnotacao(page)).toContain('pane-in');
  await expectTerminalToContain(pane.locator('.terminal-view'), 'PS ', { timeout: 30_000 });

  await page.evaluate(() => {
    window.__animacoes = [];
  });
  await pane.getByRole('button', { name: 'Fechar painel', exact: true }).click();
  await expect.poll(() => animacoesDesdeAAnotacao(page)).toContain('pane-out');
  await expect(pane).toHaveCount(0);
  await expectOpenSessions(page, 0);
});
