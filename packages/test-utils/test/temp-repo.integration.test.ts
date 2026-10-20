import { execFileSync } from 'node:child_process';
import { existsSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { isAbsolute, relative, resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createTempRepo, type TempRepo } from '../src/temp-repo';

// Git real: o repositório nasce e é lido com o executável do sistema.

const projectRoot = resolve(import.meta.dirname, '..', '..', '..');
const created: TempRepo[] = [];

function repo(): TempRepo {
  const made = createTempRepo();
  created.push(made);
  return made;
}

function git(cwd: string, ...args: string[]): string {
  return execFileSync('git', args, {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
}

/** Diz se `inner` está dentro de `outer` (ou é ele mesmo). */
function isInside(outer: string, inner: string): boolean {
  const path = relative(outer, inner);
  return path === '' || (!path.startsWith('..') && !isAbsolute(path));
}

afterEach(() => {
  for (const made of created.splice(0)) made.cleanup();
});

describe('createTempRepo', () => {
  it('cria o repositório na pasta temporária do sistema, fora do projeto', () => {
    const { path } = repo();

    expect(isInside(tmpdir(), path)).toBe(true);
    expect(isInside(projectRoot, path)).toBe(false);
    // A raiz do repositório é a própria pasta, e não o repositório do Project Hub, mais acima.
    expect(realpathSync.native(git(path, 'rev-parse', '--show-toplevel'))).toBe(
      realpathSync.native(path),
    );
  });

  it('nasce com um único commit, a.txt versionado, a branch main e a árvore limpa', () => {
    const { path } = repo();

    expect(git(path, 'rev-list', '--count', 'HEAD')).toBe('1');
    expect(git(path, 'ls-files')).toBe('a.txt');
    expect(git(path, 'branch', '--show-current')).toBe('main');
    expect(git(path, 'status', '--porcelain')).toBe('');
  });

  it('guarda a identidade no próprio repositório, sem depender da configuração do usuário', () => {
    const { path } = repo();

    expect(git(path, 'config', '--local', 'user.name')).not.toBe('');
    expect(git(path, 'config', '--local', 'user.email')).not.toBe('');
  });

  it('cleanup apaga a pasta e pode ser chamado de novo', () => {
    const made = createTempRepo();

    made.cleanup();

    expect(existsSync(made.path)).toBe(false);
    expect(() => made.cleanup()).not.toThrow();
  });

  it('cada chamada cria um repositório diferente', () => {
    expect(repo().path).not.toBe(repo().path);
  });
});
