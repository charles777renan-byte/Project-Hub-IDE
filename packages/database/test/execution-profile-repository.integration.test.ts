import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { ExecutionProfile, Mission } from '@project-hub/domain';
import { openDatabase, type AppDatabase } from '../src/client';
import { migrateDatabase } from '../src/migrate';
import {
  createExecutionProfileRepository,
  type ExecutionProfileRepository,
} from '../src/repositories/execution-profile-repository';
import { createMissionRepository } from '../src/repositories/mission-repository';
import { createProjectRepository } from '../src/repositories/project-repository';

let dir: string;
let db: AppDatabase;
let profiles: ExecutionProfileRepository;

const T0 = '2026-11-22T10:00:00.000Z';
const T1 = '2026-11-22T11:00:00.000Z';
const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';

function profile(overrides: Partial<ExecutionProfile> = {}): ExecutionProfile {
  return { id: A, name: 'Rápido', createdAt: T0, updatedAt: T0, ...overrides };
}

function mission(overrides: Partial<Mission> = {}): Mission {
  return {
    id: 'missao-1',
    projectId: 'p1',
    title: 'Ajustar login',
    objective: 'Corrigir o login',
    acceptanceCriteria: [],
    status: 'draft',
    priority: 'normal',
    agentProfileId: 'simulado',
    executionProfileId: 'padrao',
    altersCode: true,
    createdAt: T0,
    updatedAt: T0,
    ...overrides,
  };
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'project-hub-perfis-'));
  const dbFile = join(dir, 'project-hub.sqlite');
  db = openDatabase(dbFile);
  migrateDatabase(db, { filePath: dbFile });
  profiles = createExecutionProfileRepository(db);
});

afterEach(() => {
  db.$client.close();
  rmSync(dir, { recursive: true, force: true });
});

describe('execution_profiles', () => {
  it('insere e lista na ordem de criação, com as opções que o perfil tem', () => {
    profiles.insert(profile({ id: B, name: 'Cuidadoso', createdAt: T1, permissionMode: 'manual' }));
    profiles.insert(profile({ model: 'haiku', effort: 'low' }));

    expect(profiles.list()).toEqual([
      { id: A, name: 'Rápido', createdAt: T0, updatedAt: T0, model: 'haiku', effort: 'low' },
      { id: B, name: 'Cuidadoso', createdAt: T1, updatedAt: T0, permissionMode: 'manual' },
    ]);
  });

  it('devolve um perfil pelo id, e undefined para o que não existe', () => {
    profiles.insert(profile());
    expect(profiles.get(A)?.name).toBe('Rápido');
    expect(profiles.get(B)).toBeUndefined();
  });

  it('atualizar troca o nome e as opções, e tira a opção que deixou de vir', () => {
    profiles.insert(profile({ model: 'opus', effort: 'high', permissionMode: 'auto' }));
    profiles.update(A, { name: 'Novo', model: 'sonnet' }, T1);
    expect(profiles.get(A)).toEqual({
      id: A,
      name: 'Novo',
      createdAt: T0,
      updatedAt: T1,
      model: 'sonnet',
    });
  });

  it('o banco recusa um modelo fora da lista', () => {
    expect(() => profiles.insert(profile({ model: 'gpt' as never }))).toThrow();
  });

  it('remover apaga o perfil e devolve as missões dele ao perfil padrão', () => {
    createProjectRepository(db).insert({
      id: 'p1',
      name: 'app',
      path: 'C:\\dev\\app',
      normalizedPath: 'c:/dev/app',
      repositoryKind: 'git',
      createdAt: T0,
    });
    const missions = createMissionRepository(db);
    profiles.insert(profile());
    profiles.insert(profile({ id: B, name: 'Outro' }));
    missions.insertMission(mission({ id: 'm1', executionProfileId: A }));
    missions.insertMission(mission({ id: 'm2', executionProfileId: B }));

    profiles.remove(A);

    expect(profiles.get(A)).toBeUndefined();
    expect(missions.getMission('m1')?.executionProfileId).toBe('padrao');
    expect(missions.getMission('m2')?.executionProfileId).toBe(B);
  });

  it('a missão troca de perfil e de data de atualização', () => {
    createProjectRepository(db).insert({
      id: 'p1',
      name: 'app',
      path: 'C:\\dev\\app',
      normalizedPath: 'c:/dev/app',
      repositoryKind: 'git',
      createdAt: T0,
    });
    const missions = createMissionRepository(db);
    missions.insertMission(mission());
    missions.setMissionProfile('missao-1', A, T1);
    expect(missions.getMission('missao-1')).toMatchObject({ executionProfileId: A, updatedAt: T1 });
  });
});
