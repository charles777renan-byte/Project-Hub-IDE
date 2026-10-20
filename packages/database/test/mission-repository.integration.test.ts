import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { ApprovalRequest, Execution, Mission, MissionStep } from '../../domain/src/index';
import { openDatabase, type AppDatabase } from '../src/client';
import { migrateDatabase } from '../src/migrate';
import {
  createMissionRepository,
  type MissionRepository,
} from '../src/repositories/mission-repository';
import { createProjectRepository } from '../src/repositories/project-repository';

let dir: string;
let db: AppDatabase;
let repo: MissionRepository;

const T0 = '2026-10-20T10:00:00.000Z';

function mission(overrides: Partial<Mission> = {}): Mission {
  return {
    id: 'missao-1',
    projectId: 'p1',
    title: 'Ajustar login',
    objective: 'Corrigir o login',
    acceptanceCriteria: [
      { id: 'c2', position: 2, text: 'Testes passam' },
      { id: 'c1', position: 1, text: 'Login funciona' },
    ],
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

function execution(overrides: Partial<Execution> = {}): Execution {
  return { id: 'exec-1', missionId: 'missao-1', attempt: 1, status: 'running', ...overrides };
}

function auditRows(aggregateId: string): Array<{ event_type: string; sequence: number }> {
  return db.$client
    .prepare(
      'SELECT event_type, sequence FROM audit_events WHERE aggregate_id = ? ORDER BY sequence',
    )
    .all(aggregateId) as Array<{ event_type: string; sequence: number }>;
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'project-hub-missoes-'));
  const dbFile = join(dir, 'project-hub.sqlite');
  db = openDatabase(dbFile);
  migrateDatabase(db, { filePath: dbFile });
  createProjectRepository(db).insert({
    id: 'p1',
    name: 'app',
    path: 'C:\\dev\\app',
    normalizedPath: 'c:/dev/app',
    repositoryKind: 'git',
    createdAt: T0,
  });
  repo = createMissionRepository(db);
});

afterEach(() => {
  db.$client.close();
  rmSync(dir, { recursive: true, force: true });
});

describe('missões', () => {
  it('insere missão com critérios e lê de volta, com os critérios na ordem da posição', () => {
    repo.insertMission(mission());

    expect(repo.getMission('missao-1')).toStrictEqual(
      mission({
        acceptanceCriteria: [
          { id: 'c1', position: 1, text: 'Login funciona' },
          { id: 'c2', position: 2, text: 'Testes passam' },
        ],
      }),
    );
  });

  it('updateMission grava status, início, worktree e fim sem apagar o resto', () => {
    repo.insertMission(mission());

    repo.updateMission('missao-1', {
      status: 'running',
      startedAt: '2026-10-20T10:05:00.000Z',
      worktreeId: 'wt-1',
      worktreePath: 'C:\\hub\\worktrees\\app\\missao-1',
      updatedAt: '2026-10-20T10:05:00.000Z',
    });

    expect(repo.getMission('missao-1')).toMatchObject({
      status: 'running',
      startedAt: '2026-10-20T10:05:00.000Z',
      worktreeId: 'wt-1',
      worktreePath: 'C:\\hub\\worktrees\\app\\missao-1',
      title: 'Ajustar login',
      altersCode: true,
    });
  });

  it('recusa um status fora da seção 9.3', () => {
    expect(() => repo.insertMission(mission({ status: 'inventado' as Mission['status'] }))).toThrow(
      /CHECK constraint failed/,
    );
  });

  it('recusa missão de projeto que não existe', () => {
    expect(() => repo.insertMission(mission({ projectId: 'nao-existe' }))).toThrow(
      /FOREIGN KEY constraint failed/,
    );
  });
});

describe('etapas do plano', () => {
  it('grava as etapas e recusa duas com a mesma posição', () => {
    repo.insertMission(mission());
    const step = (id: string, position: number): MissionStep => ({
      id,
      missionId: 'missao-1',
      position,
      title: `Passo ${position}`,
      description: '',
      kind: 'custom',
      status: 'pending',
      dependsOn: [],
    });

    repo.insertSteps([step('s1', 1), step('s2', 2)]);

    const rows = db.$client
      .prepare('SELECT position, title FROM mission_steps ORDER BY position')
      .all();
    expect(rows).toEqual([
      { position: 1, title: 'Passo 1' },
      { position: 2, title: 'Passo 2' },
    ]);
    expect(() => repo.insertSteps([step('s3', 1)])).toThrow(/UNIQUE constraint failed/);
  });
});

describe('execuções', () => {
  it('lista as tentativas por número e acha as que estão running', () => {
    repo.insertMission(mission());
    repo.insertExecution(execution({ id: 'exec-2', attempt: 2, status: 'running' }));
    repo.insertExecution(execution({ id: 'exec-1', attempt: 1, status: 'failed' }));

    expect(repo.listExecutions('missao-1').map((e) => e.attempt)).toEqual([1, 2]);
    expect(repo.findExecutionsByStatus('running').map((e) => e.id)).toEqual(['exec-2']);
  });

  it('updateExecution grava motivo de saída e uso como JSON', () => {
    repo.insertMission(mission());
    repo.insertExecution(execution());

    repo.updateExecution('exec-1', {
      status: 'failed',
      exitReason: 'interrupted_by_restart',
      usage: { inputTokens: 10, outputTokens: 4 },
      finishedAt: '2026-10-20T10:09:00.000Z',
    });

    expect(repo.getExecution('exec-1')).toStrictEqual({
      id: 'exec-1',
      missionId: 'missao-1',
      attempt: 1,
      status: 'failed',
      exitReason: 'interrupted_by_restart',
      usage: { inputTokens: 10, outputTokens: 4 },
      finishedAt: '2026-10-20T10:09:00.000Z',
    });
  });
});

describe('aprovações', () => {
  const approval = (overrides: Partial<ApprovalRequest> = {}): ApprovalRequest => ({
    id: 'appr-1',
    missionId: 'missao-1',
    executionId: 'exec-1',
    actionType: 'write_outside_worktree',
    title: 'Gravar fora do worktree',
    rationale: 'O roteiro pediu',
    affectedResources: ['C:\\dev\\outra'],
    status: 'pending',
    requestedAt: T0,
    ...overrides,
  });

  it('insere, lista as pendentes da execução e grava a decisão', () => {
    repo.insertMission(mission());
    repo.insertExecution(execution());
    repo.insertApproval(approval());

    expect(repo.listPendingApprovals('exec-1')).toStrictEqual([approval()]);

    repo.updateApproval('appr-1', {
      status: 'rejected',
      decidedAt: '2026-10-20T10:03:00.000Z',
      decisionNote: 'não',
    });

    expect(repo.getApproval('appr-1')).toMatchObject({
      status: 'rejected',
      decisionNote: 'não',
      affectedResources: ['C:\\dev\\outra'],
    });
    expect(repo.listPendingApprovals('exec-1')).toEqual([]);
  });
});

describe('auditoria', () => {
  it('numera o sequence por agregado: cada agregado começa em 1 e cresce sem pular', () => {
    repo.appendAudit({
      aggregateType: 'mission',
      aggregateId: 'missao-1',
      eventType: 'mission.status_changed',
      severity: 'info',
      actor: 'user',
      payload: { from: 'draft', to: 'planned' },
      createdAt: T0,
    });
    repo.appendAudit({
      aggregateType: 'execution',
      aggregateId: 'exec-1',
      eventType: 'session.started',
      severity: 'info',
      actor: 'agent',
      payload: {},
      createdAt: T0,
    });
    const second = repo.appendAudit({
      aggregateType: 'mission',
      aggregateId: 'missao-1',
      eventType: 'mission.status_changed',
      severity: 'info',
      actor: 'system',
      payload: { from: 'planned', to: 'queued' },
      createdAt: T0,
    });

    expect(second).toMatchObject({ sequence: 2, payload: { from: 'planned', to: 'queued' } });
    expect(auditRows('missao-1').map((row) => row.sequence)).toEqual([1, 2]);
    expect(auditRows('exec-1')).toEqual([{ event_type: 'session.started', sequence: 1 }]);
  });

  it('transaction desfaz a atualização e a auditoria quando o trabalho lança erro', () => {
    repo.insertMission(mission());

    expect(() =>
      repo.transaction(() => {
        repo.updateMission('missao-1', { status: 'planned', updatedAt: T0 });
        repo.appendAudit({
          aggregateType: 'mission',
          aggregateId: 'missao-1',
          eventType: 'mission.status_changed',
          severity: 'info',
          actor: 'user',
          payload: {},
          createdAt: T0,
        });
        throw new Error('falha no meio');
      }),
    ).toThrow('falha no meio');

    expect(repo.getMission('missao-1')?.status).toBe('draft');
    expect(auditRows('missao-1')).toEqual([]);
  });
});
