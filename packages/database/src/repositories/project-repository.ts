import { and, asc, eq, isNotNull, isNull } from 'drizzle-orm';
import type { NewProject, ProjectRecord } from '@project-hub/domain';
import type { AppDatabase } from '../client';
import { projects } from '../schema';

export interface ProjectRepository {
  insert(project: NewProject): void;
  get(id: string): ProjectRecord | undefined;
  /** Os projetos ativos: sem os removidos e sem os arquivados. */
  list(): ProjectRecord[];
  /** Os projetos arquivados (sem os removidos), para a seção de arquivados. */
  listArchived(): ProjectRecord[];
  /** Inclui os removidos e os arquivados: o caminho continua ocupado enquanto o registro existir. */
  findByNormalizedPath(normalizedPath: string): ProjectRecord | undefined;
  archive(id: string, archivedAt: string): void;
  /** Tira o projeto do arquivo e atualiza a data; o resto do registro fica como está. */
  unarchive(id: string, updatedAt: string): void;
  /** Põe o projeto num grupo da barra lateral, ou o tira (`null`). */
  setGroup(id: string, groupName: string | null, updatedAt: string): void;
  markRemoved(id: string, removedAt: string): void;
  /**
   * Desfaz a remoção lógica (e o arquivamento): o mesmo registro volta à lista, sem inserir outro. A
   * detecção nova substitui o tipo e a branch padrão guardados (sem `defaultBranch`, a branch antiga some).
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
  if (row.archivedAt !== null) record.archivedAt = row.archivedAt;
  if (row.removedAt !== null) record.removedAt = row.removedAt;
  if (row.groupName !== null) record.groupName = row.groupName;
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
        .where(and(isNull(projects.removedAt), isNull(projects.archivedAt)))
        .orderBy(asc(projects.createdAt), asc(projects.id))
        .all()
        .map(toRecord);
    },

    listArchived() {
      return db
        .select()
        .from(projects)
        .where(and(isNull(projects.removedAt), isNotNull(projects.archivedAt)))
        .orderBy(asc(projects.archivedAt), asc(projects.id))
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

    archive(id, archivedAt) {
      db.update(projects)
        .set({ archivedAt, updatedAt: archivedAt })
        .where(eq(projects.id, id))
        .run();
    },

    unarchive(id, updatedAt) {
      db.update(projects).set({ archivedAt: null, updatedAt }).where(eq(projects.id, id)).run();
    },

    setGroup(id, groupName, updatedAt) {
      db.update(projects).set({ groupName, updatedAt }).where(eq(projects.id, id)).run();
    },

    markRemoved(id, removedAt) {
      db.update(projects).set({ removedAt, updatedAt: removedAt }).where(eq(projects.id, id)).run();
    },

    restore(id, updatedAt, git) {
      db.update(projects)
        .set({
          removedAt: null,
          archivedAt: null,
          updatedAt,
          repositoryKind: git.repositoryKind,
          defaultBranch: git.defaultBranch ?? null,
        })
        .where(eq(projects.id, id))
        .run();
    },
  };
}
