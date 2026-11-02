import { mkdir, mkdtemp, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { FilesError } from '../src/main/files/files-error';
import { resolveInProject, toPosixRelative } from '../src/main/files/resolve-in-project';

let base: string;
let root: string;
let outside: string;
let realRoot: string;

beforeEach(async () => {
  base = await mkdtemp(join(tmpdir(), 'Pasta com espaço e acentuação-'));
  root = join(base, 'raiz');
  outside = join(base, 'fora');
  await mkdir(join(root, 'src'), { recursive: true });
  await mkdir(join(root, 'pasta com espaço'), { recursive: true });
  await mkdir(outside, { recursive: true });
  await writeFile(join(root, 'src', 'a.ts'), 'export {};');
  await writeFile(join(outside, 'segredo.txt'), 'segredo');
  realRoot = await realpath(root);
});

afterEach(async () => {
  await rm(base, { recursive: true, force: true });
});

async function expectOutside(relative: string, options?: { allowRoot?: boolean }) {
  const error = await resolveInProject(root, relative, options).then(
    () => undefined,
    (caught: unknown) => caught,
  );
  expect(error).toBeInstanceOf(FilesError);
  expect((error as FilesError).code).toBe('PATH_OUTSIDE_ALLOWED_SCOPE');
}

describe('resolveInProject: caminhos recusados antes de tocar no disco', () => {
  it.each([
    ['vazio sem allowRoot', ''],
    ['o próprio ponto sem allowRoot', '.'],
    ['..', '..'],
    ['sobe e sai', 'a/../../x'],
    ['absoluto POSIX', '/etc/passwd'],
    ['absoluto com unidade', 'C:/Windows'],
    ['unidade sem barra', 'C:'],
    ['UNC', '\\\\servidor\\share'],
    ['barra invertida', 'a\\b'],
    ['fluxo alternativo do NTFS', 'a:fluxo'],
    ['byte nulo', 'a\0b'],
    ['.git', '.git/config'],
    ['.GIT em outra caixa', '.GIT/config'],
    ['.git aninhado', 'sub/.git/hooks/x'],
    ['.git com ponto no fim (o Windows o ignora)', '.git./config'],
  ])('%s', async (_nome, relative) => {
    await expectOutside(relative);
  });

  it('mesmo com allowRoot, só o vazio vale como a raiz', async () => {
    await expectOutside('..', { allowRoot: true });
    await expectOutside('/etc/passwd', { allowRoot: true });
    await expectOutside('.git', { allowRoot: true });
  });
});

describe('resolveInProject: caminhos aceitos', () => {
  it('vazio com allowRoot devolve a raiz real', async () => {
    await expect(resolveInProject(root, '', { allowRoot: true })).resolves.toBe(realRoot);
  });

  it('arquivo existente devolve o caminho real', async () => {
    await expect(resolveInProject(root, 'src/a.ts')).resolves.toBe(join(realRoot, 'src', 'a.ts'));
  });

  it('nome com espaço e acento, mesmo que o arquivo ainda não exista', async () => {
    await expect(resolveInProject(root, 'pasta com espaço/ação.txt')).resolves.toBe(
      join(realRoot, 'pasta com espaço', 'ação.txt'),
    );
  });

  it('caminho aninhado de cerca de 240 caracteres que ainda não existe', async () => {
    const relative = Array.from({ length: 18 }, () => 'dir-aninhado').join('/') + '/arquivo.txt';
    expect(relative.length).toBeGreaterThan(240);
    await expect(resolveInProject(root, relative)).resolves.toBe(
      join(realRoot, ...relative.split('/')),
    );
  });

  it('segmentos "." e barras duplicadas são normalizados', async () => {
    await expect(resolveInProject(root, './src//a.ts')).resolves.toBe(
      join(realRoot, 'src', 'a.ts'),
    );
  });

  it('.gitignore não é .git', async () => {
    await expect(resolveInProject(root, '.gitignore')).resolves.toBe(join(realRoot, '.gitignore'));
  });
});

describe('resolveInProject: links simbólicos e junções', () => {
  it('recusa o link que aponta para fora, e o arquivo atrás dele', async () => {
    await symlink(outside, join(root, 'saida'), 'junction');

    await expectOutside('saida');
    await expectOutside('saida/segredo.txt');
  });

  it('recusa arquivo novo cujo ancestral existente é o link que sai', async () => {
    await symlink(outside, join(root, 'saida'), 'junction');

    await expectOutside('saida/novo.txt');
    await expectOutside('saida/pasta/nova/novo.txt');
  });

  it('recusa o link pendurado (alvo inexistente) que sairia da raiz', async () => {
    await symlink(join(outside, 'nao-existe'), join(root, 'pendurado'), 'junction');

    await expectOutside('pendurado');
    await expectOutside('pendurado/novo.txt');
  });

  it('aceita o link cujo alvo fica dentro e devolve o caminho real', async () => {
    await symlink(join(root, 'src'), join(root, 'atalho'), 'junction');

    await expect(resolveInProject(root, 'atalho/a.ts')).resolves.toBe(
      join(realRoot, 'src', 'a.ts'),
    );
    await expect(resolveInProject(root, 'atalho')).resolves.toBe(join(realRoot, 'src'));
  });

  it('recusa o link cujo alvo real fica dentro de .git', async () => {
    await mkdir(join(root, '.git', 'hooks'), { recursive: true });
    await symlink(join(root, '.git'), join(root, 'atalho-git'), 'junction');

    await expectOutside('atalho-git');
    await expectOutside('atalho-git/hooks/pre-commit');
  });

  it('a raiz que é um link para outra pasta vale pelo alvo', async () => {
    const linkRoot = join(base, 'raiz-link');
    await symlink(root, linkRoot, 'junction');

    await expect(resolveInProject(linkRoot, 'src/a.ts')).resolves.toBe(
      join(realRoot, 'src', 'a.ts'),
    );
  });
});

describe('toPosixRelative', () => {
  it('devolve o caminho relativo com barras normais', () => {
    expect(toPosixRelative(realRoot, join(realRoot, 'src', 'a.ts'))).toBe('src/a.ts');
    expect(toPosixRelative(realRoot, realRoot)).toBe('');
  });
});
