import { asc, eq, isNull } from 'drizzle-orm';
import type { NewProject, ProjectRecord } from '@project-hub/domain';
import type { AppDatabase } from '../client';
import { projects } from '../schema';

export interface ProjectRepository {
  insert(project: NewProject): void;
  get(id: string): ProjectRecord | undefined;
  /** Exclui os projetos removidos. */
  list(): ProjectRecord[];
  /** Inclui os removidos: o caminho continua ocupado enquanto o registro existir. */
  findByNormalizedPath(normalizedPath: string): ProjectRecord | undefined;
  markRemoved(id: string, removedAt: string): void;
  /**
   * Desfaz a remoção lógica: o mesmo registro volta à lista, sem inserir outro. A detecção nova
   * substitui o tipo e a branch padrão guardados (sem `defaultBranch`, a branch antiga some).
   */
  restore(
    id: string,
    updatedAt: string,
    git: { repositoryKind: 'git' | 'none'; defaultBranch?: string },
  ): void;
}

type ProjectRow = typeof projects.$inferSelect;

function toRecord(row: ProjectRow): ProjectRecord {
  const record: ProjectRecord = {
    id: row.id,
    name: row.name,
    path: row.path,
    normalizedPath: row.normalizedPath,
    repositoryKind: row.repositoryKind,
    isFavorite: row.isFavorite,
    trusted: row.trusted,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
  // Com exactOptionalPropertyTypes, um campo opcional ausente fica ausente, e não undefined.
  if (row.description !== null) record.description = row.description;
  if (row.defaultBranch !== null) record.defaultBranch = row.defaultBranch;
  if (row.lastOpenedAt !== null) record.lastOpenedAt = row.lastOpenedAt;
  if (row.removedAt !== null) record.removedAt = row.removedAt;
  return record;
}

export function createProjectRepository(db: AppDatabase): ProjectRepository {
  return {
    insert(project) {
      db.insert(projects)
        .values({
          id: project.id,
          name: project.name,
          path: project.path,
          normalizedPath: project.normalizedPath,
          description: project.description ?? null,
          repositoryKind: project.repositoryKind,
          defaultBranch: project.defaultBranch ?? null,
          createdAt: project.createdAt,
          updatedAt: project.createdAt,
        })
        .run();
    },

    get(id) {
      const row = db.select().from(projects).where(eq(projects.id, id)).get();
      return row === undefined ? undefined : toRecord(row);
    },

    list() {
      return db
        .select()
        .from(projects)
        .where(isNull(projects.removedAt))
        .orderBy(asc(projects.createdAt), asc(projects.id))
        .all()
        .map(toRecord);
    },

    findByNormalizedPath(normalizedPath) {
      const row = db
        .select()
        .from(projects)
        .where(eq(projects.normalizedPath, normalizedPath))
        .get();
      return row === undefined ? undefined : toRecord(row);
    },

    markRemoved(id, removedAt) {
      db.update(projects).set({ removedAt, updatedAt: removedAt }).where(eq(projects.id, id)).run();
    },

    restore(id, updatedAt, git) {
      db.update(projects)
        .set({
          removedAt: null,
          updatedAt,
          repositoryKind: git.repositoryKind,
          defaultBranch: git.defaultBranch ?? null,
        })
        .where(eq(projects.id, id))
        .run();
    },
  };
}
