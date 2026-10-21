import type { AppResult } from '@project-hub/contracts';
import type { Mission } from '@project-hub/domain';
import type { FileSystemPort, MissionRepository, ProjectRepository, WorktreePort } from '../ports';
import { errorCode, failure } from '../result';

export type DeleteMissionDeps = {
  repo: Pick<MissionRepository, 'getMission' | 'deleteMission'>;
  projects: Pick<ProjectRepository, 'get'>;
  worktrees: Pick<WorktreePort, 'remove'>;
  fs: FileSystemPort;
};

/** Só missões que já terminaram podem ser excluídas. As outras, a pessoa cancela antes. */
const ENDED_STATUSES: readonly Mission['status'][] = ['succeeded', 'failed', 'cancelled'];

/**
 * Exclui uma missão encerrada, com o plano, as tentativas, as aprovações e a auditoria. O worktree
 * sai antes, pelo Git: se ele tiver alterações não salvas, a remoção recusa e a missão fica como está.
 * A branch do worktree continua no repositório. Pasta de worktree que já sumiu não bloqueia a exclusão.
 */
export async function deleteMission(
  deps: DeleteMissionDeps,
  missionId: string,
): Promise<AppResult<undefined>> {
  const mission = deps.repo.getMission(missionId);
  if (mission === undefined) return failure('MISSION_NOT_FOUND', 'A missão não foi encontrada.');
  if (!ENDED_STATUSES.includes(mission.status)) {
    return failure(
      'MISSION_INVALID_STATE',
      'Só missões encerradas podem ser excluídas. Cancele a missão antes.',
    );
  }
  const project = deps.projects.get(mission.projectId);
  if (project === undefined) {
    return failure('PROJECT_NOT_FOUND', 'O projeto da missão não foi encontrado.');
  }

  if (mission.worktreePath !== undefined && (await deps.fs.isDirectory(mission.worktreePath))) {
    try {
      await deps.worktrees.remove({ repoPath: project.path, worktreePath: mission.worktreePath });
    } catch (error) {
      const code = errorCode(error);
      if (code === undefined) throw error;
      return failure(code, error instanceof Error ? error.message : 'Falha ao remover o worktree.');
    }
  }

  deps.repo.deleteMission(mission.id);
  return { ok: true, data: undefined };
}
