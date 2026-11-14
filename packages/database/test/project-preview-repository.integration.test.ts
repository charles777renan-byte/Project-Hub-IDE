import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { openDatabase, type AppDatabase } from '../src/client';
import { migrateDatabase } from '../src/migrate';
import {
  createProjectPreviewRepository,
  type ProjectPreviewRecord,
  type ProjectPreviewRepository,
} from '../src/repositories/project-preview-repository';
import { createProjectRepository } from '../src/repositories/project-repository';

let dir: string;
let db: AppDatabase;
let repo: ProjectPreviewRepository;

function preview(
  projectId: string,
  overrides: Partial<ProjectPreviewRecord> = {},
): ProjectPreviewRecord {
  return {
    projectId,
    kind: 'script',
    packageManager: 'pnpm',
    script: 'dev',
    scriptBody: 'vite',
    fixedUrl: null,
    lastUrl: 'http://localhost:5173/',
    terminalId: 'term-1',
    staticPort: null,
    updatedAt: '2026-11-13T10:00:00Z',
    ...overrides,
  };
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'project-hub-previews-'));
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
  repo = createProjectPreviewRepository(db);
});

afterEach(() => {
  db.$client.close();
  rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
});

describe('repositório do preview do projeto', () => {
  it('projeto sem preview guardado devolve undefined', () => {
    expect(repo.get('p1')).toBeUndefined();
  });

  it('grava e devolve o mesmo registro', () => {
    const record = preview('p1');
    repo.save(record);
    expect(repo.get('p1')).toEqual(record);
  });

  it('guarda as três formas: script, endereço fixo e nenhuma aprovação', () => {
    const address = preview('p1', {
      kind: 'address',
      packageManager: null,
      script: null,
      scriptBody: null,
      fixedUrl: 'http://localhost:3000/',
      lastUrl: 'http://localhost:3000/',
      terminalId: null,
    });
    repo.save(address);
    expect(repo.get('p1')).toEqual(address);

    const none = preview('p2', {
      kind: 'none',
      packageManager: null,
      script: null,
      scriptBody: null,
      lastUrl: 'http://127.0.0.1:49152/',
      terminalId: null,
      staticPort: 49152,
    });
    repo.save(none);
    expect(repo.get('p2')).toEqual(none);
  });

  it('gravar de novo troca a linha inteira', () => {
    repo.save(preview('p1'));
    const next = preview('p1', {
      script: 'start',
      scriptBody: 'node server.js',
      lastUrl: null,
      terminalId: null,
      updatedAt: '2026-11-13T11:00:00Z',
    });
    repo.save(next);
    expect(repo.get('p1')).toEqual(next);
  });

  it('guarda o texto do script inteiro, com quebras e aspas', () => {
    const scriptBody = `node -e "console.log('a')" && vite --host\n${'x'.repeat(5000)}`;
    repo.save(preview('p1', { scriptBody }));
    expect(repo.get('p1')?.scriptBody).toBe(scriptBody);
  });

  it('apagar tira só a linha do projeto', () => {
    repo.save(preview('p1'));
    repo.save(preview('p2'));
    repo.delete('p1');
    expect(repo.get('p1')).toBeUndefined();
    expect(repo.get('p2')).toEqual(preview('p2'));
    // Apagar o que não existe não é erro.
    expect(() => repo.delete('p1')).not.toThrow();
  });

  it('recusa projeto que não existe', () => {
    expect(() => repo.save(preview('fantasma'))).toThrow();
  });
});
