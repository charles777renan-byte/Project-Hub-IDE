import {
  githubMergeMethodSchema,
  type AppResult,
  type GithubMergeMethod,
} from '@project-hub/contracts';
import { failure } from '../result';
import {
  checkPrNumber,
  ghFailure,
  githubWriteProject,
  readPullRequestOfBranch,
  type GithubPanelDeps,
} from './project';

/**
 * Mescla o PR da branch atual. O número e a forma são conferidos antes de qualquer chamada. Em seguida o PR é
 * relido (e isso também confere o host e que ele é o da branch atual): só segue se estiver `OPEN` e
 * `MERGEABLE` e não for rascunho. Senão, `GH_PR_NOT_MERGEABLE` sem chamar `gh pr merge`. Se a leitura falhar,
 * a escrita não acontece.
 */
export async function mergeProjectPullRequest(
  deps: GithubPanelDeps,
  input: { projectId: string; prNumber: number; method: GithubMergeMethod },
): Promise<AppResult<void>> {
  const number = checkPrNumber(input.prNumber);
  if (!number.ok) return number;
  const method = githubMergeMethodSchema.safeParse(input.method);
  if (!method.success) {
    return failure('VALIDATION_FAILED', 'A forma de mesclar precisa ser merge, squash ou rebase.');
  }
  const project = await githubWriteProject(deps, input.projectId);
  if (!project.ok) return project;
  const reading = await readPullRequestOfBranch(deps, project.data, number.data);
  if (!reading.ok) return reading;
  if (reading.data.pr.isDraft) {
    return failure(
      'GH_PR_NOT_MERGEABLE',
      'O PR está em rascunho: marque-o como pronto para revisão no GitHub antes de mesclar.',
    );
  }
  if (reading.data.pr.state !== 'OPEN' || reading.data.pr.mergeable !== 'MERGEABLE') {
    return failure(
      'GH_PR_NOT_MERGEABLE',
      'O PR não pode ser mesclado agora: atualize a aba e confira o estado do PR.',
    );
  }
  try {
    await deps.github.mergePullRequest(project.data.path, number.data, method.data);
  } catch (error) {
    return ghFailure(error);
  }
  return { ok: true, data: undefined };
}
