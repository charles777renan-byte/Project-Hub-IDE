import type {
  AppResult,
  GitCommitResultDto,
  GitPullResultDto,
  GitPushResultDto,
} from '@project-hub/contracts';
import { failure } from '../result';
import { eligibleGitProject, namedBranchStatus, type GitPanelDeps } from './project';

type ProjectInput = { projectId: string };

/** Cria o commit com o que está em stage. A mensagem já chega conferida pelo contrato. */
export async function commitChanges(
  deps: GitPanelDeps,
  input: ProjectInput & { message: string },
): Promise<AppResult<GitCommitResultDto>> {
  const eligible = await eligibleGitProject(deps, input.projectId);
  if (!eligible.ok) return eligible;
  const commit = await deps.git.commit(eligible.data.path, input.message);
  return { ok: true, data: commit };
}

/**
 * Envio e publicação rodam o mesmo `push -u origin HEAD`; a diferença é a regra sobre o upstream. O HEAD
 * destacado é conferido antes.
 */
async function sendBranch(
  deps: GitPanelDeps,
  input: ProjectInput,
  rule: { hasUpstream: boolean; message: string },
): Promise<AppResult<GitPushResultDto>> {
  const eligible = await eligibleGitProject(deps, input.projectId);
  if (!eligible.ok) return eligible;
  const status = await namedBranchStatus(deps, eligible.data);
  if (!status.ok) return status;
  if ((status.data.upstream !== null) !== rule.hasUpstream) {
    return failure('VALIDATION_FAILED', rule.message);
  }
  const pushed = await deps.git.push(eligible.data.path);
  return { ok: true, data: pushed };
}

/** Envia a branch que já tem upstream. */
export function pushProjectBranch(
  deps: GitPanelDeps,
  input: ProjectInput,
): Promise<AppResult<GitPushResultDto>> {
  return sendBranch(deps, input, {
    hasUpstream: true,
    message: 'Esta branch ainda não tem upstream: use Publicar branch.',
  });
}

/** Publica a branch que ainda não tem upstream (`push -u`). */
export function publishProjectBranch(
  deps: GitPanelDeps,
  input: ProjectInput,
): Promise<AppResult<GitPushResultDto>> {
  return sendBranch(deps, input, {
    hasUpstream: false,
    message: 'Esta branch já tem upstream: use Enviar.',
  });
}

/** Traz os commits do remoto só se a branch puder avançar (`pull --ff-only`). */
export async function pullProject(
  deps: GitPanelDeps,
  input: ProjectInput,
): Promise<AppResult<GitPullResultDto>> {
  const eligible = await eligibleGitProject(deps, input.projectId);
  if (!eligible.ok) return eligible;
  const status = await namedBranchStatus(deps, eligible.data);
  if (!status.ok) return status;
  const pulled = await deps.git.pull(eligible.data.path);
  return { ok: true, data: pulled };
}

/** Atualiza as refs remotas. Recusa o HEAD destacado como o resto, embora o fetch não precise da branch. */
export async function fetchProject(
  deps: GitPanelDeps,
  input: ProjectInput,
): Promise<AppResult<void>> {
  const eligible = await eligibleGitProject(deps, input.projectId);
  if (!eligible.ok) return eligible;
  const status = await namedBranchStatus(deps, eligible.data);
  if (!status.ok) return status;
  await deps.git.fetch(eligible.data.path);
  return { ok: true, data: undefined };
}
