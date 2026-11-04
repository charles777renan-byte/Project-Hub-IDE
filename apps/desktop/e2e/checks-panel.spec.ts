import { existsSync, readFileSync } from 'node:fs';
import { basename } from 'node:path';
import type { Locator, Page } from '@playwright/test';
import type { TempRepo } from '@project-hub/test-utils';
import { expect, FAKE_GH, test, type LaunchedApp, type LaunchOptions } from './fixtures';
import { expectNoViolations, runGit, watchCsp } from './git-fixtures';
import { addGitProject, openProject } from './missions';

// A aba Checks na janela real do Electron construído, com o `gh` FALSO (o mesmo dos testes do adaptador): o app só
// aceita `PROJECT_HUB_GH_BIN` com `PROJECT_HUB_ENV=test`, e a fixture o liga sempre. O falso grava o argv de cada
// chamada em `ghLog`, e as escritas (comentar, mesclar) são conferidas lá, nunca num GitHub de verdade. O
// repositório é o descartável da fixture `gitRepo`, com um `origin` do github.com que nada acessa (o `gh` falso
// responde tudo; o Git só lê a URL).

const TITLE = 'feat(desktop): redesenha a Visão geral do Início em colunas';
const ORIGIN = 'https://github.com/exemplo/repositorio.git';

type GhCall = { argv: string[]; cwd: string };

/** As chamadas que o `gh` falso gravou, na ordem. Sem arquivo, o falso nunca rodou. */
function ghCalls(ghLog: string): GhCall[] {
  if (!existsSync(ghLog)) return [];
  return readFileSync(ghLog, 'utf8')
    .split('\n')
    .filter((line) => line !== '')
    .map((line) => JSON.parse(line) as GhCall);
}

/** As chamadas de escrita (`pr comment` e `pr merge`), que são as únicas que mudam algo no GitHub. */
function writes(ghLog: string): string[][] {
  return ghCalls(ghLog)
    .map((call) => call.argv)
    .filter((argv) => argv[0] === 'pr' && (argv[1] === 'comment' || argv[1] === 'merge'));
}

/**
 * Antes de qualquer escrita: o `gh` do processo principal é o falso. Com `PROJECT_HUB_ENV=test` e
 * `PROJECT_HUB_GH_BIN` no falso, o app executa o script e nunca o `gh` do PATH.
 */
async function expectFakeGh(app: LaunchedApp['app']): Promise<void> {
  const env = await app.evaluate(() => ({
    mode: process.env['PROJECT_HUB_ENV'],
    bin: process.env['PROJECT_HUB_GH_BIN'],
  }));
  expect(env.mode).toBe('test');
  expect(env.bin).toBe(FAKE_GH);
  expect(basename(FAKE_GH)).toBe('fake-gh.mjs');
}

const panelOf = (page: Page): Locator =>
  page.getByRole('complementary', { name: 'Painel direito' });
const tabsOf = (page: Page): Locator =>
  panelOf(page).getByRole('tablist', { name: 'Painéis laterais' });
/** A aba Checks pelo nome exato (o ponto de estado entra no nome: "Checks: tudo certo"). */
const checksTab = (page: Page, name = 'Checks'): Locator =>
  tabsOf(page).getByRole('tab', { name, exact: true });
const dotOf = (page: Page): Locator => tabsOf(page).locator('.right-panel__dot');

type Setup = {
  launchApp: (options?: LaunchOptions) => Promise<LaunchedApp>;
  gitRepo: TempRepo;
  gitEnv: Record<string, string>;
};

/** Prepara o repositório do teste, abre o app com o cenário do `gh` falso e deixa o projeto aberto (visão Terminais). */
async function openChecksProject(
  { launchApp, gitRepo, gitEnv }: Setup,
  options: Omit<LaunchOptions, 'dialogPath' | 'ghHead'>,
  withCsp = false,
): Promise<{ launched: LaunchedApp; page: Page; consoleCsp: string[] }> {
  runGit(gitRepo.path, gitEnv, ['remote', 'add', 'origin', ORIGIN]);
  const launched = await launchApp({ ...options, dialogPath: gitRepo.path, ghHead: 'main' });
  const { page } = launched;
  const consoleCsp = withCsp ? await watchCsp(page) : [];
  const projectName = basename(gitRepo.path);
  await addGitProject(page, projectName);
  await openProject(page, projectName, 'Terminais');
  return { launched, page, consoleCsp };
}

/** O que a cor do token (`--cyan`, `--danger`) vale na janela, para conferir o ponto pela cor de verdade. */
async function tokenColor(page: Page, token: string): Promise<string> {
  return page.evaluate((name) => {
    const probe = document.createElement('span');
    probe.style.color = `var(${name})`;
    document.body.append(probe);
    const color = getComputedStyle(probe).color;
    probe.remove();
    return color;
  }, token);
}

test('PR aberto e mesclável com checks verdes: o PR na aba e o ponto "Checks: tudo certo"', async ({
  launchApp,
  gitRepo,
  gitEnv,
}) => {
  const { page } = await openChecksProject(
    { launchApp, gitRepo, gitEnv },
    { ghScenario: 'open-green' },
  );
  await checksTab(page, 'Checks: tudo certo').click();

  const panel = panelOf(page);
  await expect(panel.getByText(TITLE)).toBeVisible();
  await expect(panel.getByRole('button', { name: 'Abrir o PR #47 no GitHub' })).toHaveText('#47');
  await expect(panel.getByText('Aberto', { exact: true })).toBeVisible();
  await expect(panel.getByText('main → main', { exact: true })).toBeVisible();
  await expect(panel.getByRole('button', { name: 'Mesclar com commit de merge' })).toBeVisible();
  await expect(panel.getByText('7 com sucesso')).toBeVisible();

  // O ponto: um só, na aba Checks, com a cor do token e o texto no nome acessível (nunca só a cor).
  await expect(dotOf(page)).toHaveCount(1);
  const dot = checksTab(page, 'Checks: tudo certo').locator('.right-panel__dot');
  await expect(dot).toHaveClass(/right-panel__dot--ok/u);
  await expect(dot).toHaveCSS('background-color', await tokenColor(page, '--cyan'));
  await expect(checksTab(page, 'Checks: tudo certo')).toHaveAttribute('aria-selected', 'true');
});

test('PR com um check falho: o ponto vermelho, "Checks: 1 falhou" e nada de mesclar', async ({
  launchApp,
  gitRepo,
  gitEnv,
}) => {
  const { page } = await openChecksProject(
    { launchApp, gitRepo, gitEnv },
    { ghScenario: 'open-failing' },
  );
  await checksTab(page, 'Checks: 1 falhou').click();

  const panel = panelOf(page);
  await expect(panel.getByText(TITLE)).toBeVisible();
  await expect(panel.getByText('1 falhou')).toBeVisible();
  await expect(panel.getByText('6 com sucesso')).toBeVisible();
  await expect(panel.getByRole('button', { name: /^Mesclar com/u })).toHaveCount(0);

  await expect(dotOf(page)).toHaveCount(1);
  const dot = checksTab(page, 'Checks: 1 falhou').locator('.right-panel__dot');
  await expect(dot).toHaveClass(/right-panel__dot--failed/u);
  await expect(dot).toHaveCSS('background-color', await tokenColor(page, '--danger'));
});

test('sem PR: o estado "Esta branch não tem PR" e nenhum ponto', async ({
  launchApp,
  gitRepo,
  gitEnv,
}) => {
  const { page } = await openChecksProject({ launchApp, gitRepo, gitEnv }, { ghScenario: 'no-pr' });
  await checksTab(page).click();

  await expect(panelOf(page).getByText('Esta branch não tem PR')).toBeVisible();
  await expect(dotOf(page)).toHaveCount(0);
  await expect(checksTab(page)).toHaveAttribute('aria-selected', 'true');
});

test('sem o GitHub CLI: a mensagem "GitHub CLI não encontrado", o endereço em texto e nenhum ponto', async ({
  launchApp,
  gitRepo,
  gitEnv,
  ghLog,
}) => {
  const { page } = await openChecksProject({ launchApp, gitRepo, gitEnv }, { ghMissing: true });
  await checksTab(page).click();

  const panel = panelOf(page);
  await expect(panel.getByText('GitHub CLI não encontrado')).toBeVisible();
  await expect(panel.locator('code', { hasText: 'https://cli.github.com/' })).toBeVisible();
  await expect(panel.getByRole('button', { name: 'Tentar de novo' })).toBeVisible();
  await expect(dotOf(page)).toHaveCount(0);
  // O falso não foi ligado, e o PATH não tinha o `gh`: nenhuma chamada gravada.
  expect(ghCalls(ghLog)).toEqual([]);
});

test('sem login no GitHub CLI: a orientação "gh auth login" e nenhum ponto', async ({
  launchApp,
  gitRepo,
  gitEnv,
}) => {
  const { page } = await openChecksProject(
    { launchApp, gitRepo, gitEnv },
    { ghScenario: 'unauthenticated' },
  );
  await checksTab(page).click();

  const panel = panelOf(page);
  await expect(panel.getByText(/Faça\s+gh auth login\s+no terminal/u)).toBeVisible();
  await expect(panel.locator('code', { hasText: 'gh auth login' })).toBeVisible();
  await expect(panel.getByRole('button', { name: 'Tentar de novo' })).toBeVisible();
  await expect(dotOf(page)).toHaveCount(0);
});

const COMMENT = 'Revisão ok - pode seguir\nsegunda linha  ';
const COMMENT_SENT = 'Revisão ok - pode seguir\nsegunda linha';

test('comentar: a confirmação mostra o texto e só depois o `gh` recebe o comentário exato', async ({
  launchApp,
  gitRepo,
  gitEnv,
  ghLog,
}) => {
  const { launched, page } = await openChecksProject(
    { launchApp, gitRepo, gitEnv },
    { ghScenario: 'open-green' },
  );
  await checksTab(page, 'Checks: tudo certo').click();
  const panel = panelOf(page);
  const field = panel.getByRole('textbox', { name: 'Novo comentário' });
  const send = panel.getByRole('button', { name: 'Enviar', exact: true });
  await expect(send).toBeDisabled();
  await field.fill(COMMENT);
  await send.click();

  // A confirmação aparece com o texto de prévia; até aqui nada foi escrito.
  const dialog = page.getByRole('dialog', { name: /Publicar este comentário no PR #47/u });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByText(/Revisão ok - pode seguir\s+segunda linha/u)).toBeVisible();
  expect(writes(ghLog)).toEqual([]);

  await expectFakeGh(launched.app);
  await dialog.getByRole('button', { name: 'Publicar', exact: true }).click();
  await expect(panel.getByText('Comentário publicado.')).toBeVisible();
  await expect(dialog).toBeHidden();
  await expect(field).toHaveValue('');

  // O argv gravado: o texto vai colado ao `--body=`, num argumento só, sem os espaços do fim.
  expect(writes(ghLog)).toEqual([['pr', 'comment', '47', `--body=${COMMENT_SENT}`]]);
});

test('comentar: cancelar a confirmação não envia nada e o texto continua no campo', async ({
  launchApp,
  gitRepo,
  gitEnv,
  ghLog,
}) => {
  const { page } = await openChecksProject(
    { launchApp, gitRepo, gitEnv },
    { ghScenario: 'open-green' },
  );
  await checksTab(page, 'Checks: tudo certo').click();
  const panel = panelOf(page);
  const field = panel.getByRole('textbox', { name: 'Novo comentário' });
  await field.fill('não envie isto');
  await panel.getByRole('button', { name: 'Enviar', exact: true }).click();

  const dialog = page.getByRole('dialog', { name: /Publicar este comentário no PR #47/u });
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: 'Cancelar' }).click();

  await expect(dialog).toBeHidden();
  await expect(field).toHaveValue('não envie isto');
  await expect(panel.getByText('Comentário publicado.')).toHaveCount(0);
  expect(writes(ghLog)).toEqual([]);
});

test('mesclar: escolher squash no menu da seta, confirmar e ver `--squash` no argv', async ({
  launchApp,
  gitRepo,
  gitEnv,
  ghLog,
}) => {
  const { launched, page } = await openChecksProject(
    { launchApp, gitRepo, gitEnv },
    { ghScenario: 'open-green' },
  );
  await checksTab(page, 'Checks: tudo certo').click();
  const panel = panelOf(page);
  await expect(panel.getByRole('button', { name: 'Mesclar com commit de merge' })).toBeVisible();

  await panel.getByRole('button', { name: 'Escolher a forma de mesclar' }).click();
  await panel.getByRole('menuitemradio', { name: 'squash' }).click();
  const merge = panel.getByRole('button', { name: 'Mesclar com squash' });
  await expect(merge).toBeVisible();
  await merge.click();

  const dialog = page.getByRole('dialog', { name: 'Mesclar o PR #47 em main com squash?' });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByText(TITLE)).toBeVisible();
  expect(writes(ghLog)).toEqual([]);

  await expectFakeGh(launched.app);
  await dialog.getByRole('button', { name: 'Mesclar', exact: true }).click();
  await expect(panel.getByText('PR mesclado.')).toBeVisible();
  await expect(dialog).toBeHidden();

  // Só a forma escolhida, sem `--admin`, `--auto` nem `--delete-branch`.
  expect(writes(ghLog)).toEqual([['pr', 'merge', '47', '--squash']]);
});

test('mesclar: cancelar a confirmação não envia nada', async ({
  launchApp,
  gitRepo,
  gitEnv,
  ghLog,
}) => {
  const { page } = await openChecksProject(
    { launchApp, gitRepo, gitEnv },
    { ghScenario: 'open-green' },
  );
  await checksTab(page, 'Checks: tudo certo').click();
  const panel = panelOf(page);
  await panel.getByRole('button', { name: 'Mesclar com commit de merge' }).click();
  const dialog = page.getByRole('dialog', { name: /Mesclar o PR #47 em main/u });
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: 'Cancelar' }).click();
  await expect(dialog).toBeHidden();
  expect(writes(ghLog)).toEqual([]);
});

test('o ponto de estado fica na barra com a aba Checks fechada', async ({
  launchApp,
  gitRepo,
  gitEnv,
}) => {
  const { page } = await openChecksProject(
    { launchApp, gitRepo, gitEnv },
    { ghScenario: 'open-failing' },
  );
  // A aba aberta é Arquivos (a padrão): o PR é lido mesmo assim, e o botão Checks traz o ponto e o texto.
  await expect(tabsOf(page).getByRole('tab', { name: 'Arquivos' })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  const tab = checksTab(page, 'Checks: 1 falhou');
  await expect(tab).toBeVisible();
  await expect(tab).toHaveAttribute('aria-selected', 'false');
  await expect(tab.locator('.right-panel__dot--failed')).toHaveCount(1);
  await expect(panelOf(page).getByText(TITLE)).toHaveCount(0);
});

test('a aba Checks não gera violação de CSP, nem com a confirmação e o menu abertos', async ({
  launchApp,
  gitRepo,
  gitEnv,
}) => {
  const { page, consoleCsp } = await openChecksProject(
    { launchApp, gitRepo, gitEnv },
    { ghScenario: 'open-green' },
    true,
  );
  await checksTab(page, 'Checks: tudo certo').click();
  const panel = panelOf(page);
  await expect(panel.getByText(TITLE)).toBeVisible();
  await panel.getByRole('button', { name: 'Escolher a forma de mesclar' }).click();
  await expect(panel.getByRole('menu', { name: 'Forma de mesclar' })).toBeVisible();
  await panel.getByRole('menuitemradio', { name: 'rebase' }).click();
  await panel.getByRole('button', { name: 'Mesclar com rebase' }).click();
  const dialog = page.getByRole('dialog', { name: /Mesclar o PR #47/u });
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: 'Cancelar' }).click();
  await expect(dialog).toBeHidden();

  await expectNoViolations(page, consoleCsp, { allowXterm: true });
});

test('foco visível: o Tab chega ao botão de mesclar com o anel de foco', async ({
  launchApp,
  gitRepo,
  gitEnv,
}) => {
  const { page } = await openChecksProject(
    { launchApp, gitRepo, gitEnv },
    { ghScenario: 'open-green' },
  );
  await checksTab(page, 'Checks: tudo certo').click();
  const panel = panelOf(page);
  const merge = panel.getByRole('button', { name: 'Mesclar com commit de merge' });
  await expect(merge).toBeVisible();

  // Parte do botão Atualizar e segue pelo teclado até o botão de mesclar.
  await panel.getByRole('button', { name: 'Atualizar' }).focus();
  let reached = false;
  for (let step = 0; step < 12 && !reached; step += 1) {
    await page.keyboard.press('Tab');
    reached = await merge.evaluate((element) => element === document.activeElement);
  }
  expect(reached, 'o Tab chegou ao botão de mesclar').toBe(true);

  const ring = await merge.evaluate((element) => {
    const style = getComputedStyle(element);
    return {
      visible: element.matches(':focus-visible'),
      style: style.outlineStyle,
      width: Number.parseFloat(style.outlineWidth),
    };
  });
  expect(ring.visible, 'recebeu o foco pelo teclado').toBe(true);
  expect(ring.style).not.toBe('none');
  expect(ring.width).toBeGreaterThan(0);
});
