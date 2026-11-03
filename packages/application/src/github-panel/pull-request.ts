import type { AppResult, GithubPanelDto } from '@project-hub/contracts';
import { eligibleGitProject } from '../git-panel/project';
import { ghFailure, isGithubRemote, isPullRequestOfBranch, type GithubPanelDeps } from './project';

const NOT_APPLICABLE: AppResult<GithubPanelDto> = { ok: true, data: { kind: 'not-applicable' } };
const NO_PR: AppResult<GithubPanelDto> = { ok: true, data: { kind: 'no-pr' } };

/**
 * O PR da branch atual do projeto, para a aba Checks. A branch é lida do repositório (`git.status`), nunca da
 * tela. Pasta sem Git, sem `origin` ou com `origin` fora do `github.com` é `not-applicable`, sem chamar o `gh`.
 * Branch sem PR, ou cujo PR achado é de outra origem (`headRefName` diferente: fork), é `no-pr`. Falha do
 * `gh` vira `AppResult` com código. A leitura devolve sempre `ok`: o estado `stale` é do renderer, que guarda
 * a última leitura boa.
 */
export async function getPullRequestPanel(
  deps: GithubPanelDeps,
  input: { projectId: string },
): Promise<AppResult<GithubPanelDto>> {
  const known = deps.repo.get(input.projectId);
  if (known !== undefined && known.removedAt === undefined && known.repositoryKind !== 'git') {
    return NOT_APPLICABLE;
  }
  const eligible = await eligibleGitProject(deps, input.projectId);
  if (!eligible.ok) return eligible;
  const path = eligible.data.path;
  try {
    if (!isGithubRemote(await deps.github.originUrl(path))) return NOT_APPLICABLE;
    const { branch } = await deps.git.status(path);
    if (branch === null) return NO_PR;
    const prNumber = await deps.github.pullRequestForBranch(path, branch);
    if (prNumber === null) return NO_PR;
    const reading = await deps.github.pullRequest(path, prNumber);
    if (!isPullRequestOfBranch(reading, branch)) return NO_PR;
    return { ok: true, data: { kind: 'pr', result: { state: 'ok', reading } } };
  } catch (error) {
    return ghFailure(error);
  }
}
