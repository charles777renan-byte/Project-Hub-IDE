import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createTempRepo, type TempRepo } from '@project-hub/test-utils';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { getWorktreeDiff } from '../src/diff';
import { GitError } from '../src/run-git';
import { createWorktree } from '../src/worktree';
import { buildWorktreeNames } from '../src/worktree-naming';

// Git real: cada teste cria um repositório e um worktree na pasta temporária do sistema, fora do
// projeto, e apaga tudo no fim. O diff é lido do worktree, como a missão o deixa.

const repos: TempRepo[] = [];
const folders: string[] = [];

function newFolder(prefix: string): string {
  const folder = mkdtempSync(join(tmpdir(), prefix));
  folders.push(folder);
  return folder;
}

/** Cria um worktree a partir do commit inicial, e devolve a pasta dele. */
async function worktree(): Promise<string> {
  const repo = createTempRepo();
  repos.push(repo);
  const created = await createWorktree({
    repoPath: repo.path,
    worktreesRoot: newFolder('project-hub-diff-root-'),
    names: buildWorktreeNames({ missionId: 'abcdef123456', title: 'Diff', projectSlug: 'app' }),
    baseRef: 'HEAD',
  });
  return created.path;
}

function fileIn(root: string, path: string, content: string | Buffer): void {
  const full = join(root, path);
  mkdirSync(join(full, '..'), { recursive: true });
  writeFileSync(full, content);
}

afterEach(() => {
  for (const repo of repos.splice(0)) repo.cleanup();
  for (const folder of folders.splice(0)) rmSync(folder, { recursive: true, force: true });
});

describe('getWorktreeDiff', () => {
  let root: string;

  beforeEach(async () => {
    root = await worktree();
  });

  it('sem alterações, devolve lista vazia e não trunca nada', async () => {
    expect(await getWorktreeDiff(root)).toEqual({ files: [], truncatedFiles: false });
  });

  it('arquivo modificado traz status, contagens e o patch da alteração', async () => {
    fileIn(root, 'a.txt', 'linha nova\n');

    const { files, truncatedFiles } = await getWorktreeDiff(root);

    expect(truncatedFiles).toBe(false);
    expect(files).toEqual([
      expect.objectContaining({
        path: 'a.txt',
        status: 'modified',
        added: 1,
        removed: 1,
        binary: false,
        truncated: false,
      }),
    ]);
    expect(files[0]?.patch).toContain('-conteudo inicial');
    expect(files[0]?.patch).toContain('+linha nova');
    expect(files[0]?.patch?.startsWith('@@')).toBe(true);
  });

  it('arquivo novo que já entrou no índice aparece como adicionado', async () => {
    fileIn(root, 'novo.md', 'um\ndois\n');
    execFileSync('git', ['add', 'novo.md'], { cwd: root, stdio: 'pipe' });

    const { files } = await getWorktreeDiff(root);

    expect(files).toEqual([
      expect.objectContaining({ path: 'novo.md', status: 'added', added: 2, removed: 0 }),
    ]);
  });

  it('arquivo apagado aparece como apagado, com as linhas removidas', async () => {
    unlinkSync(join(root, 'a.txt'));

    const { files } = await getWorktreeDiff(root);

    expect(files).toEqual([
      expect.objectContaining({ path: 'a.txt', status: 'deleted', added: 0, removed: 1 }),
    ]);
  });

  it('arquivo não rastreado entra como novo, com o conteúdo como adição', async () => {
    fileIn(root, 'rascunho.md', 'primeira\nsegunda\n');

    const { files } = await getWorktreeDiff(root);

    expect(files).toEqual([
      expect.objectContaining({
        path: 'rascunho.md',
        status: 'untracked',
        added: 2,
        removed: 0,
        binary: false,
        truncated: false,
      }),
    ]);
    expect(files[0]?.patch).toContain('+primeira');
    expect(files[0]?.patch).toContain('+segunda');
  });

  it('arquivo binário traz o aviso e não tem patch', async () => {
    fileIn(root, 'imagem.bin', Buffer.from([0x89, 0x50, 0x00, 0x47, 0x0d, 0x0a]));

    const { files } = await getWorktreeDiff(root);

    expect(files).toEqual([
      expect.objectContaining({ path: 'imagem.bin', status: 'untracked', binary: true }),
    ]);
    expect(files[0]?.patch).toBeUndefined();
  });

  it('arquivo não rastreado maior que o limite mostra só o começo e marca truncado', async () => {
    const lines = Array.from({ length: 500 }, (_, index) => `linha ${index}`);
    fileIn(root, 'grande.txt', `${lines.join('\n')}\n`);

    const { files } = await getWorktreeDiff(root, { maxFileBytes: 200 });

    expect(files[0]).toEqual(expect.objectContaining({ path: 'grande.txt', truncated: true }));
    expect(files[0]?.added).toBeLessThan(500);
    expect(files[0]?.patch).toContain('+linha 0');
    expect(files[0]?.patch).not.toContain('linha 499');
  });

  it('alteração de arquivo rastreado maior que o limite marca truncado no patch', async () => {
    fileIn(root, 'a.txt', `${'x'.repeat(5000)}\n`);

    const { files } = await getWorktreeDiff(root, { maxFileBytes: 300 });

    expect(files[0]).toEqual(expect.objectContaining({ path: 'a.txt', truncated: true }));
    expect(Buffer.byteLength(files[0]?.patch ?? '', 'utf8')).toBeLessThanOrEqual(300);
  });

  it('nome com espaço e acento sai como o arquivo está no disco', async () => {
    fileIn(root, 'pasta com espaço/relatório çãó.md', 'oi\n');

    const { files } = await getWorktreeDiff(root);

    expect(files.map((file) => file.path)).toEqual(['pasta com espaço/relatório çãó.md']);
  });

  it('link simbólico para fora do worktree não é lido', async () => {
    const outside = newFolder('project-hub-fora-');
    fileIn(outside, 'segredo.txt', 'SEGREDO-DO-USUARIO\n');
    symlinkSync(join(outside, 'segredo.txt'), join(root, 'atalho.txt'));

    const result = await getWorktreeDiff(root);

    expect(result.files).toEqual([
      expect.objectContaining({ path: 'atalho.txt', status: 'untracked', added: 0 }),
    ]);
    expect(result.files[0]?.patch).toBeUndefined();
    expect(JSON.stringify(result)).not.toContain('SEGREDO-DO-USUARIO');
  });

  it('com mais arquivos que o limite, lista só os primeiros e marca truncatedFiles', async () => {
    fileIn(root, 'um.txt', '1\n');
    fileIn(root, 'dois.txt', '2\n');
    fileIn(root, 'tres.txt', '3\n');

    const result = await getWorktreeDiff(root, { maxFiles: 2 });

    expect(result.files).toHaveLength(2);
    expect(result.truncatedFiles).toBe(true);
  });

  it('pasta que não é um worktree rejeita com erro tipado do Git', async () => {
    const plain = newFolder('project-hub-sem-git-');

    await expect(getWorktreeDiff(plain)).rejects.toBeInstanceOf(GitError);
  });
});
