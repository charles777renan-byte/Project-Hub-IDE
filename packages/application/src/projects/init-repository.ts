import type { AppResult, RepositoryInitPreview } from '@project-hub/contracts';
import type { ProjectRecord } from '@project-hub/domain';
import type { FileSystemPort, ProjectRepository, RepositoryInitializer } from '../ports';
import { failure } from '../result';

export type InitRepositoryDeps = {
  repo: ProjectRepository;
  initializer: RepositoryInitializer;
  fs: FileSystemPort;
  now: () => string;
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

/** O que a confirmação mostra. Não escreve nada: a leitura é do adaptador do Git. */
export async function previewRepositoryInit(
  deps: InitRepositoryDeps,
  input: { projectId: string },
): Promise<AppResult<RepositoryInitPreview>> {
  const eligible = await eligibleProject(deps, input.projectId);
  if (!eligible.ok) return eligible;
  return deps.initializer.preview(eligible.data.path);
}

/**
 * Cria o repositório Git da pasta e grava o tipo e a branch padrão no projeto. Os passos de escrita ficam no
 * adaptador; aqui só entra a checagem do projeto e a gravação do resultado.
 */
export async function initProjectRepository(
  deps: InitRepositoryDeps,
  input: { projectId: string },
): Promise<AppResult<ProjectRecord>> {
  const eligible = await eligibleProject(deps, input.projectId);
  if (!eligible.ok) return eligible;
  const created = await deps.initializer.init(eligible.data.path);
  if (!created.ok) return created;

  const timestamp = deps.now();
  deps.repo.setRepositoryKind(
    input.projectId,
    { repositoryKind: 'git', defaultBranch: created.data.defaultBranch },
    timestamp,
  );
  const updated = deps.repo.get(input.projectId);
  if (updated === undefined) return failure('PROJECT_NOT_FOUND', 'O projeto não foi encontrado.');
  return { ok: true, data: updated };
}
