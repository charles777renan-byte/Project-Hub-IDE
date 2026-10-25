import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Mission } from '@project-hub/domain';
import { openDatabase, type AppDatabase } from '../src/client';
import { migrateDatabase } from '../src/migrate';
import { createMissionRepository } from '../src/repositories/mission-repository';
import { createProjectRepository } from '../src/repositories/project-repository';

// A migração 0005 recria a tabela `missions` para trocar a CHECK do estado (inclui `review`). Ela tem de
// preservar as filhas, que apagam em cascata com a missão: etapas, critérios, tentativas e auditoria.

const MIGRATIONS = fileURLToPath(new URL('../migrations', import.meta.url));
const T0 = '2026-10-25T09:00:00.000Z';

let dir: string;
let dbFile: string;
let opened: AppDatabase[];

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'project-hub-review-'));
  dbFile = join(dir, 'project-hub.sqlite');
  opened = [];
});

afterEach(() => {
  for (const database of opened) database.$client.close();
  rmSync(dir, { recursive: true, force: true });
});

/** Pasta de migrações só até a 0004: o banco fica como estava antes da revisão. */
function legacyFolder(): string {
  const folder = join(dir, 'legacy');
  mkdirSync(join(folder, 'meta'), { recursive: true });
  const journal = JSON.parse(readFileSync(join(MIGRATIONS, 'meta', '_journal.json'), 'utf8')) as {
    entries: Array<{ tag: string }>;
  };
  const entries = journal.entries.filter((entry) => entry.tag < '0005');
  for (const entry of entries) {
    copyFileSync(join(MIGRATIONS, `${entry.tag}.sql`), join(folder, `${entry.tag}.sql`));
  }
  writeFileSync(
    join(folder, 'meta', '_journal.json'),
    JSON.stringify({ ...journal, entries }, null, 2),
  );
  return folder;
}

function count(database: AppDatabase, table: string): number {
  return database.$client
    .prepare(
      `SELECT COUNT(*) AS total FROM ${table} WHERE ${table === 'audit_events' ? 'aggregate_id' : 'mission_id'} = ?`,
    )
    .pluck()
    .get('missao-1') as number;
}

describe('migração da revisão (0005)', () => {
  it('recria missions com o estado review e mantém as etapas, critérios, tentativas e auditoria', () => {
    const legacy = openDatabase(dbFile);
    opened.push(legacy);
    migrate(legacy, { migrationsFolder: legacyFolder(), migrationsTable: 'schema_migrations' });
    createProjectRepository(legacy).insert({
      id: 'p1',
      name: 'app',
      path: 'C:\\dev\\app',
      normalizedPath: 'c:/dev/app',
      repositoryKind: 'git',
      createdAt: T0,
    });
    const before = createMissionRepository(legacy);
    const mission: Mission = {
      id: 'missao-1',
      projectId: 'p1',
      title: 'Ajustar login',
      objective: 'Corrigir o login',
      acceptanceCriteria: [
        { id: 'c1', position: 1, text: 'Login funciona' },
        { id: 'c2', position: 2, text: 'Testes passam' },
      ],
      status: 'running',
      priority: 'normal',
      agentProfileId: 'simulado',
      executionProfileId: 'padrao',
      altersCode: false,
      createdAt: T0,
      updatedAt: T0,
    };
    before.insertMission(mission);
    before.replaceSteps('missao-1', [
      {
        id: 's1',
        missionId: 'missao-1',
        position: 1,
        title: 'Passo',
        description: '',
        kind: 'custom',
        status: 'pending',
        dependsOn: [],
      },
    ]);
    before.insertExecution({
      id: 'exec-1',
      missionId: 'missao-1',
      attempt: 1,
      status: 'running',
    });
    before.appendAudit({
      aggregateType: 'mission',
      aggregateId: 'missao-1',
      eventType: 'mission.created',
      severity: 'info',
      actor: 'user',
      payload: {},
      createdAt: T0,
    });
    legacy.$client.close();
    opened.length = 0;

    const upgraded = openDatabase(dbFile);
    opened.push(upgraded);
    migrateDatabase(upgraded, { filePath: dbFile });

    expect(count(upgraded, 'mission_steps')).toBe(1);
    expect(count(upgraded, 'mission_acceptance_criteria')).toBe(2);
    expect(count(upgraded, 'executions')).toBe(1);
    expect(count(upgraded, 'audit_events')).toBe(1);
    expect(upgraded.$client.pragma('foreign_key_check')).toEqual([]);

    const repo = createMissionRepository(upgraded);
    expect(repo.getMission('missao-1')).toMatchObject({ status: 'running' });
    repo.updateMission('missao-1', { status: 'review', updatedAt: T0 });
    expect(repo.getMission('missao-1')?.status).toBe('review');
  });
});
