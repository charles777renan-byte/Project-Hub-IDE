import { readFileSync, writeFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import type { Locator, Page } from '@playwright/test';
import { expect } from './fixtures';
import {
  addLocalRemote,
  expectNoViolations,
  runGit,
  watchCsp,
  withIdentity as test,
  writeHook,
} from './git-fixtures';
import { addGitProject, openFileFromPanel, openProject } from './missions';

// A aba Código-fonte na janela real do Electron, com um remoto `--bare` local como `origin` (sem rede): stage e
// desfazer com confirmação, commit e push, pull com a branch atualizada, hook que falha, CSP e a rolagem do editor
// ao trocar entre Arquivo e Alterações. O que vale é o disco (lido com `git` e `fs`), não só a tela.

const A_NOVO = 'conteudo alterado de a\n';
const B_ORIGINAL = 'conteudo original de b\n';
const B_NOVO = 'conteudo alterado de b\n';

/** O conteúdo do arquivo, ou `null` se ele não existe agora (o restore do Git apaga e recria): o poll tenta de novo. */
const readDisk = (path: string): string | null => {
  try {
    return readFileSync(path, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
};

/** Abre o projeto nos Terminais e a aba Código-fonte do painel direito. */
async function openSourceTab(page: Page, projectName: string): Promise<void> {
  await openProject(page, projectName, 'Terminais');
  const tab = page
    .getByRole('complementary', { name: 'Painel direito' })
    .getByRole('tab', { name: 'Código-fonte' });
  await tab.click();
  await expect(tab).toHaveAttribute('aria-selected', 'true');
  await expect(commitMessageField(page)).toBeVisible();
}

const commitMessageField = (page: Page): Locator =>
  page.getByRole('textbox', { name: 'Mensagem do commit' });

/** Abre o menu "Mais ações de commit e remote" e escolhe o item (esperando-o ligado). */
async function chooseMenu(page: Page, name: string): Promise<void> {
  await page.getByRole('button', { name: 'Mais ações de commit e remote' }).click();
  const item = page.getByRole('menuitem', { name, exact: true });
  await expect(item).toBeVisible();
  await expect(item).not.toHaveAttribute('aria-disabled', 'true');
  await item.click();
}

type Setup = { repo: string; remote: string; projectName: string; env: Record<string, string> };

test.describe('Código-fonte com remoto local', () => {
  let setup: Setup;

  test.beforeEach(async ({ gitRepo, dataDir, gitEnv }) => {
    const remote = addLocalRemote(gitRepo.path, dataDir, gitEnv);
    setup = { repo: gitRepo.path, remote, projectName: basename(gitRepo.path), env: gitEnv };
  });

  test('stage e desfazer um arquivo, com confirmação', async ({ launchApp }) => {
    const { repo, projectName, env } = setup;
    // Dois arquivos versionados e alterados: um vai para o stage, o outro é desfeito.
    writeFileSync(join(repo, 'b.txt'), B_ORIGINAL);
    runGit(repo, env, ['add', 'b.txt']);
    runGit(repo, env, ['commit', '--no-verify', '-m', 'adiciona b']);
    writeFileSync(join(repo, 'a.txt'), A_NOVO);
    writeFileSync(join(repo, 'b.txt'), B_NOVO);

    const { page } = await launchApp({ dialogPath: repo });
    await addGitProject(page, projectName);
    await openSourceTab(page, projectName);

    await page.getByRole('button', { name: 'Colocar em stage a.txt' }).click();
    await expect.poll(() => runGit(repo, env, ['diff', '--cached', '--name-only'])).toBe('a.txt');

    await page.getByRole('button', { name: 'Desfazer b.txt' }).click();
    const question = page.getByRole('group', { name: /^Desfazer b\.txt\?/ });
    await expect(question).toBeVisible();
    // Nada foi desfeito antes da confirmação.
    expect(readDisk(join(repo, 'b.txt'))).toBe(B_NOVO);

    // "Voltar" é a saída da confirmação: a pergunta some, o botão Desfazer volta e o disco fica como estava.
    await question.getByRole('button', { name: 'Voltar' }).click();
    await expect(question).toBeHidden();
    await expect(page.getByRole('button', { name: 'Desfazer b.txt' })).toBeVisible();
    // Atualizar relê o Git depois de qualquer escrita que o "Voltar" tivesse disparado: o arquivo segue alterado.
    await page
      .getByRole('complementary', { name: 'Painel direito' })
      .getByRole('button', { name: 'Atualizar' })
      .click();
    await expect(page.getByRole('button', { name: 'Desfazer b.txt' })).toBeVisible();
    expect(readDisk(join(repo, 'b.txt'))).toBe(B_NOVO);
    expect(runGit(repo, env, ['status', '--porcelain', '--', 'b.txt'])).toBe('M b.txt');
    // O arquivo em stage continua em stage: o cancelamento não mexeu em nada.
    expect(runGit(repo, env, ['diff', '--cached', '--name-only'])).toBe('a.txt');

    // De novo, agora confirmando.
    await page.getByRole('button', { name: 'Desfazer b.txt' }).click();
    await expect(question).toBeVisible();
    await question.getByRole('button', { name: 'Desfazer alterações' }).click();

    await expect.poll(() => readDisk(join(repo, 'b.txt'))).toBe(B_ORIGINAL);
    // O arquivo em stage não foi tocado.
    expect(readDisk(join(repo, 'a.txt'))).toBe(A_NOVO);
    expect(runGit(repo, env, ['diff', '--cached', '--name-only'])).toBe('a.txt');
  });

  test('commit e push: o remoto recebe o commit', async ({ launchApp }) => {
    const { repo, remote, projectName, env } = setup;
    writeFileSync(join(repo, 'a.txt'), A_NOVO);

    const { page } = await launchApp({ dialogPath: repo });
    await addGitProject(page, projectName);
    await openSourceTab(page, projectName);

    await page.getByRole('button', { name: 'Colocar em stage a.txt' }).click();
    await commitMessageField(page).fill('feat: altera a pelo painel');
    await page.getByRole('button', { name: 'Commit (1)' }).click();
    await expect
      .poll(() => runGit(repo, env, ['log', '-1', '--format=%s']))
      .toBe('feat: altera a pelo painel');
    // O remoto ainda não tem o commit: o push é uma ação à parte, com confirmação.
    expect(runGit(repo, env, ['--git-dir', remote, 'log', '-1', '--format=%s'])).toBe(
      'commit inicial',
    );

    await chooseMenu(page, 'Push');
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText('feat: altera a pelo painel');
    await dialog.getByRole('button', { name: 'Enviar' }).click();

    await expect
      .poll(() => runGit(repo, env, ['--git-dir', remote, 'log', '-1', '--format=%s']))
      .toBe('feat: altera a pelo painel');
  });

  test('pull com a branch atualizada avisa e não abre diálogo', async ({ launchApp }) => {
    const { repo, projectName } = setup;
    const { page } = await launchApp({ dialogPath: repo });
    await addGitProject(page, projectName);
    await openSourceTab(page, projectName);
    // `toHaveCount(0)` só vê o instante da conferência. O observador guarda qualquer diálogo que abra, mesmo por um
    // instante, até o fim do teste. O `<dialog>` da confirmação fica sempre no DOM e abre pelo atributo `open`.
    await page.evaluate(() => {
      const seen: string[] = [];
      Reflect.set(window, '__dialogsSeen', seen);
      new MutationObserver((records) => {
        for (const record of records) {
          const { target } = record;
          if (record.type === 'attributes' && target instanceof HTMLDialogElement && target.open) {
            seen.push('dialog aberto');
          }
          for (const node of record.addedNodes) {
            if (node instanceof Element && node.matches('[role="dialog"], [role="alertdialog"]')) {
              seen.push('role=dialog adicionado');
            }
          }
        }
      }).observe(document.documentElement, {
        attributes: true,
        attributeFilter: ['open'],
        childList: true,
        subtree: true,
      });
    });

    await chooseMenu(page, 'Pull');
    // O aviso só vem depois de o pull rodar: se pedisse confirmação, ele não apareceria sem um clique do teste.
    await expect(
      page.getByRole('status').filter({ hasText: 'A branch já está atualizada.' }),
    ).toBeVisible();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    expect(await page.evaluate(() => Reflect.get(window, '__dialogsSeen') as string[])).toEqual([]);
  });

  test('hook pre-commit que falha: a saída aparece em texto e nenhum commit sai', async ({
    launchApp,
  }) => {
    const { repo, projectName, env } = setup;
    writeHook(repo, 'pre-commit', 'echo PRECOMMIT-TESTE-FALHOU\nexit 1');
    writeFileSync(join(repo, 'a.txt'), A_NOVO);
    const before = runGit(repo, env, ['rev-list', '--count', 'HEAD']);

    const { page } = await launchApp({ dialogPath: repo });
    await addGitProject(page, projectName);
    await openSourceTab(page, projectName);

    await page.getByRole('button', { name: 'Colocar em stage a.txt' }).click();
    await commitMessageField(page).fill('commit barrado pelo hook');
    await page.getByRole('button', { name: 'Commit (1)' }).click();

    await expect(
      page.getByRole('alert').filter({ hasText: 'PRECOMMIT-TESTE-FALHOU' }),
    ).toBeVisible();
    expect(runGit(repo, env, ['rev-list', '--count', 'HEAD'])).toBe(before);
    // A mensagem digitada continua no campo, para tentar de novo.
    await expect(commitMessageField(page)).toHaveValue('commit barrado pelo hook');
  });

  test('sem violação de CSP com a aba Código-fonte aberta', async ({ launchApp }) => {
    const { repo, remote, projectName, env } = setup;
    writeFileSync(join(repo, 'a.txt'), A_NOVO);
    // Outro clone manda um commit ao remoto: o fetch traz esse commit, e o `↓1` do cabeçalho diz que ele terminou.
    const other = join(dirname(remote), 'outro-clone');
    runGit(dirname(remote), env, ['clone', remote, other]);
    writeFileSync(join(other, 'remoto.txt'), 'veio do remoto\n');
    runGit(other, env, ['add', 'remoto.txt']);
    runGit(other, env, ['commit', '--no-verify', '-m', 'commit vindo do remoto']);
    runGit(other, env, ['push', 'origin', 'main']);

    const { page } = await launchApp({ dialogPath: repo });
    const consoleCsp = await watchCsp(page);
    await addGitProject(page, projectName);
    await openSourceTab(page, projectName);
    await expect(page.getByRole('button', { name: 'Colocar em stage a.txt' })).toBeVisible();
    // Antes do fetch o app ainda não sabe do commit novo.
    const aheadBehind = page.locator('.git-tab__ahead-behind');
    await expect(aheadBehind).toHaveText('↑0 ↓0');
    // O menu também entra na conferência, e a conferência espera o fetch terminar.
    await chooseMenu(page, 'Fetch');
    await expect(aheadBehind).toHaveText('↑0 ↓1');
    await expectNoViolations(page, consoleCsp, { allowXterm: true });
  });

  test('a rolagem do editor volta igual depois de trocar para Alterações e para Arquivo', async ({
    launchApp,
  }) => {
    const { repo, projectName, env } = setup;
    const lines = Array.from(
      { length: 400 },
      (_, i) => `linha numero ${String(i + 1).padStart(3, '0')}`,
    );
    writeFileSync(join(repo, 'longo.txt'), `${lines.join('\n')}\n`);
    runGit(repo, env, ['add', 'longo.txt']);
    runGit(repo, env, ['commit', '--no-verify', '-m', 'adiciona longo']);
    // A alteração fica no disco, sem commit: o diff do arquivo é contra o HEAD, então ela dá ao arquivo um diff.
    lines[4] = 'linha numero 005 alterada';
    writeFileSync(join(repo, 'longo.txt'), `${lines.join('\n')}\n`);

    const { page } = await launchApp({ dialogPath: repo });
    await addGitProject(page, projectName);
    await openProject(page, projectName, 'Terminais');
    await openFileFromPanel(page, 'longo.txt');

    const host = page.locator('.code-editor__host');
    const scroller = host.locator('.cm-scroller');
    await expect(host.getByRole('textbox', { name: 'Editor de longo.txt' })).toContainText(
      'linha numero 001',
    );
    // O texto visível: só as linhas que cruzam a janela do rolador (o CodeMirror mantém no DOM linhas fora dela).
    const snapshot = () =>
      scroller.evaluate((element) => {
        const box = element.getBoundingClientRect();
        const visible = [...element.querySelectorAll('.cm-line')]
          .filter((line) => {
            const rect = line.getBoundingClientRect();
            return rect.bottom > box.top && rect.top < box.bottom;
          })
          .map((line) => line.textContent ?? '');
        return { scrollTop: element.scrollTop, visible };
      });
    await scroller.evaluate((element) => {
      element.scrollTop = 3000;
    });
    // Espera o editor desenhar as linhas da nova posição.
    await expect
      .poll(async () => (await snapshot()).visible.join('\n'))
      .not.toContain('linha numero 001');
    const before = await snapshot();
    expect(before.scrollTop).toBeGreaterThan(1000);
    expect(before.visible.length).toBeGreaterThan(0);
    expect(before.visible).not.toContain('linha numero 001');

    const toggle = page.getByRole('group', { name: 'Modo da aba' });
    const changes = toggle.getByRole('button', { name: 'Alterações' });
    const file = toggle.getByRole('button', { name: 'Arquivo' });
    await changes.click();
    await expect(changes).toHaveAttribute('aria-pressed', 'true');
    // Em Alterações o editor sai do layout e o diff aparece.
    await expect(host).toBeHidden();
    await expect(page.getByLabel('Diff de longo.txt')).toBeVisible();
    await file.click();
    await expect(file).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByLabel('Diff de longo.txt')).toBeHidden();
    await expect(host).toBeVisible();
    await expect(host.getByRole('textbox', { name: 'Editor de longo.txt' })).toBeVisible();

    const after = await snapshot();
    expect(after.scrollTop, `scrollTop antes ${before.scrollTop}, depois ${after.scrollTop}`).toBe(
      before.scrollTop,
    );
    expect(after.visible, 'texto visível').toEqual(before.visible);
  });
});
