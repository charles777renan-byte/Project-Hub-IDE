import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from './fixtures';
import { withIdentity } from './git-fixtures';
import { addGitProject, projectLink, statusBarOf, viewTab } from './missions';

// Criar o repositório Git de uma pasta sem Git pelo aviso da visão Missões (ADR 0009): a prévia, a confirmação
// com o que a pasta tem, o primeiro commit e a lista da barra lateral trazendo o projeto já como Git.

const PROJECT_NAME = 'app-sem-git';
const NO_GIT_NOTICE = 'não é um repositório Git';

/** Uma pasta de projeto comum, sem Git, com um arquivo de segredo para a confirmação mostrar. */
function plainFolder(dataDir: string): string {
  const folder = join(dataDir, PROJECT_NAME);
  mkdirSync(folder);
  writeFileSync(join(folder, 'index.ts'), 'export {};\n');
  writeFileSync(join(folder, '.env'), 'TOKEN=segredo\n');
  return folder;
}

withIdentity(
  'criar o repositório pelo aviso confirma, faz o primeiro commit sem o .env e tira o aviso',
  async ({ launchApp, dataDir, gitEnv }) => {
    const folder = plainFolder(dataDir);
    const { page } = await launchApp({ dialogPath: folder });
    await addGitProject(page, PROJECT_NAME);
    await projectLink(page, PROJECT_NAME).click();
    await expect(page.getByRole('heading', { level: 1, name: PROJECT_NAME })).toBeVisible();
    // Abrir o projeto cai nos Terminais; o aviso e o botão ficam nas Missões.
    await viewTab(page, 'Missões').click();
    await expect(page.getByText(NO_GIT_NOTICE)).toBeVisible();

    await page.getByRole('button', { name: 'Criar repositório Git' }).click();
    // A confirmação diz o que vai acontecer e mostra o arquivo de segredo que a pasta tem.
    const question = page.getByRole('group', { name: /^Cria o repositório Git nesta pasta/ });
    await expect(question).toBeVisible();
    await expect(question).toHaveAttribute('aria-label', /Atenção: \.env tem nome de segredo/);
    await question.getByRole('button', { name: 'Criar e fazer o primeiro commit' }).click();

    // Depois do commit, a barra lateral recarrega: o aviso some e a barra de status mostra a branch.
    await expect(page.getByText(NO_GIT_NOTICE)).toHaveCount(0);
    await expect(statusBarOf(page).getByText(`${PROJECT_NAME} · main`)).toBeVisible();

    // No disco: o repositório existe, o .gitignore básico foi criado, e o commit leva o código mas não o .env.
    expect(existsSync(join(folder, '.git'))).toBe(true);
    const env = { ...process.env, ...gitEnv };
    const subject = execFileSync('git', ['log', '-1', '--format=%s'], {
      cwd: folder,
      env,
      encoding: 'utf8',
    });
    expect(subject.trim()).toBe('Estado inicial do projeto');
    const tracked = execFileSync('git', ['ls-files'], { cwd: folder, env, encoding: 'utf8' });
    expect(tracked.split('\n')).toContain('index.ts');
    expect(tracked.split('\n')).not.toContain('.env');
  },
);

test('sem identidade no Git, o aviso diz o que configurar e não cria nada', async ({
  launchApp,
  dataDir,
}) => {
  const folder = plainFolder(dataDir);
  const { page } = await launchApp({ dialogPath: folder });
  await addGitProject(page, PROJECT_NAME);
  await projectLink(page, PROJECT_NAME).click();
  await expect(page.getByRole('heading', { level: 1, name: PROJECT_NAME })).toBeVisible();
  await viewTab(page, 'Missões').click();

  await page.getByRole('button', { name: 'Criar repositório Git' }).click();

  await expect(
    page.getByRole('alert').filter({ hasText: 'git config --global user.name' }),
  ).toBeVisible();
  await expect(page.getByRole('button', { name: 'Criar e fazer o primeiro commit' })).toHaveCount(
    0,
  );
  await expect(page.getByText(NO_GIT_NOTICE)).toBeVisible();
  expect(existsSync(join(folder, '.git'))).toBe(false);
});
