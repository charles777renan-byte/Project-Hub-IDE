import { githubCommentBodySchema, type AppResult } from '@project-hub/contracts';
import { failure } from '../result';
import {
  checkPrNumber,
  ghFailure,
  githubWriteProject,
  readPullRequestOfBranch,
  type GithubPanelDeps,
} from './project';

/**
 * Comenta no PR da branch atual. O número e o texto são conferidos antes de qualquer chamada (comentário vazio
 * ou só de espaços é recusado). A escrita é precedida da leitura do PR, na mesma chamada: se a leitura falhar,
 * ou o PR não for o da branch atual, o `gh pr comment` não roda.
 */
export async function addPullRequestComment(
  deps: GithubPanelDeps,
  input: { projectId: string; prNumber: number; body: string },
): Promise<AppResult<void>> {
  const number = checkPrNumber(input.prNumber);
  if (!number.ok) return number;
  const body = githubCommentBodySchema.safeParse(input.body);
  if (!body.success) {
    return failure(
      'VALIDATION_FAILED',
      body.error.issues[0]?.message ?? 'O comentário é inválido.',
    );
  }
  const project = await githubWriteProject(deps, input.projectId);
  if (!project.ok) return project;
  const reading = await readPullRequestOfBranch(deps, project.data, number.data);
  if (!reading.ok) return reading;
  try {
    await deps.github.addComment(project.data.path, number.data, body.data);
  } catch (error) {
    return ghFailure(error);
  }
  return { ok: true, data: undefined };
}
