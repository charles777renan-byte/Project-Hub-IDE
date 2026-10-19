import Database from 'better-sqlite3';
import { drizzle, type BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { schema } from './schema';

export type AppDatabase = BetterSQLite3Database<typeof schema> & {
  $client: Database.Database;
};

/** Abre (ou cria) o arquivo SQLite com chaves estrangeiras e WAL ligados. */
export function openDatabase(filePath: string): AppDatabase {
  const sqlite = new Database(filePath);
  sqlite.pragma('foreign_keys = ON');
  sqlite.pragma('journal_mode = WAL');
  return drizzle({ client: sqlite, schema });
}
