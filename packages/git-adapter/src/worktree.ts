import { lstat } from 'node:fs/promises';
import { isAbsolute, relative, resolve, sep } from 'node:path';
import { GitError, runGit, runGitWorktree } from './run-git';
import { getStatus } from './status';
import type { WorktreeNames } from './worktree-naming';

const CREATE_FAILED_MESSAGE = 'Não foi possível criar o worktree.';
const UNSAVED_CHANGES_MESSAGE =
  'O worktree tem alterações não salvas e não foi removido. Salve ou descarte as alterações antes.';
/** Trecho da recusa do `git worktree remove` sem `--force` (`LC_ALL=C` fixa o idioma). */
const GIT_REFUSED_UNSAVED_CHANGES = 'contains modified or untracked files';

/** O worktree criado: o caminho e a branch reais, e o commit inteiro de onde ele parte. */
export type CreatedWorktree = { path: string; branch: string; baseCommit: string };

/**
 * Diz se `target` está dentro de `root`, e não é o próprio `root`. A conta é feita com `relative`:
 * um teste de prefixo aceitaria `C:\raiz-outra` como filho de `C:\raiz`. Em outra unidade do
 * Windows, `relative` devolve um caminho absoluto.
 */
function isStrictlyInside(root: string, target: string): boolean {
  const path = relative(root, target);
  return path !== '' && path !== '..' && !path.startsWith(`..${sep}`) && !isAbsolute(path);
}

/** Uma falha do Git na criação vira WORKTREE_CREATE_FAILED. Git ausente e pasta ausente seguem como são. */
function toCreateFailure(error: unknown): unknown {
  if (error instanceof GitError && error.code === 'UNKNOWN') {
    return new GitError('WORKTREE_CREATE_FAILED', CREATE_FAILED_MESSAGE, {
      exitCode: error.exitCode,
      stderr: error.stderr,
      cause: error,
    });
  }
  return error;
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await lstat(path);
    return true;
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    // Um arquivo no meio do caminho (ENOTDIR) não é colisão: o Git recusa a criação depois.
    if (code === 'ENOENT' || code === 'ENOTDIR') return false;
    throw error;
  }
}

/** O commit inteiro a que `baseRef` aponta, ou WORKTREE_CREATE_FAILED se não aponta para nenhum. */
async function resolveCommit(repoPath: string, baseRef: string): Promise<string> {
  try {
    const { stdout } = await runGit(['rev-parse', '--verify', '--quiet', `${baseRef}^{commit}`], {
      cwd: repoPath,
    });
    return stdout.trim();
  } catch (error) {
    throw toCreateFailure(error);
  }
}

async function localBranchExists(repoPath: string, branch: string): Promise<boolean> {
  try {
    await runGit(['rev-parse', '--verify', '--quiet', `refs/heads/${branch}`], { cwd: repoPath });
    return true;
  } catch (error) {
    // `--quiet` sai com 1, sem mensagem, quando a branch não existe.
    if (error instanceof GitError && error.exitCode === 1) return false;
    throw toCreateFailure(error);
  }
}

/**
 * Cria a branch `names.branch` e o worktree em `<worktreesRoot>/<names.relativeDir>`, a partir de
 * `baseRef` (seção 16.3). Antes de qualquer comando do Git:
 *
 * - `worktreesRoot` precisa ser absoluta, e o caminho final precisa ficar DENTRO dela. Um
 *   `relativeDir` com `..`, absoluto ou de rede, montado à mão, rejeita com
 *   PATH_OUTSIDE_ALLOWED_SCOPE;
 * - `baseRef` não pode ser vazia nem começar com `-`, que o Git leria como opção, e tem de apontar
 *   para um commit (senão WORKTREE_CREATE_FAILED, sem pasta nem branch);
 * - branch ou pasta que já existem rejeitam com WORKTREE_COLLISION, sem tocar no que existe.
 *
 * O worktree sai do commit resolvido, e não do nome da base, que pode andar entre a leitura e a
 * criação. Se o Git falhar ao criar, a falha vira WORKTREE_CREATE_FAILED; o Git desfaz sozinho o que
 * começou, e o adaptador não apaga nada por conta própria.
 */
export async function createWorktree(input: {
  repoPath: string;
  worktreesRoot: string;
  names: WorktreeNames;
  baseRef: string;
}): Promise<CreatedWorktree> {
  const { repoPath, worktreesRoot, names, baseRef } = input;
  if (!isAbsolute(worktreesRoot)) {
    throw new GitError(
      'VALIDATION_FAILED',
      'A pasta dos worktrees precisa ser um caminho absoluto.',
    );
  }
  const root = resolve(worktreesRoot);
  const path = resolve(root, names.relativeDir);
  if (!isStrictlyInside(root, path)) {
    throw new GitError(
      'PATH_OUTSIDE_ALLOWED_SCOPE',
      'O caminho do worktree fica fora da pasta de worktrees.',
    );
  }
  if (baseRef === '' || baseRef.startsWith('-')) {
    throw new GitError('WORKTREE_CREATE_FAILED', 'A base do worktree é inválida.');
  }

  const baseCommit = await resolveCommit(repoPath, baseRef);
  if ((await pathExists(path)) || (await localBranchExists(repoPath, names.branch))) {
    throw new GitError(
      'WORKTREE_COLLISION',
      'Já existe uma branch ou uma pasta com o nome deste worktree.',
    );
  }

  try {
    await runGitWorktree(['worktree', 'add', '-b', names.branch, path, baseCommit], {
      cwd: repoPath,
    });
  } catch (error) {
    throw toCreateFailure(error);
  }
  return { path, branch: names.branch, baseCommit };
}

/**
 * Remove o worktree em `worktreePath`, sem apagar a branch (seção 16.5). Duas guardas, nenhuma com
 * `--force`: o status do worktree, lido antes, e o `git worktree remove`, que recusa por
 * conta própria uma pasta com arquivo modificado ou novo, como numa alteração que chegou depois do
 * status. As duas rejeitam com WORKTREE_HAS_UNSAVED_CHANGES. Arquivos ignorados pelo Git não contam
 * como alteração, então saem junto com a pasta.
 */
export async function removeWorktree(input: {
  repoPath: string;
  worktreePath: string;
}): Promise<void> {
  const { repoPath, worktreePath } = input;
  const status = await getStatus(worktreePath);
  if (status.changedFiles > 0) {
    throw new GitError('WORKTREE_HAS_UNSAVED_CHANGES', UNSAVED_CHANGES_MESSAGE);
  }
  try {
    await runGitWorktree(['worktree', 'remove', worktreePath], { cwd: repoPath });
  } catch (error) {
    if (error instanceof GitError && error.stderr.includes(GIT_REFUSED_UNSAVED_CHANGES)) {
      throw new GitError('WORKTREE_HAS_UNSAVED_CHANGES', UNSAVED_CHANGES_MESSAGE, {
        exitCode: error.exitCode,
        stderr: error.stderr,
        cause: error,
      });
    }
    throw error;
  }
}
