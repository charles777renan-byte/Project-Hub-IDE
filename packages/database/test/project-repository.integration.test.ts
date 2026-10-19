import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { NewProject } from '../../domain/src/project';
import { openDatabase, type AppDatabase } from '../src/client';
import { migrateDatabase } from '../src/migrate';
import {
  createProjectRepository,
  type ProjectRepository,
} from '../src/repositories/project-repository';

let dir: string;
let db: AppDatabase;
let repo: ProjectRepository;

const hub: NewProject = {
  id: 'p1',
  name: 'Project Hub',
  path: 'C:\\dev\\project-hub',
  normalizedPath: 'c:/dev/project-hub',
  repositoryKind: 'git',
  createdAt: '2026-10-19T10:00:00Z',
};

const outro: NewProject = {
  id: 'p2',
  name: 'Outro',
  path: 'C:\\dev\\outro',
  normalizedPath: 'c:/dev/outro',
  repositoryKind: 'none',
  createdAt: '2026-10-19T10:05:00Z',
};

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'project-hub-repo-'));
  const dbFile = join(dir, 'project-hub.sqlite');
  db = openDatabase(dbFile);
  migrateDatabase(db, { filePath: dbFile });
  repo = createProjectRepository(db);
});

afterEach(() => {
  db.$client.close();
  rmSync(dir, { recursive: true, force: true });
});

describe('ProjectRepository', () => {
  it('insere e lê um projeto, sem criar campos opcionais que não foram informados', () => {
    repo.insert(hub);

    expect(repo.get('p1')).toStrictEqual({
      id: 'p1',
      name: 'Project Hub',
      path: 'C:\\dev\\project-hub',
      normalizedPath: 'c:/dev/project-hub',
      repositoryKind: 'git',
      isFavorite: false,
      trusted: false,
      createdAt: '2026-10-19T10:00:00Z',
      updatedAt: '2026-10-19T10:00:00Z',
    });
  });

  it('guarda descrição e branch padrão quando informados', () => {
    repo.insert({
      ...hub,
      description: 'Hub local de projetos',
      defaultBranch: 'main',
    });

    expect(repo.get('p1')).toMatchObject({
      description: 'Hub local de projetos',
      defaultBranch: 'main',
    });
  });

  it('recusa dois projetos com o mesmo caminho normalizado', () => {
    repo.insert(hub);

    expect(() => repo.insert({ ...outro, normalizedPath: hub.normalizedPath })).toThrow(
      /UNIQUE constraint failed/,
    );
  });

  it('recusa um tipo de repositório fora de git e none', () => {
    expect(() =>
      repo.insert({ ...hub, repositoryKind: 'svn' as NewProject['repositoryKind'] }),
    ).toThrow(/CHECK constraint failed/);
  });

  it('remoção lógica esconde da lista e mantém o registro', () => {
    repo.insert(hub);
    repo.insert(outro);

    repo.markRemoved('p1', '2026-10-19T12:00:00Z');

    expect(repo.list().map((project) => project.id)).toEqual(['p2']);
    expect(repo.get('p1')?.removedAt).toBe('2026-10-19T12:00:00Z');
    expect(repo.get('p1')?.updatedAt).toBe('2026-10-19T12:00:00Z');
  });

  it('acha o projeto pelo caminho normalizado, inclusive quando ele foi removido', () => {
    repo.insert(hub);

    expect(repo.findByNormalizedPath('c:/dev/project-hub')?.id).toBe('p1');
    expect(repo.findByNormalizedPath('c:/dev/inexistente')).toBeUndefined();

    repo.markRemoved('p1', '2026-10-19T12:00:00Z');

    expect(repo.findByNormalizedPath('c:/dev/project-hub')?.removedAt).toBe('2026-10-19T12:00:00Z');
  });

  it('restaura um projeto removido: volta à lista, sem campo de remoção e com a data nova', () => {
    repo.insert(hub);
    repo.markRemoved('p1', '2026-10-19T12:00:00Z');

    repo.restore('p1', '2026-10-19T13:00:00Z');

    expect(repo.list().map((project) => project.id)).toEqual(['p1']);
    expect(repo.get('p1')).toStrictEqual({
      id: 'p1',
      name: 'Project Hub',
      path: 'C:\\dev\\project-hub',
      normalizedPath: 'c:/dev/project-hub',
      repositoryKind: 'git',
      isFavorite: false,
      trusted: false,
      createdAt: '2026-10-19T10:00:00Z',
      updatedAt: '2026-10-19T13:00:00Z',
    });
  });
});
