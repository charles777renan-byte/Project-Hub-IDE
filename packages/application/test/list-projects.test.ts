import { describe, expect, it } from 'vitest';
import type { ProjectRecord } from '@project-hub/domain';
import { listProjects } from '../src/projects/list-projects';
import { fakeFileSystem, fakeRepository } from './fakes';

const app: ProjectRecord = {
  id: 'p1',
  name: 'app',
  path: 'C:\\Projetos\\app',
  normalizedPath: 'c:\\projetos\\app',
  repositoryKind: 'git',
  isFavorite: false,
  trusted: false,
  createdAt: '2026-10-19T10:00:00.000Z',
  updatedAt: '2026-10-19T10:00:00.000Z',
};

function repoWith(record: ProjectRecord) {
  const repo = fakeRepository();
  repo.insert({
    id: record.id,
    name: record.name,
    path: record.path,
    normalizedPath: record.normalizedPath,
    repositoryKind: record.repositoryKind,
    createdAt: record.createdAt,
  });
  return repo;
}

describe('listProjects', () => {
  it('devolve o resumo com available true quando a pasta existe, sem campos internos', async () => {
    const result = await listProjects({
      repo: repoWith(app),
      fs: fakeFileSystem(['C:\\Projetos\\app']),
    });

    expect(result).toEqual({
      ok: true,
      data: [
        {
          id: 'p1',
          name: 'app',
          path: 'C:\\Projetos\\app',
          repositoryKind: 'git',
          available: true,
        },
      ],
    });
  });

  it('projeto cuja pasta sumiu continua listado com available false', async () => {
    const result = await listProjects({ repo: repoWith(app), fs: fakeFileSystem([]) });

    expect(result).toEqual({
      ok: true,
      data: [expect.objectContaining({ id: 'p1', available: false })],
    });
  });

  it('projeto removido não aparece', async () => {
    const repo = repoWith(app);
    repo.markRemoved('p1', '2026-10-19T12:00:00.000Z');

    const result = await listProjects({ repo, fs: fakeFileSystem(['C:\\Projetos\\app']) });

    expect(result).toEqual({ ok: true, data: [] });
  });
});
