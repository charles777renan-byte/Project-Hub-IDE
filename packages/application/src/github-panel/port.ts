import type { GithubMergeMethod, PrReadingDto } from '@project-hub/contracts';

/**
 * Porta do painel Checks (ADR 0011): uma ponte fina sobre o `@project-hub/github-adapter`, ligada pela
 * composição. Sem lógica própria: as conferências (branch, host, estado do PR) ficam nos casos de uso. Falha
 * rejeita com um erro que traz `code` e uma `message` segura em português, como o `GhError`.
 */
export interface GithubPanelPort {
  /** A URL do remoto `origin` da pasta (`git config --get remote.origin.url`), ou `null` quando não há `origin`. */
  originUrl(repoPath: string): Promise<string | null>;
  /** O número do PR cuja branch de origem tem este nome (`gh pr list --head`), ou `null` quando não há PR. */
  pullRequestForBranch(repoPath: string, branch: string): Promise<number | null>;
  /** Lê o PR inteiro: resumo, checks e comentários (`gh pr view`). Recusa PR de outro servidor que não o `github.com`. */
  pullRequest(repoPath: string, prNumber: number): Promise<PrReadingDto>;
  /** `gh pr comment`. */
  addComment(repoPath: string, prNumber: number, body: string): Promise<void>;
  /** `gh pr merge --merge|--squash|--rebase`. */
  mergePullRequest(repoPath: string, prNumber: number, method: GithubMergeMethod): Promise<void>;
}
