import { copyFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import type { AppDatabase } from './client';

const MIGRATIONS_FOLDER = fileURLToPath(new URL('../migrations', import.meta.url));
const MIGRATIONS_TABLE = 'schema_migrations';

export type MigrationReport = { applied: string[]; alreadyUpToDate: boolean };

type JournalEntry = { tag: string; when: number };

function readJournal(): JournalEntry[] {
  const journal = JSON.parse(
    readFileSync(join(MIGRATIONS_FOLDER, 'meta', '_journal.json'), 'utf8'),
  ) as { entries: JournalEntry[] };
  return journal.entries;
}

/** `created_at` da migração mais recente registrada, ou null se nenhuma foi registrada. */
function lastAppliedMillis(db: AppDatabase): number | null {
  const hasControlTable =
    db.$client
      .prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?")
      .get(MIGRATIONS_TABLE) !== undefined;
  if (!hasControlTable) return null;

  const row = db.$client
    .prepare(`SELECT MAX(created_at) AS last FROM ${MIGRATIONS_TABLE}`)
    .get() as { last: number | null };
  return row.last;
}

/**
 * Migrações que o Drizzle vai aplicar: as que vêm depois da última registrada. A regra é a dele
 * (`when` maior que o `created_at` mais recente), para que a lista reportada bata com o que roda.
 */
function pendingMigrations(db: AppDatabase): JournalEntry[] {
  const lastApplied = lastAppliedMillis(db);
  return readJournal().filter((entry) => lastApplied === null || entry.when > lastApplied);
}

function hasUserTables(db: AppDatabase): boolean {
  return (
    db.$client
      .prepare(
        "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' LIMIT 1",
      )
      .get() !== undefined
  );
}

/**
 * Aplica as migrações pendentes, cada uma numa transação (a do Drizzle). Se o banco já tinha
 * tabelas e `backupPath` foi informado, copia o arquivo para `backupPath` antes de migrar (seção
 * 18.2). Se a cópia falhar, nada é migrado.
 */
export function migrateDatabase(
  db: AppDatabase,
  options: { filePath: string; backupPath?: string },
): MigrationReport {
  const pending = pendingMigrations(db);
  if (pending.length === 0) {
    return { applied: [], alreadyUpToDate: true };
  }

  if (options.backupPath !== undefined && hasUserTables(db)) {
    // Leva o conteúdo do WAL para o arquivo principal, para que a cópia saia completa.
    db.$client.pragma('wal_checkpoint(TRUNCATE)');
    copyFileSync(options.filePath, options.backupPath);
  }

  migrate(db, { migrationsFolder: MIGRATIONS_FOLDER, migrationsTable: MIGRATIONS_TABLE });
  return { applied: pending.map((entry) => entry.tag), alreadyUpToDate: false };
}
