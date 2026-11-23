import { asc, eq } from 'drizzle-orm';
import {
  DEFAULT_EXECUTION_PROFILE_ID,
  type ExecutionOptions,
  type ExecutionProfile,
} from '@project-hub/domain';
import type { AppDatabase } from '../client';
import { executionProfiles, missions } from '../schema';

/** Perfis de execução das missões. O perfil embutido não tem linha. */
export interface ExecutionProfileRepository {
  insert(profile: ExecutionProfile): void;
  get(id: string): ExecutionProfile | undefined;
  /** Do mais antigo para o mais novo. */
  list(): ExecutionProfile[];
  /** Troca o nome e as opções. Opção que não vem volta ao padrão do programa. */
  update(id: string, changes: { name: string } & ExecutionOptions, at: string): void;
  /** Apaga o perfil e devolve as missões dele ao perfil embutido, na mesma transação. */
  remove(id: string): void;
}

type Row = typeof executionProfiles.$inferSelect;

function toProfile(row: Row): ExecutionProfile {
  return {
    id: row.id,
    name: row.name,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    ...(row.model === null ? {} : { model: row.model }),
    ...(row.effort === null ? {} : { effort: row.effort }),
    ...(row.permissionMode === null ? {} : { permissionMode: row.permissionMode }),
  };
}

function columnsOf(options: ExecutionOptions) {
  return {
    model: options.model ?? null,
    effort: options.effort ?? null,
    permissionMode: options.permissionMode ?? null,
  };
}

export function createExecutionProfileRepository(db: AppDatabase): ExecutionProfileRepository {
  return {
    insert(profile) {
      db.insert(executionProfiles)
        .values({
          id: profile.id,
          name: profile.name,
          createdAt: profile.createdAt,
          updatedAt: profile.updatedAt,
          ...columnsOf(profile),
        })
        .run();
    },

    get(id) {
      const row = db.select().from(executionProfiles).where(eq(executionProfiles.id, id)).get();
      return row === undefined ? undefined : toProfile(row);
    },

    list() {
      return db
        .select()
        .from(executionProfiles)
        .orderBy(asc(executionProfiles.createdAt), asc(executionProfiles.id))
        .all()
        .map(toProfile);
    },

    update(id, changes, at) {
      db.update(executionProfiles)
        .set({ name: changes.name, updatedAt: at, ...columnsOf(changes) })
        .where(eq(executionProfiles.id, id))
        .run();
    },

    remove(id) {
      db.transaction((tx) => {
        tx.update(missions)
          .set({ executionProfileId: DEFAULT_EXECUTION_PROFILE_ID })
          .where(eq(missions.executionProfileId, id))
          .run();
        tx.delete(executionProfiles).where(eq(executionProfiles.id, id)).run();
      });
    },
  };
}
