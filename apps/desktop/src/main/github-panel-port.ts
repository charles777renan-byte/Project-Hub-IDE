import type { GithubPanelPort } from '@project-hub/application';
import {
  addComment,
  getPullRequest,
  getPullRequestForBranch,
  mergePullRequest,
} from '@project-hub/github-adapter';

/**
 * A porta do painel Checks (ADR 0011) sobre o `@project-hub/github-adapter`. Cada método só traduz a chamada
 * da aplicação para a função do adaptador, que monta a forma exata do comando `gh`. O `originUrl` é do Git,
 * por isso entra de fora: a composição passa o da porta do painel de código-fonte. A porta não captura
 * `GhError`: o caso de uso o converte em resposta com código e mensagem.
 *
 * `allowTestOverrides` libera o `gh` falso dos testes (`PROJECT_HUB_GH_BIN`) e vale `!app.isPackaged`, como
 * nos outros ganchos de teste: o aplicativo empacotado nunca troca o `gh` real. O ambiente do processo filho
 * segue sendo o `process.env` (o `gh` precisa do PATH e do login).
 */
export function createGithubPanelPort(
  originUrl: GithubPanelPort['originUrl'],
  allowTestOverrides: boolean,
): GithubPanelPort {
  const options = { allowTestOverrides };
  return {
    originUrl,
    pullRequestForBranch: (repoPath, branch) => getPullRequestForBranch(repoPath, branch, options),
    pullRequest: (repoPath, prNumber) => getPullRequest(repoPath, prNumber, options),
    addComment: (repoPath, prNumber, body) => addComment(repoPath, prNumber, body, options),
    mergePullRequest: (repoPath, prNumber, method) =>
      mergePullRequest(repoPath, prNumber, method, options),
  };
}
