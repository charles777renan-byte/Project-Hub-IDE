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

/**
 * Cadastra uma pasta como projeto (RF-PROJ-001 a RF-PROJ-003). O caminho precisa ser absoluto e
 * apontar para um diretório. Uma pasta já cadastrada e ativa é recusada. Uma pasta removida volta
 * pelo mesmo registro, sem inserir outro.
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
  const detection = await deps.git.detect(path);

  // Daqui até a escrita não há await: a consulta e a gravação não se intercalam com outro cadastro.
  const existing = deps.repo.findByNormalizedPath(normalizedPath);
  const timestamp = deps.now();
  if (existing !== undefined && existing.removedAt === undefined) {
    return failure('PROJECT_ALREADY_EXISTS', 'Esta pasta já está cadastrada.');
  }
  if (existing !== undefined) {
    deps.repo.restore(existing.id, timestamp);
    const restored: ProjectRecord = { ...existing, updatedAt: timestamp };
    delete restored.removedAt;
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
