import Database from 'better-sqlite3';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { openDatabase, type AppDatabase } from '../src/client';
import { migrateDatabase } from '../src/migrate';

let dir: string;
let dbFile: string;
let opened: AppDatabase[];

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'project-hub-migrate-'));
  dbFile = join(dir, 'project-hub.sqlite');
  opened = [];
});

afterEach(() => {
  for (const database of opened) database.$client.close();
  rmSync(dir, { recursive: true, force: true });
});

function open(): AppDatabase {
  const database = openDatabase(dbFile);
  opened.push(database);
  return database;
}

function userTables(file: string): string[] {
  const raw = new Database(file);
  try {
    return raw
      .prepare(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
      )
      .pluck()
      .all() as string[];
  } finally {
    raw.close();
  }
}

function tables(database: AppDatabase): string[] {
  return database.$client
    .prepare(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
    )
    .pluck()
    .all() as string[];
}

function createLegacyDatabase(setupSql: string): void {
  const legacy = new Database(dbFile);
  legacy.exec(setupSql);
  legacy.close();
}

describe('openDatabase', () => {
  it('liga foreign_keys e usa WAL', () => {
    const db = open();

    expect(db.$client.pragma('foreign_keys', { simple: true })).toBe(1);
    expect(db.$client.pragma('journal_mode', { simple: true })).toBe('wal');
  });
});

describe('migrateDatabase', () => {
  it('aplica a migração inicial num banco vazio', () => {
    const db = open();

    const report = migrateDatabase(db, { filePath: dbFile });

    expect(report).toEqual({ applied: ['0000_projetos'], alreadyUpToDate: false });
    expect(tables(db)).toEqual(expect.arrayContaining(['projects', 'schema_migrations']));
  });

  it('é idempotente', () => {
    const db = open();
    migrateDatabase(db, { filePath: dbFile });

    const second = migrateDatabase(db, { filePath: dbFile });

    expect(second).toEqual({ applied: [], alreadyUpToDate: true });
  });

  it('cria backup antes de migrar um banco existente com migração pendente', () => {
    // Banco de uma versão anterior: tem tabelas, mas nenhuma migração registrada.
    createLegacyDatabase(
      "CREATE TABLE legado (id TEXT PRIMARY KEY); INSERT INTO legado VALUES ('antigo');",
    );
    const backupPath = join(dir, 'backup.sqlite');
    const db = open();

    const report = migrateDatabase(db, { filePath: dbFile, backupPath });

    expect(report.applied).toEqual(['0000_projetos']);
    expect(existsSync(backupPath)).toBe(true);
    // O backup tem o estado de antes da migração: a tabela antiga e nenhuma projects.
    expect(userTables(backupPath)).toEqual(['legado']);
    expect(tables(db)).toEqual(expect.arrayContaining(['legado', 'projects']));
  });

  it('não cria backup quando o banco ainda não existia', () => {
    const backupPath = join(dir, 'backup.sqlite');
    const db = open();

    migrateDatabase(db, { filePath: dbFile, backupPath });

    expect(existsSync(backupPath)).toBe(false);
  });

  it('não cria backup quando nenhuma migração está pendente', () => {
    const backupPath = join(dir, 'backup.sqlite');
    const db = open();
    migrateDatabase(db, { filePath: dbFile });

    migrateDatabase(db, { filePath: dbFile, backupPath });

    expect(existsSync(backupPath)).toBe(false);
  });

  it('não migra quando o backup não pode ser criado', () => {
    createLegacyDatabase('CREATE TABLE legado (id TEXT PRIMARY KEY);');
    const backupPath = join(dir, 'pasta-inexistente', 'backup.sqlite');
    const db = open();

    expect(() => migrateDatabase(db, { filePath: dbFile, backupPath })).toThrow();
    expect(tables(db)).toEqual(['legado']);
  });

  it('reverte a migração inteira quando um comando falha', () => {
    // Um índice com o nome que a migração quer criar já existe em outra tabela. O CREATE TABLE
    // de projects roda antes, e precisa ser desfeito junto com o resto da transação.
    createLegacyDatabase(
      'CREATE TABLE legado (x TEXT); CREATE INDEX projects_normalized_path_unique ON legado (x);',
    );
    const db = open();

    // O Drizzle embrulha o erro do SQLite e mostra o comando que falhou.
    expect(() => migrateDatabase(db, { filePath: dbFile })).toThrow(
      /CREATE UNIQUE INDEX `projects_normalized_path_unique`/,
    );
    expect(tables(db)).not.toContain('projects');
    expect(db.$client.prepare('SELECT COUNT(*) FROM schema_migrations').pluck().get()).toBe(0);
  });
});
