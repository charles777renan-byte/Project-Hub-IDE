import type { AppResult, GitFileDiffDto } from '@project-hub/contracts';
import { failure } from '../result';
import { eligibleGitProject, ensureInsideProject, type GitPanelDeps } from './project';

/**
 * O diff de um arquivo contra o último commit (`HEAD`): a pasta de trabalho comparada com ele. O caminho é
 * relativo à pasta do projeto e é conferido antes da porta. Projeto sem nenhum commit não tem com o que comparar.
 */
export async function getFileDiff(
  deps: GitPanelDeps,
  input: { projectId: string; path: string },
): Promise<AppResult<GitFileDiffDto>> {
  const eligible = await eligibleGitProject(deps, input.projectId);
  if (!eligible.ok) return eligible;
  const inside = await ensureInsideProject(deps, eligible.data, [input.path]);
  if (!inside.ok) return inside;
  const diff = await deps.git.fileDiff(eligible.data.path, input.path);
  if (diff === null) {
    return failure(
      'VALIDATION_FAILED',
      'Não há commit para comparar: o projeto ainda não tem nenhum commit.',
    );
  }
  return { ok: true, data: diff };
}
