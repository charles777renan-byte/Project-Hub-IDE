import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { openDatabase, type AppDatabase } from '../src/client';
import { migrateDatabase } from '../src/migrate';
import { createProjectRepository } from '../src/repositories/project-repository';
import {
  createWorkspaceRepository,
  type WorkspaceRecord,
  type WorkspaceRepository,
} from '../src/repositories/workspace-repository';

let dir: string;
let db: AppDatabase;
let repo: WorkspaceRepository;

const layout = '{"kind":"leaf","id":"a","provider":"claude"}';

function workspace(projectId: string, overrides: Partial<WorkspaceRecord> = {}): WorkspaceRecord {
  return {
    id: `w-${projectId}`,
    projectId,
    layout,
    isOpen: true,
    position: 0,
    lastActiveAt: '2026-10-22T10:00:00Z',
    createdAt: '2026-10-22T10:00:00Z',
    updatedAt: '2026-10-22T10:00:00Z',
    ...overrides,
  };
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'project-hub-workspace-'));
  const dbFile = join(dir, 'project-hub.sqlite');
  db = openDatabase(dbFile);
  migrateDatabase(db, { filePath: dbFile });
  const projects = createProjectRepository(db);
  for (const id of ['p1', 'p2', 'p3', 'p4']) {
    projects.insert({
      id,
      name: `Projeto ${id}`,
      path: `C:\\dev\\${id}`,
      normalizedPath: `c:/dev/${id}`,
      repositoryKind: 'none',
      createdAt: '2026-10-22T09:00:00Z',
    });
  }
  repo = createWorkspaceRepository(db);
});

afterEach(() => {
  db.$client.close();
  rmSync(dir, { recursive: true, force: true });
});

describe('WorkspaceRepository', () => {
  it('insere e devolve o mesmo registro por id e por projeto', () => {
    const record = workspace('p1');

    repo.insert(record);

    expect(repo.get('w-p1')).toStrictEqual(record);
    expect(repo.getByProject('p1')).toStrictEqual(record);
    expect(repo.get('inexistente')).toBeUndefined();
    expect(repo.getByProject('p2')).toBeUndefined();
  });

  it('guarda o layout como texto opaco, sem mexer nele', () => {
    const cru = '  { "qualquer": [1,2,3] }  ';

    repo.insert(workspace('p1', { layout: cru }));

    expect(repo.get('w-p1')?.layout).toBe(cru);
  });

  it('recusa um segundo workspace para o mesmo projeto', () => {
    repo.insert(workspace('p1'));

    expect(() => repo.insert(workspace('p1', { id: 'outro' }))).toThrow(/UNIQUE constraint failed/);
  });

  it('recusa um workspace de projeto que não existe', () => {
    expect(() => repo.insert(workspace('fantasma'))).toThrow(/FOREIGN KEY constraint failed/);
  });

  it('listOpen ordena por posição e depois por criação, e ignora os fechados', () => {
    repo.insert(workspace('p1', { position: 1, createdAt: '2026-10-22T10:00:00Z' }));
    repo.insert(workspace('p2', { position: 0, createdAt: '2026-10-22T10:05:00Z' }));
    repo.insert(workspace('p3', { position: 0, createdAt: '2026-10-22T10:01:00Z', isOpen: false }));

    expect(repo.listOpen().map((item) => item.id)).toEqual(['w-p2', 'w-p1']);

    repo.open('w-p3', 0, '2026-10-22T11:00:00Z');

    expect(repo.listOpen().map((item) => item.id)).toEqual(['w-p3', 'w-p2', 'w-p1']);
  });

  it('nextPosition é 0 sem abertos e 1 depois de um aberto na posição 0', () => {
    expect(repo.nextPosition()).toBe(0);

    repo.insert(workspace('p1', { isOpen: false, position: 5 }));
    expect(repo.nextPosition()).toBe(0);

    repo.insert(workspace('p2', { position: 0 }));
    expect(repo.nextPosition()).toBe(1);

    repo.insert(workspace('p3', { position: 4 }));
    expect(repo.nextPosition()).toBe(5);
  });

  it('abrir um workspace fechado muda a posição e o lastActiveAt', () => {
    repo.insert(workspace('p1', { isOpen: false, position: 0 }));

    repo.open('w-p1', 3, '2026-10-22T12:00:00Z');

    expect(repo.get('w-p1')).toMatchObject({
      isOpen: true,
      position: 3,
      lastActiveAt: '2026-10-22T12:00:00Z',
    });
  });

  it('abrir um workspace já aberto só muda o lastActiveAt', () => {
    repo.insert(workspace('p1', { position: 2 }));

    repo.open('w-p1', 9, '2026-10-22T12:00:00Z');

    expect(repo.get('w-p1')).toMatchObject({
      isOpen: true,
      position: 2,
      lastActiveAt: '2026-10-22T12:00:00Z',
    });
  });

  it('fechar tira o workspace de listOpen e mantém o registro', () => {
    repo.insert(workspace('p1'));

    repo.close('w-p1', '2026-10-22T13:00:00Z');

    expect(repo.listOpen()).toEqual([]);
    expect(repo.get('w-p1')).toMatchObject({ isOpen: false });
  });

  it('reorder põe a posição igual ao índice, e listOpen e nextPosition seguem a nova ordem', () => {
    repo.insert(workspace('p1', { position: 0 }));
    repo.insert(workspace('p2', { position: 1 }));
    repo.insert(workspace('p3', { position: 2 }));
    repo.insert(workspace('p4', { position: 3, isOpen: false }));

    repo.reorder(['w-p3', 'w-p1', 'w-p2'], '2026-10-22T12:00:00Z');

    expect(repo.listOpen().map((item) => item.id)).toEqual(['w-p3', 'w-p1', 'w-p2']);
    expect(repo.get('w-p3')).toMatchObject({ position: 0, updatedAt: '2026-10-22T12:00:00Z' });
    expect(repo.get('w-p2')).toMatchObject({ position: 2 });
    // O fechado não entra na troca e a próxima posição vem depois dos abertos.
    expect(repo.get('w-p4')).toMatchObject({ position: 3, isOpen: false });
    expect(repo.nextPosition()).toBe(3);
  });

  it('updateLayout troca o texto e a data de atualização', () => {
    repo.insert(workspace('p1'));

    repo.updateLayout('w-p1', '{"novo":true}', '2026-10-22T14:00:00Z');

    expect(repo.get('w-p1')).toMatchObject({
      layout: '{"novo":true}',
      updatedAt: '2026-10-22T14:00:00Z',
      createdAt: '2026-10-22T10:00:00Z',
    });
  });
});
