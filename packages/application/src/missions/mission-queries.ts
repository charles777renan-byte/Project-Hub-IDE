import type { AppResult, MissionDiffDto } from '@project-hub/contracts';
import type {
  ApprovalRequest,
  AuditEvent,
  Execution,
  Mission,
  MissionStep,
} from '@project-hub/domain';
import type { DiffPort, MissionRepository, ProjectRepository } from '../ports';
import { errorCode, failure } from '../result';

export type MissionQueryDeps = {
  repo: Pick<
    MissionRepository,
    | 'getMission'
    | 'listMissions'
    | 'listSteps'
    | 'listExecutions'
    | 'listPendingApprovals'
    | 'listAudit'
  >;
  projects: Pick<ProjectRepository, 'get'>;
};

/** O projeto, do jeito que a tela de missão precisa: nome, pasta e branch padrão. */
export type MissionProject = {
  id: string;
  name: string;
  path: string;
  defaultBranch?: string;
};

/** Evento da auditoria com a missão a que ele pertence. */
export type MissionEvent = AuditEvent & { missionId: string };

/** Tudo que a tela de uma missão mostra, de uma vez (seção 10.7). */
export type MissionView = {
  mission: Mission;
  project: MissionProject;
  steps: MissionStep[];
  executions: Execution[];
  pendingApprovals: ApprovalRequest[];
  /** Auditoria da missão e das tentativas, da mais antiga para a mais nova. */
  events: MissionEvent[];
};

const PROJECT_NOT_FOUND = 'O projeto não foi encontrado.';
const MISSION_NOT_FOUND = 'A missão não foi encontrada.';

/** Missões de um projeto, da mais recente para a mais antiga. */
export function listMissions(deps: MissionQueryDeps, projectId: string): AppResult<Mission[]> {
  if (deps.projects.get(projectId) === undefined) {
    return failure('PROJECT_NOT_FOUND', PROJECT_NOT_FOUND);
  }
  return { ok: true, data: deps.repo.listMissions(projectId) };
}

export type MissionDiffDeps = {
  repo: Pick<MissionRepository, 'getMission'>;
  diff: DiffPort;
};

/**
 * Alterações do worktree da missão (aba Alterações). Missão sem worktree ainda não tem o que
 * comparar: a resposta é a lista vazia, não um erro. Falha do Git sai com o código dele; erro sem
 * código do contrato segue para cima, como nos casos de uso do orquestrador.
 */
export async function getMissionDiff(
  deps: MissionDiffDeps,
  missionId: string,
): Promise<AppResult<MissionDiffDto>> {
  const mission = deps.repo.getMission(missionId);
  if (mission === undefined) return failure('MISSION_NOT_FOUND', MISSION_NOT_FOUND);
  if (mission.worktreePath === undefined) {
    return { ok: true, data: { files: [], truncatedFiles: false } };
  }
  try {
    return { ok: true, data: await deps.diff.diff(mission.worktreePath) };
  } catch (error) {
    const code = errorCode(error);
    if (code === undefined) throw error;
    return failure(code, error instanceof Error ? error.message : 'Falha ao ler as alterações.');
  }
}

/** A visão completa de uma missão. Os eventos vêm da missão e de cada tentativa, em ordem de instante. */
export function getMissionView(deps: MissionQueryDeps, missionId: string): AppResult<MissionView> {
  const mission = deps.repo.getMission(missionId);
  if (mission === undefined) return failure('MISSION_NOT_FOUND', MISSION_NOT_FOUND);
  const project = deps.projects.get(mission.projectId);
  if (project === undefined) return failure('PROJECT_NOT_FOUND', PROJECT_NOT_FOUND);

  const executions = deps.repo.listExecutions(missionId);
  const events: MissionEvent[] = [
    ...deps.repo.listAudit(missionId),
    ...executions.flatMap((execution) => deps.repo.listAudit(execution.id)),
  ]
    .map((event) => ({ ...event, missionId }))
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));

  const projectView: MissionProject = { id: project.id, name: project.name, path: project.path };
  if (project.defaultBranch !== undefined) projectView.defaultBranch = project.defaultBranch;

  return {
    ok: true,
    data: {
      mission,
      project: projectView,
      steps: deps.repo.listSteps(missionId),
      executions,
      pendingApprovals: executions.flatMap((execution) =>
        deps.repo.listPendingApprovals(execution.id),
      ),
      events,
    },
  };
}
