import type {
  BranchChangesDto,
  GitFileDiffDto,
  GitLogEntryDto,
  GitStatusDto,
} from '@project-hub/contracts';
import type { ProjectRecord } from '@project-hub/domain';
import type { FileSystemPort, GitDetector, GitPanelPort, ProjectRepository } from '../src/ports';

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
    setGroup(id, groupName, updatedAt) {
      const record = byId.get(id);
      if (record === undefined) return;
      const grouped: ProjectRecord = { ...record, updatedAt };
      if (groupName === null) delete grouped.groupName;
      else grouped.groupName = groupName;
      byId.set(id, grouped);
    },
    setNickname(id, nickname, updatedAt) {
      const record = byId.get(id);
      if (record === undefined) return;
      const named: ProjectRecord = { ...record, updatedAt };
      if (nickname === null) delete named.nickname;
      else named.nickname = nickname;
      byId.set(id, named);
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
    setRepositoryKind(id, git, updatedAt) {
      const record = byId.get(id);
      if (record === undefined) return;
      const changed: ProjectRecord = { ...record, repositoryKind: git.repositoryKind, updatedAt };
      delete changed.defaultBranch;
      if (git.defaultBranch !== undefined) changed.defaultBranch = git.defaultBranch;
      byId.set(id, changed);
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
  options: { caseInsensitive?: boolean; outside?: readonly string[] } = {},
): FileSystemPort & { remove(path: string): void } {
  const key = (path: string) => (options.caseInsensitive === true ? path.toLowerCase() : path);
  const existing = new Set(directories.map(key));
  const outside = new Set(options.outside ?? []);
  return {
    isDirectory: (path) => Promise.resolve(existing.has(key(path))),
    // Só os caminhos listados em `outside` escapam da pasta do projeto.
    isInsideProject: (_projectPath, relativePath) => Promise.resolve(!outside.has(relativePath)),
    remove: (path) => {
      existing.delete(key(path));
    },
  };
}

export type GitPanelMethod = keyof GitPanelPort;

export type FakeGitPanelOptions = {
  status?: Partial<GitStatusDto>;
  fileDiff?: GitFileDiffDto | null;
  log?: GitLogEntryDto[];
  branchChanges?: BranchChangesDto;
  originUrl?: string | null;
  /** Erro que o método lança, como o `GitError` da porta real. */
  errors?: Partial<Record<GitPanelMethod, Error>>;
};

export const CLEAN_STATUS: GitStatusDto = {
  branch: 'feat/x',
  upstream: 'origin/feat/x',
  ahead: 0,
  behind: 0,
  baseRef: 'origin/main',
  linesAdded: 0,
  linesRemoved: 0,
  files: [],
};

/**
 * Porta do painel que registra cada chamada (`calls`) e devolve dados prontos ou lança o erro configurado. A
 * chamada é registrada antes do erro, então um teste confere também o que chegou à porta que falhou.
 */
export function fakeGitPanel(
  options: FakeGitPanelOptions = {},
): GitPanelPort & { calls: { method: GitPanelMethod; args: unknown[] }[] } {
  const calls: { method: GitPanelMethod; args: unknown[] }[] = [];
  const run = <T>(method: GitPanelMethod, args: unknown[], value: T): Promise<T> => {
    calls.push({ method, args });
    const error = options.errors?.[method];
    return error === undefined ? Promise.resolve(value) : Promise.reject(error);
  };
  return {
    calls,
    status: (repo) => run('status', [repo], { ...CLEAN_STATUS, ...options.status }),
    fileDiff: (repo, path) =>
      run(
        'fileDiff',
        [repo, path],
        options.fileDiff === undefined
          ? {
              path,
              baseRef: 'origin/main',
              patch: '@@ -1 +1 @@\n-a\n+b\n',
              binary: false,
              truncated: false,
            }
          : options.fileDiff,
      ),
    stage: (repo, paths) => run('stage', [repo, paths], undefined),
    unstage: (repo, paths) => run('unstage', [repo, paths], undefined),
    discard: (repo, paths) => run('discard', [repo, paths], undefined),
    commit: (repo, message) => run('commit', [repo, message], { commit: 'a'.repeat(40) }),
    push: (repo) => run('push', [repo], { branch: options.status?.branch ?? 'feat/x' }),
    pull: (repo) => run('pull', [repo], { updated: true }),
    fetch: (repo) => run('fetch', [repo], undefined),
    log: (repo, limit) => run('log', [repo, limit], options.log ?? []),
    branchChanges: (repo) =>
      run(
        'branchChanges',
        [repo],
        options.branchChanges ?? { baseRef: 'origin/main', mergeBase: 'b'.repeat(40), files: [] },
      ),
    originUrl: (repo) =>
      run(
        'originUrl',
        [repo],
        options.originUrl === undefined ? 'https://github.com/dono/repo.git' : options.originUrl,
      ),
  };
}

export function fakeGit(result: Awaited<ReturnType<GitDetector['detect']>>): GitDetector {
  return { detect: () => Promise.resolve(result) };
}
