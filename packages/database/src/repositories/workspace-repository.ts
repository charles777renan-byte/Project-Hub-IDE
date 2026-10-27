import { asc, eq, max } from 'drizzle-orm';
import type { AppDatabase } from '../client';
import { workspaces } from '../schema';

/** `layout` é o JSON do layout como texto: o banco o guarda e devolve sem interpretar. */
export type WorkspaceRecord = {
  id: string;
  projectId: string;
  layout: string;
  isOpen: boolean;
  position: number;
  lastActiveAt: string;
  createdAt: string;
  updatedAt: string;
};

export interface WorkspaceRepository {
  insert(record: WorkspaceRecord): void;
  get(id: string): WorkspaceRecord | undefined;
  getByProject(projectId: string): WorkspaceRecord | undefined;
  /** Abertos, por `position` e depois `createdAt`. */
  listOpen(): WorkspaceRecord[];
  /** Próxima posição: maior `position` entre os abertos mais 1, ou 0. */
  nextPosition(): number;
  updateLayout(id: string, layout: string, updatedAt: string): void;
  /** Marca como aberto, na posição dada (só muda a posição se estava fechado) e atualiza `lastActiveAt`. */
  open(id: string, position: number, at: string): void;
  close(id: string, at: string): void;
  /**
   * Põe os workspaces na ordem dada: a posição de cada um é o índice dele na lista. Tudo numa transação, para a
   * ordem nunca ficar pela metade. Os ids fora da lista não mudam.
   */
  reorder(ids: readonly string[], at: string): void;
}

type WorkspaceRow = typeof workspaces.$inferSelect;

function toRecord(row: WorkspaceRow): WorkspaceRecord {
  return {
    id: row.id,
    projectId: row.projectId,
    layout: row.layout,
    isOpen: row.isOpen,
    position: row.position,
    lastActiveAt: row.lastActiveAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export function createWorkspaceRepository(db: AppDatabase): WorkspaceRepository {
  return {
    insert(record) {
      db.insert(workspaces).values(record).run();
    },

    get(id) {
      const row = db.select().from(workspaces).where(eq(workspaces.id, id)).get();
      return row === undefined ? undefined : toRecord(row);
    },

    getByProject(projectId) {
      const row = db.select().from(workspaces).where(eq(workspaces.projectId, projectId)).get();
      return row === undefined ? undefined : toRecord(row);
    },

    listOpen() {
      return db
        .select()
        .from(workspaces)
        .where(eq(workspaces.isOpen, true))
        .orderBy(asc(workspaces.position), asc(workspaces.createdAt), asc(workspaces.id))
        .all()
        .map(toRecord);
    },

    nextPosition() {
      const row = db
        .select({ highest: max(workspaces.position) })
        .from(workspaces)
        .where(eq(workspaces.isOpen, true))
        .get();
      return row?.highest == null ? 0 : row.highest + 1;
    },

    updateLayout(id, layout, updatedAt) {
      db.update(workspaces).set({ layout, updatedAt }).where(eq(workspaces.id, id)).run();
    },

    open(id, position, at) {
      // Leitura e escrita na mesma transação: a posição só vale se o workspace estava fechado.
      db.transaction((tx) => {
        const row = tx.select().from(workspaces).where(eq(workspaces.id, id)).get();
        if (row === undefined) return;
        tx.update(workspaces)
          .set(row.isOpen ? { lastActiveAt: at } : { isOpen: true, position, lastActiveAt: at })
          .where(eq(workspaces.id, id))
          .run();
      });
    },

    close(id, at) {
      db.update(workspaces)
        .set({ isOpen: false, updatedAt: at })
        .where(eq(workspaces.id, id))
        .run();
    },

    reorder(ids, at) {
      db.transaction((tx) => {
        ids.forEach((id, position) => {
          tx.update(workspaces).set({ position, updatedAt: at }).where(eq(workspaces.id, id)).run();
        });
      });
    },
  };
}
