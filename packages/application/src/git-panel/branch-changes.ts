import type { AppResult, BranchChangesDto } from '@project-hub/contracts';
import { eligibleGitProject, type GitPanelDeps } from './project';

/** Os arquivos que a branch mudou em relação à base (`origin/main`), desde o ponto de partida dela. */
export async function getProjectBranchChanges(
  deps: GitPanelDeps,
  input: { projectId: string },
): Promise<AppResult<BranchChangesDto>> {
  const eligible = await eligibleGitProject(deps, input.projectId);
  if (!eligible.ok) return eligible;
  const changes = await deps.git.branchChanges(eligible.data.path);
  return { ok: true, data: changes };
}
