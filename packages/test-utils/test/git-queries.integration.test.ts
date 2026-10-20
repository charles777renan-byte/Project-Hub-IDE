import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { branchExists, revParse } from '../src/git-queries';
import { createTempRepo, type TempRepo } from '../src/temp-repo';

// Git real: o repositório nasce e é lido com o executável do sistema.

const created: TempRepo[] = [];
const folders: string[] = [];

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

afterEach(() => {
  for (const made of created.splice(0)) made.cleanup();
  for (const folder of folders.splice(0)) rmSync(folder, { recursive: true, force: true });
});

describe('revParse', () => {
  it('devolve o commit inteiro de HEAD', () => {
    const { path } = repo();

    expect(revParse(path, 'HEAD')).toBe(git(path, 'rev-list', '-1', 'HEAD'));
    expect(revParse(path, 'HEAD')).toMatch(/^[0-9a-f]{40,64}$/);
  });

  it('resolve o nome de uma branch para o mesmo commit', () => {
    const { path } = repo();

    expect(revParse(path, 'main')).toBe(revParse(path, 'HEAD'));
  });

  it('rejeita uma referência que não existe', () => {
    const { path } = repo();

    expect(() => revParse(path, 'nao-existe')).toThrow();
  });
});

describe('branchExists', () => {
  it('é verdadeiro para uma branch existente', () => {
    const { path } = repo();
    git(path, 'branch', 'ph/existe');

    expect(branchExists(path, 'main')).toBe(true);
    expect(branchExists(path, 'ph/existe')).toBe(true);
  });

  it('é falso para uma branch que não existe', () => {
    const { path } = repo();

    expect(branchExists(path, 'ph/nao-existe')).toBe(false);
  });

  it('não confunde tag com branch', () => {
    const { path } = repo();
    git(path, 'tag', 'v1');

    expect(branchExists(path, 'v1')).toBe(false);
  });

  it('rejeita em vez de responder falso quando a pasta não é um repositório', () => {
    // Uma pasta que existe, na pasta temporária, sem Git: o Git sai com 128 ("not a git
    // repository"), que não é o 1 de "a branch não existe".
    const folder = mkdtempSync(join(tmpdir(), 'project-hub-sem-git-'));
    folders.push(folder);

    let thrown: unknown;
    try {
      branchExists(folder, 'main');
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toMatchObject({ status: 128 });
  });
});
