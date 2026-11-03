import type { AppResult } from '@project-hub/contracts';
import { failure } from '../result';
import { eligibleGitProject, ensureInsideProject, type GitPanelDeps } from './project';

type PathsInput = { projectId: string; paths: readonly string[] };

/**
 * Confere o projeto, a lista (não pode ser vazia: `git add --` sem caminho não deve chegar ao Git) e cada
 * caminho, nessa ordem, e só então roda a operação da porta.
 */
async function onPaths(
  deps: GitPanelDeps,
  input: PathsInput,
  run: (repoPath: string, paths: readonly string[]) => Promise<void>,
): Promise<AppResult<void>> {
  const eligible = await eligibleGitProject(deps, input.projectId);
  if (!eligible.ok) return eligible;
  if (input.paths.length === 0) {
    return failure('VALIDATION_FAILED', 'Escolha ao menos um arquivo.');
  }
  const inside = await ensureInsideProject(deps, eligible.data, input.paths);
  if (!inside.ok) return inside;
  await run(eligible.data.path, input.paths);
  return { ok: true, data: undefined };
}

/** Põe os arquivos em stage. */
export function stagePaths(deps: GitPanelDeps, input: PathsInput): Promise<AppResult<void>> {
  return onPaths(deps, input, (repoPath, paths) => deps.git.stage(repoPath, paths));
}

/** Tira os arquivos do stage, sem mexer no disco. */
export function unstagePaths(deps: GitPanelDeps, input: PathsInput): Promise<AppResult<void>> {
  return onPaths(deps, input, (repoPath, paths) => deps.git.unstage(repoPath, paths));
}

/** Desfaz as alterações do disco nos arquivos. A confirmação da pessoa é da tela; as regras do Git, do adaptador. */
export function discardPaths(deps: GitPanelDeps, input: PathsInput): Promise<AppResult<void>> {
  return onPaths(deps, input, (repoPath, paths) => deps.git.discard(repoPath, paths));
}
