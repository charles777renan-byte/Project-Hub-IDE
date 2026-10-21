import type { ProjectRecord } from '@project-hub/domain';
import type { FileSystemPort, GitDetector, ProjectRepository } from '../src/ports';

/**
 * Repositório em memória que segue o contrato do ProjectRepository do banco: `list` esconde os
 * removidos e os arquivados, `listArchived` mostra só os arquivados, `findByNormalizedPath` inclui
 * todos e `insert` recusa caminho repetido, como o índice único.
 */
export function fakeRepository(): ProjectRepository & { records(): ProjectRecord[] } {
  const byId = new Map<string, ProjectRecord>();
  const copy = (record: ProjectRecord | undefined) =>
    record === undefined ? undefined : { ...record };

  return {
    insert(project) {
      const taken = [...byId.values()].some((r) => r.normalizedPath === project.normalizedPath);
      if (taken) throw new Error('UNIQUE constraint failed: projects.normalized_path');
      byId.set(project.id, {
        ...project,
        isFavorite: false,
        trusted: false,
        updatedAt: project.createdAt,
      });
    },
    get: (id) => copy(byId.get(id)),
    list: () =>
      [...byId.values()]
        .filter((r) => r.removedAt === undefined && r.archivedAt === undefined)
        .map((r) => ({ ...r })),
    listArchived: () =>
      [...byId.values()]
        .filter((r) => r.removedAt === undefined && r.archivedAt !== undefined)
        .sort((a, b) => (a.archivedAt ?? '').localeCompare(b.archivedAt ?? ''))
        .map((r) => ({ ...r })),
    findByNormalizedPath: (normalizedPath) =>
      copy([...byId.values()].find((r) => r.normalizedPath === normalizedPath)),
    archive(id, archivedAt) {
      const record = byId.get(id);
      if (record !== undefined) byId.set(id, { ...record, archivedAt, updatedAt: archivedAt });
    },
    unarchive(id, updatedAt) {
      const record = byId.get(id);
      if (record === undefined) return;
      const unarchived: ProjectRecord = { ...record, updatedAt };
      delete unarchived.archivedAt;
      byId.set(id, unarchived);
    },
    markRemoved(id, removedAt) {
      const record = byId.get(id);
      if (record !== undefined) byId.set(id, { ...record, removedAt, updatedAt: removedAt });
    },
    restore(id, updatedAt, git) {
      const record = byId.get(id);
      if (record === undefined) return;
      // Como o banco: a detecção nova substitui a antiga, inclusive a branch (some se não houver).
      const restored: ProjectRecord = { ...record, repositoryKind: git.repositoryKind, updatedAt };
      delete restored.removedAt;
      delete restored.archivedAt;
      delete restored.defaultBranch;
      if (git.defaultBranch !== undefined) restored.defaultBranch = git.defaultBranch;
      byId.set(id, restored);
    },
    records: () => [...byId.values()].map((r) => ({ ...r })),
  };
}

/**
 * Sistema de arquivos em memória: só as pastas listadas existem, e são diretórios. No Windows o
 * disco não diferencia caixa, então os testes desse caso passam `caseInsensitive`.
 */
export function fakeFileSystem(
  directories: readonly string[],
  options: { caseInsensitive?: boolean } = {},
): FileSystemPort & { remove(path: string): void } {
  const key = (path: string) => (options.caseInsensitive === true ? path.toLowerCase() : path);
  const existing = new Set(directories.map(key));
  return {
    isDirectory: (path) => Promise.resolve(existing.has(key(path))),
    remove: (path) => {
      existing.delete(key(path));
    },
  };
}

export function fakeGit(result: Awaited<ReturnType<GitDetector['detect']>>): GitDetector {
  return { detect: () => Promise.resolve(result) };
}
