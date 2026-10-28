import Database from 'better-sqlite3';
import { existsSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { migrateDatabase, openDatabase, type AppDatabase } from '../src/index';

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

    expect(report).toEqual({
      applied: [
        '0000_projetos',
        '0001_missoes',
        '0002_arquivamento_projetos',
        '0003_cursor_do_agente',
        '0004_workspaces_e_sessoes',
        '0005_revisao_da_missao',
        '0006_grupo_do_projeto',
        '0007_apelido_do_projeto',
        '0008_configuracoes_do_app',
        '0009_tarefas_da_missao',
        '0010_programa_da_tarefa',
      ],
      alreadyUpToDate: false,
    });
    expect(tables(db)).toEqual(
      expect.arrayContaining(['projects', 'missions', 'schema_migrations']),
    );
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

    expect(report.applied).toEqual([
      '0000_projetos',
      '0001_missoes',
      '0002_arquivamento_projetos',
      '0003_cursor_do_agente',
      '0004_workspaces_e_sessoes',
      '0005_revisao_da_missao',
      '0006_grupo_do_projeto',
      '0007_apelido_do_projeto',
      '0008_configuracoes_do_app',
      '0009_tarefas_da_missao',
      '0010_programa_da_tarefa',
    ]);
    expect(existsSync(backupPath)).toBe(true);
    // O backup tem o estado de antes da migração: a tabela antiga e nenhuma projects.
    expect(userTables(backupPath)).toEqual(['legado']);
    expect(tables(db)).toEqual(expect.arrayContaining(['legado', 'projects']));
  });

  it('sem backupPath, cria backup ao lado do arquivo quando o banco existente tem migração pendente', () => {
    createLegacyDatabase(
      "CREATE TABLE legado (id TEXT PRIMARY KEY); INSERT INTO legado VALUES ('antigo');",
    );
    const db = open();

    migrateDatabase(db, { filePath: dbFile });

    // Nome com data sem ':' nem '.', que o Windows não aceita em nomes de arquivo.
    const backups = readdirSync(dir).filter((name) =>
      /^project-hub\.sqlite\.pre-[\dTZ-]+\.bak$/.test(name),
    );
    expect(backups).toHaveLength(1);
    expect(userTables(join(dir, backups[0] ?? ''))).toEqual(['legado']);
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

    expect(() => migrateDatabase(db, { filePath: dbFile, backupPath })).toThrow(/ENOENT/);
    expect(tables(db)).toEqual(['legado']);
  });

  it('não migra quando outra conexão impede o checkpoint do WAL', () => {
    createLegacyDatabase(
      "CREATE TABLE legado (id TEXT PRIMARY KEY); INSERT INTO legado VALUES ('antigo');",
    );
    const db = open();
    // Escrita depois de ligar o WAL: sem quadros no WAL não há o que checkpointar.
    db.$client.exec("INSERT INTO legado VALUES ('novo')");
    const backupPath = join(dir, 'backup.sqlite');
    const reader = new Database(dbFile);
    try {
      // Leitor com transação aberta: enquanto ela existir, o TRUNCATE não consegue zerar o WAL.
      reader.exec('BEGIN');
      reader.prepare('SELECT COUNT(*) FROM legado').pluck().get();

      expect(() => migrateDatabase(db, { filePath: dbFile, backupPath })).toThrow(/checkpoint/);
    } finally {
      if (reader.inTransaction) reader.exec('COMMIT');
      reader.close();
    }
    expect(existsSync(backupPath)).toBe(false);
    expect(tables(db)).not.toContain('projects');
    expect(tables(db)).not.toContain('schema_migrations');
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
