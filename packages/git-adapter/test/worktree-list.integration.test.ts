import { execFileSync } from 'node:child_process';
import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createTempRepo, type TempRepo } from '@project-hub/test-utils';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { listWorktrees } from '../src/worktree-list';

// Git real: um repositório temporário com uma worktree em branch e outra em HEAD solto, mais uma pasta que não
// é repositório. Nada aqui toca no repositório do Project Hub.

const real = (path: string): string => realpathSync.native(path);

describe('listWorktrees com o Git real', () => {
  let repo: TempRepo;
  let folders: string;
  let branchWorktree: string;
  let detachedWorktree: string;
  let outside: string;

  beforeEach(() => {
    repo = createTempRepo();
    folders = mkdtempSync(join(tmpdir(), 'ph-worktree-list-'));
    branchWorktree = join(folders, 'com-branch');
    detachedWorktree = join(folders, 'solta');
    execFileSync('git', ['worktree', 'add', '-b', 'ph/feature-x', branchWorktree, 'HEAD'], {
      cwd: repo.path,
      stdio: 'pipe',
    });
    execFileSync('git', ['worktree', 'add', '--detach', detachedWorktree, 'HEAD'], {
      cwd: repo.path,
      stdio: 'pipe',
    });
    outside = mkdtempSync(join(tmpdir(), 'ph-sem-repo-'));
  });

  afterEach(() => {
    repo.cleanup();
    rmSync(folders, { recursive: true, force: true });
    rmSync(outside, { recursive: true, force: true });
  });

  it('lista a worktree principal primeiro, cada uma com a sua branch ou null quando está solta', async () => {
    const entries = await listWorktrees(repo.path);

    expect(entries.map((entry) => [real(entry.path), entry.branch])).toEqual([
      [real(repo.path), 'main'],
      [real(branchWorktree), 'ph/feature-x'],
      [real(detachedWorktree), null],
    ]);
  });

  it('pasta que não é repositório devolve lista vazia, sem lançar', async () => {
    await expect(listWorktrees(outside)).resolves.toEqual([]);
  });

  it('a pasta do próprio worktree lista os mesmos worktrees do repositório', async () => {
    const fromWorktree = await listWorktrees(branchWorktree);

    expect(fromWorktree.map((entry) => real(entry.path)).sort()).toEqual(
      [real(repo.path), real(branchWorktree), real(detachedWorktree)].sort(),
    );
  });
});
