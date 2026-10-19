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
        "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite\\_%' ESCAPE '\\' LIMIT 1",
      )
      .get() !== undefined
  );
}

/** Backup padrão, ao lado do arquivo. A data usa só caracteres que o Windows aceita no nome. */
function defaultBackupPath(file: string): string {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  return `${file}.pre-${stamp}.bak`;
}

/**
 * Copia o arquivo do banco para `backupPath`. Antes leva o WAL para o arquivo principal e confere
 * que o checkpoint não ficou ocupado: com um leitor aberto, a cópia sairia sem parte dos dados.
 */
function backupFile(db: AppDatabase, backupPath: string): void {
  const [result] = db.$client.pragma('wal_checkpoint(TRUNCATE)') as Array<{ busy: number }>;
  if (result === undefined || result.busy !== 0) {
    throw new Error(
      'Não foi possível fazer o checkpoint do WAL antes do backup: outra conexão está lendo o banco.',
    );
  }
  copyFileSync(db.$client.name, backupPath);
}

/**
 * Aplica as migrações pendentes, cada uma numa transação (a do Drizzle). Se o banco já tinha
 * tabelas e há migração pendente, faz backup antes (seção 18.2): em `backupPath`, se informado, ou
 * ao lado do arquivo. Se o backup falhar, nada é migrado.
 *
 * `filePath` vem da assinatura do brief. A cópia usa o caminho do próprio handle (`db.$client.name`).
 */
export function migrateDatabase(
  db: AppDatabase,
  options: { filePath: string; backupPath?: string },
): MigrationReport {
  const pending = pendingMigrations(db);
  if (pending.length === 0) {
    return { applied: [], alreadyUpToDate: true };
  }

  if (hasUserTables(db)) {
    backupFile(db, options.backupPath ?? defaultBackupPath(db.$client.name));
  }

  migrate(db, { migrationsFolder: MIGRATIONS_FOLDER, migrationsTable: MIGRATIONS_TABLE });
  return { applied: pending.map((entry) => entry.tag), alreadyUpToDate: false };
}
