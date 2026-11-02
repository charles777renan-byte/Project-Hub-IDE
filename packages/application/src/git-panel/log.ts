import type { AppResult, GitLogEntryDto } from '@project-hub/contracts';
import { eligibleGitProject, type GitPanelDeps } from './project';

/** O adaptador limita o log entre 1 e 50 commits; o contrato de `git:log:v1` não tem `limit`. */
const LOG_LIMIT = 50;

/** Os últimos commits da branch atual, do mais novo para o mais antigo. */
export async function getProjectBranchLog(
  deps: GitPanelDeps,
  input: { projectId: string },
): Promise<AppResult<GitLogEntryDto[]>> {
  const eligible = await eligibleGitProject(deps, input.projectId);
  if (!eligible.ok) return eligible;
  const log = await deps.git.log(eligible.data.path, LOG_LIMIT);
  return { ok: true, data: log };
}
