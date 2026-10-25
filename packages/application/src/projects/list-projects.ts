import type { AppResult, ProjectSummary } from '@project-hub/contracts';
import type { ProjectRecord } from '@project-hub/domain';
import type { FileSystemPort, ProjectRepository } from '../ports';

export type ListProjectsDeps = {
  repo: ProjectRepository;
  fs: FileSystemPort;
};

/** Resumo que o renderer recebe: sem campos internos, com a disponibilidade da pasta. */
export function toProjectSummary(project: ProjectRecord, available: boolean): ProjectSummary {
  const summary: ProjectSummary = {
    id: project.id,
    name: project.name,
    path: project.path,
    repositoryKind: project.repositoryKind,
    available,
  };
  if (project.defaultBranch !== undefined) summary.defaultBranch = project.defaultBranch;
  if (project.groupName !== undefined) summary.group = project.groupName;
  if (project.nickname !== undefined) summary.nickname = project.nickname;
  return summary;
}

/**
 * Lista os projetos ativos. Um projeto cuja pasta sumiu continua na lista, marcado como
 * indisponível (RF-PROJ-006), e um projeto removido não aparece (RF-PROJ-005).
 */
export async function listProjects(deps: ListProjectsDeps): Promise<AppResult<ProjectSummary[]>> {
  const projects = deps.repo.list();
  const summaries = await Promise.all(
    projects.map(async (project) => toProjectSummary(project, await isAvailable(deps.fs, project))),
  );
  return { ok: true, data: summaries };
}

/**
 * Diz se a pasta do projeto está disponível. Erro ao consultar (sem permissão, por exemplo) não
 * derruba a listagem: o projeto sai indisponível, e o erro é registrado.
 */
export async function isAvailable(fs: FileSystemPort, project: ProjectRecord): Promise<boolean> {
  try {
    return await fs.isDirectory(project.path);
  } catch (error) {
    console.error(`Falha ao consultar a pasta do projeto ${project.id}:`, error);
    return false;
  }
}
