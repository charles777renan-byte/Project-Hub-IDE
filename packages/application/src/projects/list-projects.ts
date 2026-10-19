import type { AppResult, ProjectSummary } from '@project-hub/contracts';
import type { ProjectRecord } from '@project-hub/domain';
import type { FileSystemPort, ProjectRepository } from '../ports';

export type ListProjectsDeps = {
  repo: ProjectRepository;
  fs: FileSystemPort;
};

/** Resumo que o renderer recebe: sem campos internos, com a disponibilidade da pasta. */
export function toProjectSummary(project: ProjectRecord, available: boolean): ProjectSummary {
  return {
    id: project.id,
    name: project.name,
    path: project.path,
    repositoryKind: project.repositoryKind,
    available,
  };
}

/**
 * Lista os projetos ativos. Um projeto cuja pasta sumiu continua na lista, marcado como
 * indisponível (RF-PROJ-006), e um projeto removido não aparece (RF-PROJ-005).
 */
export async function listProjects(deps: ListProjectsDeps): Promise<AppResult<ProjectSummary[]>> {
  const projects = deps.repo.list();
  const summaries = await Promise.all(
    projects.map(async (project) =>
      toProjectSummary(project, await deps.fs.isDirectory(project.path)),
    ),
  );
  return { ok: true, data: summaries };
}
