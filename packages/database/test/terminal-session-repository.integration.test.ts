import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { openDatabase, type AppDatabase } from '../src/client';
import { migrateDatabase } from '../src/migrate';
import { createProjectRepository } from '../src/repositories/project-repository';
import {
  createTerminalSessionRepository,
  type TerminalSessionRepository,
} from '../src/repositories/terminal-session-repository';

let dir: string;
let db: AppDatabase;
let repo: TerminalSessionRepository;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'project-hub-sessions-'));
  const dbFile = join(dir, 'project-hub.sqlite');
  db = openDatabase(dbFile);
  migrateDatabase(db, { filePath: dbFile });
  createProjectRepository(db).insert({
    id: 'p1',
    name: 'Project Hub',
    path: 'C:\\dev\\project-hub',
    normalizedPath: 'c:/dev/project-hub',
    repositoryKind: 'git',
    createdAt: '2026-10-22T09:00:00Z',
  });
  repo = createTerminalSessionRepository(db);
});

afterEach(() => {
  db.$client.close();
  rmSync(dir, { recursive: true, force: true });
});

describe('TerminalSessionRepository', () => {
  it('insere e lê uma sessão, sem criar closedAt', () => {
    repo.insert({
      id: 's1',
      projectId: 'p1',
      provider: 'claude',
      title: 'Claude Code',
      createdAt: '2026-10-22T10:00:00Z',
    });

    expect(repo.get('s1')).toStrictEqual({
      id: 's1',
      projectId: 'p1',
      provider: 'claude',
      title: 'Claude Code',
      createdAt: '2026-10-22T10:00:00Z',
    });
  });

  it('get de um id inexistente é undefined', () => {
    expect(repo.get('nada')).toBeUndefined();
  });

  it('recusa uma sessão de projeto que não existe', () => {
    expect(() =>
      repo.insert({
        id: 's1',
        projectId: 'fantasma',
        provider: 'shell',
        title: 'PowerShell',
        createdAt: '2026-10-22T10:00:00Z',
      }),
    ).toThrow(/FOREIGN KEY constraint failed/);
  });

  it('listOpen omite a sessão fechada e ordena da mais antiga para a mais nova', () => {
    repo.insert({
      id: 's2',
      projectId: 'p1',
      provider: 'codex',
      title: 'Codex',
      createdAt: '2026-10-22T10:05:00Z',
    });
    repo.insert({
      id: 's1',
      projectId: 'p1',
      provider: 'claude',
      title: 'Claude Code',
      createdAt: '2026-10-22T10:00:00Z',
    });
    repo.insert({
      id: 's3',
      projectId: 'p1',
      provider: 'shell',
      title: 'PowerShell',
      createdAt: '2026-10-22T10:10:00Z',
    });

    repo.close('s3', '2026-10-22T11:00:00Z');

    expect(repo.listOpen().map((session) => session.id)).toEqual(['s1', 's2']);
  });

  it('close grava closedAt', () => {
    repo.insert({
      id: 's1',
      projectId: 'p1',
      provider: 'claude',
      title: 'Claude Code',
      createdAt: '2026-10-22T10:00:00Z',
    });

    repo.close('s1', '2026-10-22T11:00:00Z');

    expect(repo.get('s1')?.closedAt).toBe('2026-10-22T11:00:00Z');
  });
});
