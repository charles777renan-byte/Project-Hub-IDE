import type { AppResult, ProjectSummary } from '@project-hub/contracts';
import type { Mission, ProjectRecord } from '@project-hub/domain';
import type { FileSystemPort, MissionRepository, ProjectRepository } from '../ports';
import { failure } from '../result';
import { isAvailable, toProjectSummary } from './list-projects';

export type ProjectLifecycleDeps = {
  repo: ProjectRepository;
  missions: Pick<MissionRepository, 'listMissions'>;
  fs: FileSystemPort;
  now: () => string;
};

/** Missões na fila, com agente vivo ou à espera de uma decisão. Enquanto houver uma, o projeto não sai. */
const LIVE_STATUSES: readonly Mission['status'][] = [
  'queued',
  'running',
  'waiting_approval',
  'waiting_input',
  'paused',
];

const NOT_FOUND = 'O projeto não foi encontrado.';
const HAS_LIVE_MISSIONS =
  'Há missões em andamento neste projeto. Cancele ou aguarde antes de arquivar ou remover.';

/** Projeto que aparece na lista: nem removido, nem arquivado. */
function listedProject(deps: ProjectLifecycleDeps, projectId: string): ProjectRecord | undefined {
  const project = deps.repo.get(projectId);
  if (project === undefined || project.removedAt !== undefined) return undefined;
  return project.archivedAt === undefined ? project : undefined;
}

function hasLiveMissions(deps: ProjectLifecycleDeps, projectId: string): boolean {
  return deps.missions
    .listMissions(projectId)
    .some((mission) => LIVE_STATUSES.includes(mission.status));
}

/**
 * Arquiva o projeto: ele sai da lista principal, com as missões e o histórico guardados. Dá para
 * restaurar pela seção de arquivados. Não toca na pasta nem no Git.
 */
export function archiveProject(
  deps: ProjectLifecycleDeps,
  input: { projectId: string },
): AppResult<undefined> {
  const project = listedProject(deps, input.projectId);
  if (project === undefined) return failure('PROJECT_NOT_FOUND', NOT_FOUND);
  if (hasLiveMissions(deps, project.id)) return failure('MISSION_INVALID_STATE', HAS_LIVE_MISSIONS);
  deps.repo.archive(project.id, deps.now());
  return { ok: true, data: undefined };
}

/** Tira o projeto do arquivo, de volta para a lista principal. */
export function unarchiveProject(
  deps: ProjectLifecycleDeps,
  input: { projectId: string },
): AppResult<undefined> {
  const project = deps.repo.get(input.projectId);
  if (
    project === undefined ||
    project.removedAt !== undefined ||
    project.archivedAt === undefined
  ) {
    return failure('PROJECT_NOT_FOUND', NOT_FOUND);
  }
  deps.repo.unarchive(project.id, deps.now());
  return { ok: true, data: undefined };
}

/**
 * Remove o projeto da lista (remoção lógica, como já era). Não toca na pasta, no Git nem nas missões:
 * cadastrar a pasta de novo traz o mesmo projeto de volta, com o histórico.
 */
export function removeProject(
  deps: ProjectLifecycleDeps,
  input: { projectId: string },
): AppResult<undefined> {
  const project = deps.repo.get(input.projectId);
  if (project === undefined || project.removedAt !== undefined) {
    return failure('PROJECT_NOT_FOUND', NOT_FOUND);
  }
  if (hasLiveMissions(deps, project.id)) return failure('MISSION_INVALID_STATE', HAS_LIVE_MISSIONS);
  deps.repo.markRemoved(project.id, deps.now());
  return { ok: true, data: undefined };
}

/** Os projetos arquivados, com a disponibilidade da pasta, para a seção de arquivados. */
export async function listArchivedProjects(
  deps: Pick<ProjectLifecycleDeps, 'repo' | 'fs'>,
): Promise<AppResult<ProjectSummary[]>> {
  const projects = deps.repo.listArchived();
  const summaries = await Promise.all(
    projects.map(async (project) => toProjectSummary(project, await isAvailable(deps.fs, project))),
  );
  return { ok: true, data: summaries };
}
