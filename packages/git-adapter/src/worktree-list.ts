import { GitError, runGit } from './run-git';

/** Um worktree do repositório: a pasta, e a branch dele (`null` quando está solto, em detached HEAD). */
export type WorktreeEntry = { path: string; branch: string | null };

const BRANCH_PREFIX = 'refs/heads/';

/**
 * Lê a saída de `git worktree list --porcelain`: um bloco por worktree, separados por linha em branco. Cada
 * bloco tem `worktree <pasta>` e, quando a pasta tem branch, `branch refs/heads/<nome>`; `detached` vira `null`.
 * Repositório nu (`bare`) não tem pasta de trabalho, então sai da lista. A worktree principal vem primeiro.
 */
export function parseWorktreeList(text: string): WorktreeEntry[] {
  const entries: WorktreeEntry[] = [];
  for (const block of text.split(/\n\s*\n/u)) {
    let path: string | undefined;
    let branch: string | null = null;
    let bare = false;
    for (const line of block.split('\n')) {
      if (line.startsWith('worktree ')) path = line.slice('worktree '.length);
      else if (line.startsWith('branch ')) {
        const name = line.slice('branch '.length);
        branch = name.startsWith(BRANCH_PREFIX) ? name.slice(BRANCH_PREFIX.length) : name;
      } else if (line === 'bare') bare = true;
    }
    if (path !== undefined && path !== '' && !bare) entries.push({ path, branch });
  }
  return entries;
}

/**
 * Os worktrees de um repositório, pela forma de leitura `worktree list --porcelain`. Pasta que não é repositório
 * devolve lista vazia, sem lançar: o Git sai com erro, e isso quer dizer que não há worktree. Outras falhas
 * (Git ausente, pasta indisponível, tempo esgotado) continuam sendo lançadas.
 */
export async function listWorktrees(repoPath: string): Promise<WorktreeEntry[]> {
  let stdout: string;
  try {
    ({ stdout } = await runGit(['worktree', 'list', '--porcelain'], { cwd: repoPath }));
  } catch (error) {
    if (error instanceof GitError && error.exitCode !== undefined) return [];
    throw error;
  }
  return parseWorktreeList(stdout);
}
