import { asc, eq, isNull } from 'drizzle-orm';
import type { AppDatabase } from '../client';
import { terminalSessions } from '../schema';

export type TerminalSessionRecord = {
  id: string;
  projectId: string;
  provider: string;
  title: string;
  createdAt: string;
  closedAt?: string;
};

export interface TerminalSessionRepository {
  insert(record: TerminalSessionRecord): void;
  get(id: string): TerminalSessionRecord | undefined;
  /** Sessões sem `closedAt`, da mais antiga para a mais nova. */
  listOpen(): TerminalSessionRecord[];
  /** Todas as sessões, abertas e fechadas, da mais antiga para a mais nova. Só leitura. */
  listAll(): TerminalSessionRecord[];
  close(id: string, closedAt: string): void;
}

type TerminalSessionRow = typeof terminalSessions.$inferSelect;

function toRecord(row: TerminalSessionRow): TerminalSessionRecord {
  const record: TerminalSessionRecord = {
    id: row.id,
    projectId: row.projectId,
    provider: row.provider,
    title: row.title,
    createdAt: row.createdAt,
  };
  // Com exactOptionalPropertyTypes, um campo opcional ausente fica ausente, e não undefined.
  if (row.closedAt !== null) record.closedAt = row.closedAt;
  return record;
}

export function createTerminalSessionRepository(db: AppDatabase): TerminalSessionRepository {
  return {
    insert(record) {
      db.insert(terminalSessions)
        .values({
          id: record.id,
          projectId: record.projectId,
          provider: record.provider,
          title: record.title,
          createdAt: record.createdAt,
          closedAt: record.closedAt ?? null,
        })
        .run();
    },

    get(id) {
      const row = db.select().from(terminalSessions).where(eq(terminalSessions.id, id)).get();
      return row === undefined ? undefined : toRecord(row);
    },

    listOpen() {
      return db
        .select()
        .from(terminalSessions)
        .where(isNull(terminalSessions.closedAt))
        .orderBy(asc(terminalSessions.createdAt), asc(terminalSessions.id))
        .all()
        .map(toRecord);
    },

    listAll() {
      return db
        .select()
        .from(terminalSessions)
        .orderBy(asc(terminalSessions.createdAt), asc(terminalSessions.id))
        .all()
        .map(toRecord);
    },

    close(id, closedAt) {
      db.update(terminalSessions).set({ closedAt }).where(eq(terminalSessions.id, id)).run();
    },
  };
}
