import type { AppResult } from '@project-hub/contracts';
import type { NewProject, ProjectRecord } from '@project-hub/domain';
import type { FileSystemPort, GitDetector, ProjectRepository } from '../ports';
import { failure } from '../result';
import {
  isAbsoluteProjectPath,
  normalizePath,
  platformPaths,
  resolveProjectPath,
  type Platform,
} from './normalize-path';

export type AddProjectDeps = {
  repo: ProjectRepository;
  git: GitDetector;
  fs: FileSystemPort;
  /** Regras de caminho da plataforma, usadas por `normalizePath`. */
  platform: Platform;
  now: () => string;
  newId: () => string;
};

const ALREADY_EXISTS = 'Esta pasta já está cadastrada.';

/** Ativo é o que aparece na lista: nem removido, nem arquivado. Pasta fora disso volta pelo mesmo registro. */
function isActive(project: ProjectRecord): boolean {
  return project.removedAt === undefined && project.archivedAt === undefined;
}

/**
 * Cadastra uma pasta como projeto (RF-PROJ-001 a RF-PROJ-003). O caminho precisa ser absoluto e
 * apontar para um diretório. Uma pasta já cadastrada e ativa é recusada, sem rodar o Git. Uma pasta
 * removida volta pelo mesmo registro, sem inserir outro, com o tipo e a branch que o Git detecta agora.
 */
export async function addProject(
  deps: AddProjectDeps,
  input: { path: string },
): Promise<AppResult<ProjectRecord>> {
  const paths = platformPaths(deps.platform);
  if (!isAbsoluteProjectPath(input.path, deps.platform)) {
    return failure('VALIDATION_FAILED', 'O caminho do projeto precisa ser absoluto.');
  }
  const path = resolveProjectPath(input.path, deps.platform);
  const normalizedPath = normalizePath(input.path, deps.platform);

  if (!(await deps.fs.isDirectory(path))) {
    return failure('PROJECT_PATH_UNAVAILABLE', 'A pasta não existe ou não é um diretório.');
  }

  // Primeira consulta: uma pasta já cadastrada e ativa nunca chega ao Git (R85).
  const known = deps.repo.findByNormalizedPath(normalizedPath);
  if (known !== undefined && isActive(known)) {
    return failure('PROJECT_ALREADY_EXISTS', ALREADY_EXISTS);
  }
  const detection = await deps.git.detect(path);

  // O Git é assíncrono, então outro cadastro da mesma pasta pode ter gravado enquanto ele rodava. A
  // consulta que vale é esta, e daqui até a escrita não há await: ela e a gravação não se intercalam.
  const existing = deps.repo.findByNormalizedPath(normalizedPath);
  const timestamp = deps.now();
  if (existing !== undefined && isActive(existing)) {
    return failure('PROJECT_ALREADY_EXISTS', ALREADY_EXISTS);
  }
  if (existing !== undefined) {
    const git: { repositoryKind: 'git' | 'none'; defaultBranch?: string } = {
      repositoryKind: detection.kind,
    };
    if (detection.defaultBranch !== undefined) git.defaultBranch = detection.defaultBranch;
    deps.repo.restore(existing.id, timestamp, git);
    const restored: ProjectRecord = { ...existing, ...git, updatedAt: timestamp };
    delete restored.removedAt;
    delete restored.archivedAt;
    // A branch antiga não vale mais: sem `defaultBranch` na detecção nova, ela sai do registro.
    if (git.defaultBranch === undefined) delete restored.defaultBranch;
    return { ok: true, data: restored };
  }

  const project: NewProject = {
    id: deps.newId(),
    name: paths.basename(path) || path,
    path,
    normalizedPath,
    repositoryKind: detection.kind,
    createdAt: timestamp,
  };
  if (detection.defaultBranch !== undefined) project.defaultBranch = detection.defaultBranch;
  deps.repo.insert(project);

  return {
    ok: true,
    data: { ...project, isFavorite: false, trusted: false, updatedAt: timestamp },
  };
}
