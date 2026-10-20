import { describe, expect, it, vi } from 'vitest';
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

  // R78: um erro de acesso numa pasta não derruba a listagem. O projeto sai indisponível, o erro é
  // registrado, e os outros projetos seguem com o valor normal.
  it('pasta sem permissão: o projeto aparece indisponível, e os outros continuam disponíveis', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const repo = fakeRepository();
    repo.insert({
      id: 'bloqueado',
      name: 'bloqueado',
      path: 'C:\\Projetos\\bloqueado',
      normalizedPath: 'c:\\projetos\\bloqueado',
      repositoryKind: 'none',
      createdAt: '2026-10-19T10:00:00.000Z',
    });
    repo.insert({
      id: 'livre',
      name: 'livre',
      path: 'C:\\Projetos\\livre',
      normalizedPath: 'c:\\projetos\\livre',
      repositoryKind: 'none',
      createdAt: '2026-10-19T10:05:00.000Z',
    });
    const eacces = Object.assign(new Error('EACCES: permissão negada'), { code: 'EACCES' });
    const readable = fakeFileSystem(['C:\\Projetos\\livre']);

    const result = await listProjects({
      repo,
      fs: {
        isDirectory: (path) =>
          path === 'C:\\Projetos\\bloqueado' ? Promise.reject(eacces) : readable.isDirectory(path),
      },
    });

    expect(result).toEqual({
      ok: true,
      data: [
        expect.objectContaining({ id: 'bloqueado', available: false }),
        expect.objectContaining({ id: 'livre', available: true }),
      ],
    });
    expect(log).toHaveBeenCalledWith(expect.stringContaining('bloqueado'), eacces);
    log.mockRestore();
  });
});
