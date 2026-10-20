import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, sep } from 'node:path';
import { createTempRepo, type TempRepo } from '@project-hub/test-utils';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createGitDetector } from '../src/detect';

// Git real. As pastas "sem Git" são criadas na pasta temporária do sistema, fora do projeto: dentro
// do projeto, o Git acharia o repositório do Project Hub por um diretório acima.

const repos: TempRepo[] = [];
const folders: string[] = [];

function repo(): TempRepo {
  const made = createTempRepo();
  repos.push(made);
  return made;
}

/** Pasta comum, fora de qualquer repositório. */
function plainFolder(name = 'project-hub-sem-git-'): string {
  const folder = mkdtempSync(join(tmpdir(), name));
  folders.push(folder);
  return folder;
}

function git(cwd: string, ...args: string[]): string {
  return execFileSync('git', args, {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
}

afterEach(() => {
  vi.unstubAllEnvs();
  for (const made of repos.splice(0)) made.cleanup();
  for (const folder of folders.splice(0)) rmSync(folder, { recursive: true, force: true });
});

const detector = createGitDetector();

describe('createGitDetector', () => {
  it('pasta sem Git retorna kind none, sem branch', async () => {
    expect(await detector.detect(plainFolder())).toEqual({ kind: 'none' });
  });

  it('repositório retorna kind git e defaultBranch', async () => {
    const { path } = repo();

    expect(await detector.detect(path)).toEqual({ kind: 'git', defaultBranch: 'main' });
  });

  // R199: só a raiz da árvore de trabalho é projeto Git. Sem isto, um repositório de dotfiles na pasta
  // pessoal faria toda pasta abaixo dela entrar como `git`.
  it('subpasta de um repositório conta como sem Git', async () => {
    const { path } = repo();
    mkdirSync(join(path, 'pacote'));

    expect(await detector.detect(join(path, 'pacote'))).toEqual({ kind: 'none' });
  });

  it('subpasta funda de um repositório também conta como sem Git', async () => {
    const { path } = repo();
    mkdirSync(join(path, 'apps', 'web', 'src'), { recursive: true });

    expect(await detector.detect(join(path, 'apps', 'web', 'src'))).toEqual({ kind: 'none' });
  });

  it('subpasta de um repositório sem commits conta como sem Git', async () => {
    const folder = plainFolder('project-hub-vazio-');
    git(folder, 'init', '--initial-branch=trunk');
    mkdirSync(join(folder, 'pacote'));

    expect(await detector.detect(folder)).toEqual({ kind: 'git', defaultBranch: 'trunk' });
    expect(await detector.detect(join(folder, 'pacote'))).toEqual({ kind: 'none' });
  });

  it('a raiz do repositório é Git, e a subpasta dele é sem Git, lado a lado', async () => {
    const { path } = repo();
    mkdirSync(join(path, 'pacote'));

    expect(await detector.detect(path)).toEqual({ kind: 'git', defaultBranch: 'main' });
    expect(await detector.detect(join(path, 'pacote'))).toEqual({ kind: 'none' });
  });

  it('a raiz com barra final no caminho continua sendo Git', async () => {
    const { path } = repo();

    expect(await detector.detect(`${path}${sep}`)).toEqual({ kind: 'git', defaultBranch: 'main' });
  });

  it('a pasta .git por dentro não é projeto Git', async () => {
    const { path } = repo();

    expect(await detector.detect(join(path, '.git'))).toEqual({ kind: 'none' });
  });

  it('worktree vinculado (.git como arquivo) é a raiz da sua árvore: kind git', async () => {
    const { path } = repo();
    const linked = join(plainFolder('project-hub-vinculado-'), 'wt');
    git(path, 'worktree', 'add', '-b', 'ph/vinculado', linked, 'HEAD');
    mkdirSync(join(linked, 'pacote'));
    expect(statSync(join(linked, '.git')).isFile()).toBe(true);

    expect(await detector.detect(linked)).toEqual({ kind: 'git', defaultBranch: 'ph/vinculado' });
    expect(await detector.detect(join(linked, 'pacote'))).toEqual({ kind: 'none' });
  });

  it('raiz de submódulo é Git, e a subpasta dele não', async () => {
    const { path } = repo();
    const library = repo();
    // `protocol.file.allow` só neste comando: o Git recusa submódulo de caminho local por padrão.
    git(path, '-c', 'protocol.file.allow=always', 'submodule', 'add', library.path, 'lib');
    mkdirSync(join(path, 'lib', 'pacote'));
    expect(statSync(join(path, 'lib', '.git')).isFile()).toBe(true);

    expect(await detector.detect(join(path, 'lib'))).toEqual({
      kind: 'git',
      defaultBranch: 'main',
    });
    expect(await detector.detect(join(path, 'lib', 'pacote'))).toEqual({ kind: 'none' });
  });

  it('repositório sem commits ainda tem a branch inicial', async () => {
    const folder = plainFolder('project-hub-vazio-');
    git(folder, 'init', '--initial-branch=trunk');

    expect(await detector.detect(folder)).toEqual({ kind: 'git', defaultBranch: 'trunk' });
  });

  it('caminho com espaço e acento funciona', async () => {
    const folder = join(plainFolder(), 'Claude Code Projetos', 'Ação Hub');
    mkdirSync(folder, { recursive: true });
    git(folder, 'init', '--initial-branch=main');

    expect(await detector.detect(folder)).toEqual({ kind: 'git', defaultBranch: 'main' });
  });

  it('HEAD destacado e sem remoto: é Git, mas não há branch para guardar', async () => {
    const { path } = repo();
    git(path, 'checkout', '--detach');

    expect(await detector.detect(path)).toEqual({ kind: 'git' });
  });

  it('com origin/HEAD, a branch padrão é a do remoto, e não a que está em uso', async () => {
    const { path } = repo();
    git(path, 'remote', 'add', 'origin', 'https://exemplo.invalid/projeto.git');
    // Branch com barra: só o prefixo `origin/` sai.
    git(path, 'update-ref', 'refs/remotes/origin/release/2026', 'HEAD');
    git(path, 'symbolic-ref', 'refs/remotes/origin/HEAD', 'refs/remotes/origin/release/2026');
    git(path, 'checkout', '-b', 'feature/em-uso');

    expect(await detector.detect(path)).toEqual({ kind: 'git', defaultBranch: 'release/2026' });
  });

  it('repositório bare não é uma pasta de trabalho: kind none', async () => {
    const folder = plainFolder('project-hub-bare-');
    git(folder, 'init', '--bare');

    expect(await detector.detect(folder)).toEqual({ kind: 'none' });
  });

  // O usuário pode ter GIT_DIR no ambiente (repositório de dotfiles, hook). Ele não pode fazer toda
  // pasta virar Git.
  it('GIT_DIR herdado do ambiente não faz uma pasta comum virar Git', async () => {
    const { path } = repo();
    vi.stubEnv('GIT_DIR', join(path, '.git'));

    expect(await detector.detect(plainFolder())).toEqual({ kind: 'none' });
  });
});
