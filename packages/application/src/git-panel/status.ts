import type { AppResult, GitStatusDto } from '@project-hub/contracts';
import { eligibleGitProject, type GitPanelDeps } from './project';

/** O estado do painel: branch, upstream, à frente e atrás, linhas contra a base e a lista de arquivos. */
export async function getGitStatus(
  deps: GitPanelDeps,
  input: { projectId: string },
): Promise<AppResult<GitStatusDto>> {
  const eligible = await eligibleGitProject(deps, input.projectId);
  if (!eligible.ok) return eligible;
  const status = await deps.git.status(eligible.data.path);
  return { ok: true, data: status };
}
