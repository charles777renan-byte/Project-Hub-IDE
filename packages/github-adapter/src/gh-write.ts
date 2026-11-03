import {
  githubCommentBodySchema,
  githubMergeMethodSchema,
  type GithubMergeMethod,
} from '@project-hub/contracts';
import { checkedPrNumber, type GhOptions } from './gh-read';
import { GhError, runGh } from './run-gh';

/**
 * Publica um comentário no PR: `gh pr comment <n> --body=<texto>`. O texto vai sempre colado ao `--body=`,
 * num argumento só (ele pode ter quebra de linha e começar com `-`). Texto vazio, só de espaços ou com mais
 * de 65 536 caracteres é recusado com `VALIDATION_FAILED`, sem criar processo.
 */
export async function addComment(
  repoPath: string,
  number: number,
  body: string,
  options: GhOptions = {},
): Promise<void> {
  const prNumber = checkedPrNumber(number);
  const checked = githubCommentBodySchema.safeParse(body);
  if (!checked.success) {
    throw new GhError('VALIDATION_FAILED', 'O comentário precisa ter de 1 a 65 536 caracteres.', {
      cause: checked.error,
    });
  }
  await runGh(['pr', 'comment', prNumber, `--body=${checked.data}`], {
    cwd: repoPath,
    env: options.env,
    timeoutMs: options.timeoutMs,
  });
}

/**
 * Mescla o PR: `gh pr merge <n> --merge|--squash|--rebase`. Nunca com `--admin`, `--auto` nem
 * `--delete-branch`. Quem chama confere antes que o PR está aberto e mesclável; se o GitHub recusar, a falha
 * sobe como `GH_PR_NOT_MERGEABLE`.
 */
export async function mergePullRequest(
  repoPath: string,
  number: number,
  method: GithubMergeMethod,
  options: GhOptions = {},
): Promise<void> {
  const prNumber = checkedPrNumber(number);
  const checked = githubMergeMethodSchema.safeParse(method);
  if (!checked.success) {
    throw new GhError(
      'VALIDATION_FAILED',
      'A forma de mesclar precisa ser merge, squash ou rebase.',
      {
        cause: checked.error,
      },
    );
  }
  await runGh(['pr', 'merge', prNumber, `--${checked.data}`], {
    cwd: repoPath,
    env: options.env,
    timeoutMs: options.timeoutMs,
  });
}
