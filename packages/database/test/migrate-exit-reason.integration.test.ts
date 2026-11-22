import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { openDatabase, type AppDatabase } from '../src/client';
import { migrateDatabase } from '../src/migrate';
import { createMissionRepository } from '../src/repositories/mission-repository';

// A migração 0018 recria a tabela `executions` para trocar a CHECK do motivo de saída (inclui `account_limit`, a
// tentativa que parou porque o limite da conta acabou). Ela tem de preservar as filhas: aprovações (que apagam em
// cascata com a tentativa) e a auditoria da tentativa.

const MIGRATIONS = fileURLToPath(new URL('../migrations', import.meta.url));
const T0 = '2026-11-22T09:00:00.000Z';

let dir: string;
let dbFile: string;
let opened: AppDatabase[];

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'project-hub-exit-reason-'));
  dbFile = join(dir, 'project-hub.sqlite');
  opened = [];
});

afterEach(() => {
  for (const database of opened) database.$client.close();
  rmSync(dir, { recursive: true, force: true });
});

/** Pasta de migrações só até a 0017: o banco fica como estava antes do motivo novo. */
function legacyFolder(): string {
  const folder = join(dir, 'legacy');
  mkdirSync(join(folder, 'meta'), { recursive: true });
  const journal = JSON.parse(readFileSync(join(MIGRATIONS, 'meta', '_journal.json'), 'utf8')) as {
    entries: Array<{ tag: string }>;
  };
  const entries = journal.entries.filter((entry) => entry.tag < '0018');
  for (const entry of entries) {
    copyFileSync(join(MIGRATIONS, `${entry.tag}.sql`), join(folder, `${entry.tag}.sql`));
  }
  writeFileSync(
    join(folder, 'meta', '_journal.json'),
    JSON.stringify({ ...journal, entries }, null, 2),
  );
  return folder;
}

/** Banco até a 0017 com uma missão, uma tentativa que falhou, uma aprovação dela e um evento dela. */
function legacyWithChildren(): void {
  const legacy = openDatabase(dbFile);
  opened.push(legacy);
  migrate(legacy, { migrationsFolder: legacyFolder(), migrationsTable: 'schema_migrations' });
  legacy.$client
    .prepare(
      'INSERT INTO projects (id, name, path, normalized_path, repository_kind, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
    )
    .run('p1', 'app', 'C:/dev/app', 'c:/dev/app', 'git', T0, T0);
  const repo = createMissionRepository(legacy);
  repo.insertMission({
    id: 'missao-1',
    projectId: 'p1',
    title: 'Ajustar login',
    objective: 'Corrigir o login',
    acceptanceCriteria: [{ id: 'c1', position: 1, text: 'Login funciona' }],
    status: 'failed',
    priority: 'normal',
    agentProfileId: 'simulado',
    executionProfileId: 'padrao',
    altersCode: false,
    createdAt: T0,
    updatedAt: T0,
  });
  repo.insertExecution({
    id: 'exec-1',
    missionId: 'missao-1',
    attempt: 1,
    status: 'failed',
    exitReason: 'agent_failed',
    startedAt: T0,
    finishedAt: T0,
  });
  repo.insertApproval({
    id: 'appr-1',
    missionId: 'missao-1',
    executionId: 'exec-1',
    actionType: 'write_outside_worktree',
    title: 'Gravar fora do worktree',
    rationale: 'O roteiro pediu',
    affectedResources: [],
    status: 'expired',
    requestedAt: T0,
  });
  repo.appendAudit({
    aggregateType: 'execution',
    aggregateId: 'exec-1',
    eventType: 'execution.started',
    severity: 'info',
    actor: 'user',
    payload: { attempt: 1 },
    createdAt: T0,
  });
  legacy.$client.close();
  opened.length = 0;
}

function upgraded(): AppDatabase {
  const database = openDatabase(dbFile);
  opened.push(database);
  migrateDatabase(database, { filePath: dbFile });
  return database;
}

describe('migração do motivo de saída (0018)', () => {
  it('recria executions com account_limit e preserva aprovações e auditoria', () => {
    legacyWithChildren();
    const database = upgraded();
    const repo = createMissionRepository(database);

    expect(repo.listExecutions('missao-1')).toHaveLength(1);
    expect(repo.getApproval('appr-1')).toBeDefined();
    expect(repo.listAudit('exec-1')).toHaveLength(1);
    expect(database.$client.pragma('foreign_key_check')).toEqual([]);

    repo.updateExecution('exec-1', { exitReason: 'account_limit' });
    expect(repo.getExecution('exec-1')?.exitReason).toBe('account_limit');
  });

  it('a CHECK nova ainda recusa motivo desconhecido', () => {
    legacyWithChildren();
    const database = upgraded();
    expect(() =>
      database.$client.prepare("UPDATE executions SET exit_reason = 'outro'").run(),
    ).toThrow(/CHECK/);
  });
});
