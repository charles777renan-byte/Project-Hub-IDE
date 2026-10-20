import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, statSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createTempRepo, type TempRepo } from '@project-hub/test-utils';
import { afterEach, describe, expect, it } from 'vitest';
import { GitError } from '../src/run-git';
import { getStatus } from '../src/status';

// Git real: cada teste cria um repositório na pasta temporária do sistema e o lê com o executável
// do sistema.

const repos: TempRepo[] = [];
const folders: string[] = [];

function repo(): TempRepo {
  const made = createTempRepo();
  repos.push(made);
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
  for (const made of repos.splice(0)) made.cleanup();
  for (const folder of folders.splice(0)) rmSync(folder, { recursive: true, force: true });
});

describe('getStatus', () => {
  it('repositório limpo tem changedFiles 0', async () => {
    const { path } = repo();

    expect(await getStatus(path)).toMatchObject({ changedFiles: 0, isDirty: false });
  });

  it('arquivo modificado conta como changedFiles 1', async () => {
    const { path } = repo();
    writeFileSync(join(path, 'a.txt'), 'novo');

    expect(await getStatus(path)).toMatchObject({ changedFiles: 1, isDirty: true });
  });

  it('devolve a branch atual e o commit de base inteiro', async () => {
    const { path } = repo();
    git(path, 'checkout', '-b', 'feature/status');

    const status = await getStatus(path);

    expect(status.branch).toBe('feature/status');
    expect(status.baseCommit).toBe(git(path, 'rev-parse', 'HEAD'));
    expect(status.baseCommit).toMatch(/^[0-9a-f]{40,64}$/);
  });

  it('arquivo novo, ainda sem versionar, conta como alteração', async () => {
    const { path } = repo();
    writeFileSync(join(path, 'novo.txt'), 'x');

    expect(await getStatus(path)).toMatchObject({ changedFiles: 1, isDirty: true });
  });

  it('conta cada arquivo de uma pasta nova, e não a pasta', async () => {
    const { path } = repo();
    mkdirSync(join(path, 'pasta'));
    writeFileSync(join(path, 'pasta', 'um.txt'), '1');
    writeFileSync(join(path, 'pasta', 'dois.txt'), '2');

    expect((await getStatus(path)).changedFiles).toBe(2);
  });

  it('arquivo e alteração já na área de preparo contam uma vez cada', async () => {
    const { path } = repo();
    writeFileSync(join(path, 'a.txt'), 'preparado');
    git(path, 'add', 'a.txt');
    writeFileSync(join(path, 'b.txt'), 'solto');

    expect((await getStatus(path)).changedFiles).toBe(2);
  });

  it('arquivo renomeado conta uma vez', async () => {
    const { path } = repo();
    git(path, 'mv', 'a.txt', 'renomeado.txt');

    expect(await getStatus(path)).toMatchObject({ changedFiles: 1, isDirty: true });
  });

  it('nome de arquivo com espaço e acento conta uma vez', async () => {
    const { path } = repo();
    writeFileSync(join(path, 'Ação nova.txt'), 'x');

    expect((await getStatus(path)).changedFiles).toBe(1);
  });

  it('em HEAD destacado a branch é HEAD', async () => {
    const { path } = repo();
    git(path, 'checkout', '--detach');

    expect((await getStatus(path)).branch).toBe('HEAD');
  });

  it('repositório sem commits não tem commit de base e rejeita', async () => {
    const folder = mkdtempSync(join(tmpdir(), 'project-hub-vazio-'));
    folders.push(folder);
    git(folder, 'init', '--initial-branch=main');

    await expect(getStatus(folder)).rejects.toBeInstanceOf(GitError);
    await expect(getStatus(folder)).rejects.toThrow('nenhum commit');
  });

  it('pasta que não é repositório rejeita com o erro do Git, sem tratar como limpa', async () => {
    const folder = mkdtempSync(join(tmpdir(), 'project-hub-sem-git-'));
    folders.push(folder);

    await expect(getStatus(folder)).rejects.toMatchObject({ code: 'UNKNOWN', exitCode: 128 });
  });

  // Somente leitura: sem GIT_OPTIONAL_LOCKS=0 o `git status` regrava o índice quando o carimbo de
  // data de um arquivo muda, mesmo com o conteúdo igual. Aqui o arquivo é "tocado" e o índice não pode mudar.
  it('não regrava o índice do repositório', async () => {
    const { path } = repo();
    const touched = new Date(Date.now() + 60_000);
    utimesSync(join(path, 'a.txt'), touched, touched);
    const before = statSync(join(path, '.git', 'index')).mtimeMs;

    expect(await getStatus(path)).toMatchObject({ changedFiles: 0, isDirty: false });

    expect(statSync(join(path, '.git', 'index')).mtimeMs).toBe(before);
  });
});
