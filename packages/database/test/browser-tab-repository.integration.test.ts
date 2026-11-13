import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { openDatabase, type AppDatabase } from '../src/client';
import { migrateDatabase } from '../src/migrate';
import {
  createBrowserTabRepository,
  type BrowserTabRecord,
  type BrowserTabRepository,
} from '../src/repositories/browser-tab-repository';
import { createProjectRepository } from '../src/repositories/project-repository';

let dir: string;
let db: AppDatabase;
let repo: BrowserTabRepository;

function tab(projectId: string, id: string, overrides: Partial<BrowserTabRecord> = {}): BrowserTabRecord {
  return {
    id,
    projectId,
    url: `http://localhost:3000/${id}`,
    title: `Página ${id}`,
    position: 0,
    isActive: false,
    updatedAt: '2026-11-12T10:00:00Z',
    ...overrides,
  };
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'project-hub-browser-tabs-'));
  const dbFile = join(dir, 'project-hub.sqlite');
  db = openDatabase(dbFile);
  migrateDatabase(db, { filePath: dbFile });
  const projects = createProjectRepository(db);
  for (const id of ['p1', 'p2']) {
    projects.insert({
      id,
      name: `Projeto ${id}`,
      path: `C:\\dev\\${id}`,
      normalizedPath: `c:/dev/${id}`,
      repositoryKind: 'none',
      createdAt: '2026-11-12T09:00:00Z',
    });
  }
  repo = createBrowserTabRepository(db);
});

afterEach(() => {
  db.$client.close();
  rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
});

describe('repositório das abas do navegador', () => {
  it('projeto sem abas devolve lista vazia', () => {
    expect(repo.listByProject('p1')).toEqual([]);
  });

  it('grava as abas e as devolve na ordem de position', () => {
    const second = tab('p1', 'b', { position: 1, isActive: true });
    const first = tab('p1', 'a', { position: 0 });
    repo.replaceProject('p1', [second, first]);
    expect(repo.listByProject('p1')).toEqual([first, second]);
  });

  it('replaceProject troca a lista inteira', () => {
    repo.replaceProject('p1', [tab('p1', 'a'), tab('p1', 'b', { position: 1 })]);
    const only = tab('p1', 'c', { url: '', title: '', isActive: true });
    repo.replaceProject('p1', [only]);
    expect(repo.listByProject('p1')).toEqual([only]);
  });

  it('as abas de um projeto não aparecem em outro', () => {
    repo.replaceProject('p1', [tab('p1', 'a')]);
    repo.replaceProject('p2', [tab('p2', 'z')]);
    expect(repo.listByProject('p1').map((record) => record.id)).toEqual(['a']);
    repo.replaceProject('p1', []);
    expect(repo.listByProject('p2').map((record) => record.id)).toEqual(['z']);
  });

  it('deleteByProject apaga só as abas do projeto', () => {
    repo.replaceProject('p1', [tab('p1', 'a')]);
    repo.replaceProject('p2', [tab('p2', 'z')]);
    repo.deleteByProject('p1');
    expect(repo.listByProject('p1')).toEqual([]);
    expect(repo.listByProject('p2')).toHaveLength(1);
  });

  it('recusa aba de projeto que não existe', () => {
    expect(() => repo.replaceProject('nao-existe', [tab('nao-existe', 'a')])).toThrow();
  });

  it('se uma aba da lista nova é inválida, a lista antiga fica como estava', () => {
    repo.replaceProject('p1', [tab('p1', 'a')]);
    const duplicated = [tab('p1', 'x'), tab('p1', 'x', { position: 1 })];
    expect(() => repo.replaceProject('p1', duplicated)).toThrow();
    expect(repo.listByProject('p1').map((record) => record.id)).toEqual(['a']);
  });
});
