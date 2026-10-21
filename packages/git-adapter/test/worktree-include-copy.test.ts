import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { cp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { runGit } from '../src/run-git';
import { copyWorktreeIncludes } from '../src/worktree-include';

// Unitário: o Git e a cópia são imitados, e só o disco (pastas temporárias) é de verdade. Prova o que
// o Git real não consegue provocar de forma confiável: uma cópia que falha no meio da lista.
vi.mock('../src/run-git', async (importOriginal) => {
  const original = await importOriginal<typeof import('../src/run-git')>();
  return { ...original, runGit: vi.fn() };
});
vi.mock('node:fs/promises', async (importOriginal) => {
  const original = await importOriginal<typeof import('node:fs/promises')>();
  return { ...original, cp: vi.fn(original.cp) };
});

const folders: string[] = [];

function newFolder(prefix: string): string {
  const folder = mkdtempSync(join(tmpdir(), prefix));
  folders.push(folder);
  return folder;
}

afterEach(() => {
  for (const folder of folders.splice(0)) rmSync(folder, { recursive: true, force: true });
  vi.mocked(runGit).mockReset();
  vi.mocked(cp).mockClear();
});

describe('copyWorktreeIncludes: falha de cópia', () => {
  it('a falha de uma entrada vira falha-ao-copiar, e as outras continuam sendo copiadas', async () => {
    const repoPath = newFolder('project-hub-copia-repo-');
    const worktreePath = newFolder('project-hub-copia-wt-');
    writeFileSync(join(repoPath, '.worktreeinclude'), 'a.env\nb.env\nc.env\n');
    for (const name of ['a.env', 'b.env', 'c.env']) writeFileSync(join(repoPath, name), name);
    vi.mocked(runGit).mockResolvedValue({ stdout: 'a.env\nb.env\nc.env\n' });
    const original = (await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises'))
      .cp;
    vi.mocked(cp).mockImplementation(async (source, destination, options) => {
      if (String(source).endsWith('b.env')) throw new Error('disco cheio');
      return original(source, destination, options);
    });

    const result = await copyWorktreeIncludes({ repoPath, worktreePath });

    expect(result).toEqual({
      copied: ['a.env', 'c.env'],
      skipped: [{ path: 'b.env', reason: 'falha-ao-copiar' }],
    });
    expect(cp).toHaveBeenCalledTimes(3);
  });

  it('uma pasta que falha no meio deixa as outras entradas seguirem', async () => {
    const repoPath = newFolder('project-hub-copia-repo-');
    const worktreePath = newFolder('project-hub-copia-wt-');
    writeFileSync(join(repoPath, '.worktreeinclude'), 'dados\n.env\n');
    mkdirSync(join(repoPath, 'dados'));
    writeFileSync(join(repoPath, 'dados', 'x.txt'), 'x');
    writeFileSync(join(repoPath, '.env'), 'segredo');
    vi.mocked(runGit).mockResolvedValue({ stdout: 'dados/\n.env\n' });
    const original = (await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises'))
      .cp;
    vi.mocked(cp).mockImplementation(async (source, destination, options) => {
      if (String(source).endsWith('dados')) throw new Error('falhou');
      return original(source, destination, options);
    });

    const result = await copyWorktreeIncludes({ repoPath, worktreePath });

    expect(result.copied).toEqual(['.env']);
    expect(result.skipped).toEqual([{ path: 'dados', reason: 'falha-ao-copiar' }]);
    expect(result.warning).toBeUndefined();
  });
});
