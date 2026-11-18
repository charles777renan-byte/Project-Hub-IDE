import type { AppResult, GitIdentity, RepositoryInitPreview } from '@project-hub/contracts';
import type { ProjectRecord } from '@project-hub/domain';
import type { FileSystemPort, ProjectRepository, RepositoryInitializer } from '../ports';
import { failure } from '../result';
import { rememberGitIdentity, suggestGitIdentity, type GitIdentityDeps } from './git-identity';

export type InitRepositoryDeps = {
  repo: ProjectRepository;
  initializer: RepositoryInitializer;
  fs: FileSystemPort;
  now: () => string;
  /** De onde sai o autor proposto para o primeiro commit, quando o Git não tem identidade. */
  identity: GitIdentityDeps;
};

/**
 * Confere o projeto antes de qualquer passo do Git (ADR 0009): precisa existir, estar ativo, não ser repositório
 * Git e ter a pasta disponível. Devolve o registro, ou a falha que a tela mostra.
 */
async function eligibleProject(
  deps: InitRepositoryDeps,
  projectId: string,
): Promise<AppResult<ProjectRecord>> {
  const project = deps.repo.get(projectId);
  if (project === undefined || project.removedAt !== undefined) {
    return failure('PROJECT_NOT_FOUND', 'O projeto não foi encontrado.');
  }
  if (project.repositoryKind === 'git') {
    return failure('VALIDATION_FAILED', 'Esta pasta já é um repositório Git.');
  }
  if (!(await deps.fs.isDirectory(project.path))) {
    return failure('PROJECT_PATH_UNAVAILABLE', 'A pasta do projeto não está disponível.');
  }
  return { ok: true, data: project };
}

/**
 * O que a confirmação mostra. Não escreve nada: a leitura é do adaptador do Git. Sem identidade no Git, a
 * prévia leva o autor que o aplicativo propõe, para a pessoa ver e confirmar.
 */
export async function previewRepositoryInit(
  deps: InitRepositoryDeps,
  input: { projectId: string },
): Promise<AppResult<RepositoryInitPreview>> {
  const eligible = await eligibleProject(deps, input.projectId);
  if (!eligible.ok) return eligible;
  const preview = await deps.initializer.preview(eligible.data.path);
  if (!preview.ok || preview.data.identityConfigured) return preview;
  return { ok: true, data: { ...preview.data, suggestedIdentity: suggestGitIdentity(deps.identity) } };
}

/**
 * Cria o repositório Git da pasta e grava o tipo e a branch padrão no projeto. Os passos de escrita ficam no
 * adaptador; aqui só entra a checagem do projeto e a gravação do resultado. `identity` é o autor que a pessoa
 * confirmou quando o Git não tem identidade; criado o repositório, ele fica guardado para a próxima proposta.
 */
export async function initProjectRepository(
  deps: InitRepositoryDeps,
  input: { projectId: string; identity?: GitIdentity | undefined },
): Promise<AppResult<ProjectRecord>> {
  const eligible = await eligibleProject(deps, input.projectId);
  if (!eligible.ok) return eligible;
  const created = await deps.initializer.init(eligible.data.path, input.identity);
  if (!created.ok) return created;

  const timestamp = deps.now();
  if (input.identity !== undefined) rememberGitIdentity(deps.identity, input.identity, timestamp);
  deps.repo.setRepositoryKind(
    input.projectId,
    { repositoryKind: 'git', defaultBranch: created.data.defaultBranch },
    timestamp,
  );
  const updated = deps.repo.get(input.projectId);
  if (updated === undefined) return failure('PROJECT_NOT_FOUND', 'O projeto não foi encontrado.');
  return { ok: true, data: updated };
}
