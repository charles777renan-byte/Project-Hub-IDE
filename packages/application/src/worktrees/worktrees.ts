import type { AppResult, WorktreeDto } from '@project-hub/contracts';
import type {
  DiffPort,
  FileSystemPort,
  MissionRepository,
  ProjectRepository,
  WorktreePort,
} from '../ports';
import { errorCode, failure } from '../result';

/** Quantos arquivos a recusa nomeia: o suficiente para a pessoa saber o que salvar ou descartar. */
const MAX_BLOCKING_FILES = 20;

const PROJECT_NOT_FOUND = 'O projeto não foi encontrado.';

export type ListWorktreesDeps = {
  repo: Pick<MissionRepository, 'listMissions' | 'listAudit'>;
  projects: Pick<ProjectRepository, 'get'>;
  fs: FileSystemPort;
};

/** A branch que o worktree da missão recebeu, guardada na auditoria quando ele foi criado. */
function branchOf(repo: ListWorktreesDeps['repo'], missionId: string): string | undefined {
  const created = repo
    .listAudit(missionId)
    .filter((event) => event.eventType === 'worktree.created')
    .at(-1);
  const branch = created?.payload['branch'];
  return typeof branch === 'string' ? branch : undefined;
}

/**
 * Worktrees do projeto, derivados das missões. Entra a missão que guarda um worktree e cuja pasta
 * ainda existe: um worktree já removido some da lista. O banco não tem tabela de worktrees (a
 * missão guarda o caminho), e a branch vem da auditoria da criação.
 */
export async function listWorktrees(
  deps: ListWorktreesDeps,
  projectId: string,
): Promise<AppResult<WorktreeDto[]>> {
  if (deps.projects.get(projectId) === undefined) {
    return failure('PROJECT_NOT_FOUND', PROJECT_NOT_FOUND);
  }
  const entries: WorktreeDto[] = [];
  for (const mission of deps.repo.listMissions(projectId)) {
    const path = mission.worktreePath;
    if (path === undefined || !(await deps.fs.isDirectory(path))) continue;
    const entry: WorktreeDto = {
      missionId: mission.id,
      missionTitle: mission.title,
      status: mission.status,
      path,
    };
    const branch = branchOf(deps.repo, mission.id);
    if (branch !== undefined) entry.branch = branch;
    entries.push(entry);
  }
  return { ok: true, data: entries };
}

/** Os arquivos alterados do worktree, para dizer o que impede a remoção. Falha do Git não atrapalha a recusa. */
async function blockingFiles(diff: DiffPort, worktreePath: string): Promise<string[]> {
  try {
    const { files } = await diff.diff(worktreePath);
    return files.slice(0, MAX_BLOCKING_FILES).map((file) => file.path);
  } catch {
    return [];
  }
}

export type DropWorktreeDeps = {
  worktrees: Pick<WorktreePort, 'remove'>;
  /** Opcional: com ele, a recusa por alteração não salva traz os arquivos em `details.files`. */
  diff?: DiffPort;
};

/**
 * A remoção do worktree pelo Git, num só lugar: serve à aba Worktrees e à exclusão da missão. Nada é
 * forçado: o Git recusa quando há alteração não salva, e a branch continua no repositório. A falha
 * com código do contrato vira recusa; erro sem código segue para cima. Quem chama confere antes se a
 * missão pode perder o worktree e se a pasta existe.
 */
export async function dropWorktree(
  deps: DropWorktreeDeps,
  input: { repoPath: string; worktreePath: string },
): Promise<AppResult<undefined>> {
  try {
    await deps.worktrees.remove(input);
  } catch (error) {
    const code = errorCode(error);
    if (code === undefined) throw error;
    const message = error instanceof Error ? error.message : 'Falha ao remover o worktree.';
    if (code !== 'WORKTREE_HAS_UNSAVED_CHANGES' || deps.diff === undefined) {
      return failure(code, message);
    }
    const files = await blockingFiles(deps.diff, input.worktreePath);
    return { ok: false, error: { code, message, details: { files }, retryable: false } };
  }
  return { ok: true, data: undefined };
}

export type RemoveWorktreeDeps = {
  repo: Pick<MissionRepository, 'getMission' | 'appendAudit'>;
  projects: Pick<ProjectRepository, 'get'>;
  worktrees: Pick<WorktreePort, 'remove'>;
  fs: FileSystemPort;
  /** Lista os arquivos que impedem a remoção, quando o Git recusa por alteração não salva. */
  diff: DiffPort;
  now: () => string;
};

/**
 * Remove o worktree de uma missão concluída. Missão que falhou, foi cancelada ou ainda está em andamento
 * recusa com MISSION_INVALID_STATE: só o trabalho concluído libera a pasta. O Git recusa quando há
 * alteração não salva (nada é forçado) e a branch continua no repositório. A recusa traz o código do
 * Git e, em `details.files`, os arquivos que impedem. A missão não muda: ela segue com o caminho e o
 * histórico, e a pasta que sumiu deixa o worktree fora da lista.
 */
export async function removeMissionWorktree(
  deps: RemoveWorktreeDeps,
  missionId: string,
): Promise<AppResult<undefined>> {
  const mission = deps.repo.getMission(missionId);
  if (mission === undefined) return failure('MISSION_NOT_FOUND', 'A missão não foi encontrada.');
  if (mission.status !== 'succeeded') {
    return failure(
      'MISSION_INVALID_STATE',
      'Só o worktree de uma missão concluída pode ser removido. Missão em andamento, que falhou ou foi cancelada mantém o worktree.',
    );
  }
  const project = deps.projects.get(mission.projectId);
  if (project === undefined) return failure('PROJECT_NOT_FOUND', PROJECT_NOT_FOUND);
  const worktreePath = mission.worktreePath;
  if (worktreePath === undefined || !(await deps.fs.isDirectory(worktreePath))) {
    return failure('MISSION_INVALID_STATE', 'Esta missão não tem um worktree em disco.');
  }

  const dropped = await dropWorktree(deps, { repoPath: project.path, worktreePath });
  if (!dropped.ok) return dropped;

  deps.repo.appendAudit({
    aggregateType: 'mission',
    aggregateId: mission.id,
    eventType: 'worktree.removed',
    severity: 'info',
    actor: 'user',
    payload: { path: worktreePath },
    createdAt: deps.now(),
  });
  return { ok: true, data: undefined };
}
