import type { AppResult, GitStatusDto } from '@project-hub/contracts';
import type { ProjectRecord } from '@project-hub/domain';
import type { FileSystemPort, GitPanelPort, ProjectRepository } from '../ports';
import { failure } from '../result';

/** Dependências de todo caso de uso do painel de código-fonte (ADR 0010). */
export type GitPanelDeps = {
  repo: ProjectRepository;
  git: GitPanelPort;
  fs: FileSystemPort;
};

/**
 * Confere o projeto antes de qualquer passo do Git, na mesma ordem da fase 1: precisa existir e estar ativo,
 * ser repositório Git e ter a pasta disponível. Devolve o registro, ou a falha que a tela mostra.
 */
export async function eligibleGitProject(
  deps: GitPanelDeps,
  projectId: string,
): Promise<AppResult<ProjectRecord>> {
  const project = deps.repo.get(projectId);
  if (project === undefined || project.removedAt !== undefined) {
    return failure('PROJECT_NOT_FOUND', 'O projeto não foi encontrado.');
  }
  if (project.repositoryKind !== 'git') {
    return failure('VALIDATION_FAILED', 'Esta pasta não é um repositório Git.');
  }
  if (!(await deps.fs.isDirectory(project.path))) {
    return failure('PROJECT_PATH_UNAVAILABLE', 'A pasta do projeto não está disponível.');
  }
  return { ok: true, data: project };
}

/**
 * Confere que todos os caminhos ficam dentro da pasta do projeto, resolvendo links simbólicos. Se algum
 * escapar, devolve a falha e quem chamou não toca na porta.
 */
export async function ensureInsideProject(
  deps: GitPanelDeps,
  project: ProjectRecord,
  paths: readonly string[],
): Promise<AppResult<void>> {
  const inside = await Promise.all(
    paths.map((path) => deps.fs.isInsideProject(project.path, path)),
  );
  if (inside.includes(false)) {
    return failure('VALIDATION_FAILED', 'Caminho fora da pasta do projeto.');
  }
  return { ok: true, data: undefined };
}

/**
 * Lê o estado do repositório e recusa o HEAD destacado. Envio, pull e fetch partem da branch atual, e o nome
 * dela nunca vem da tela: é lido aqui, pela porta.
 */
export async function namedBranchStatus(
  deps: GitPanelDeps,
  project: ProjectRecord,
): Promise<AppResult<GitStatusDto>> {
  const status = await deps.git.status(project.path);
  if (status.branch === null) {
    return failure(
      'GIT_DETACHED_HEAD',
      'Esta branch não tem nome (HEAD destacado): crie uma branch no terminal para enviar',
    );
  }
  return { ok: true, data: status };
}
