import { describe, expect, it } from 'vitest';
import { addProject, type AddProjectDeps } from '../src/projects/add-project';
import { fakeFileSystem, fakeGit, fakeRepository } from './fakes';

const NOW = '2026-10-19T12:00:00.000Z';

function deps(overrides: Partial<AddProjectDeps> = {}): AddProjectDeps {
  return {
    repo: fakeRepository(),
    git: fakeGit({ kind: 'none' }),
    fs: fakeFileSystem(['C:\\Projetos\\app'], { caseInsensitive: true }),
    platform: 'win32',
    now: () => NOW,
    newId: () => 'id-1',
    ...overrides,
  };
}

describe('addProject', () => {
  it('cadastra uma pasta com Git e guarda nome, caminho e a branch padrão do detector', async () => {
    const result = await addProject(
      deps({ git: fakeGit({ kind: 'git', defaultBranch: 'main' }) }),
      { path: 'C:\\Projetos\\app' },
    );

    expect(result).toEqual({
      ok: true,
      data: {
        id: 'id-1',
        name: 'app',
        path: 'C:\\Projetos\\app',
        normalizedPath: 'c:\\projetos\\app',
        repositoryKind: 'git',
        defaultBranch: 'main',
        isFavorite: false,
        trusted: false,
        createdAt: NOW,
        updatedAt: NOW,
      },
    });
  });

  it('pasta sem Git entra como repositoryKind none, sem branch padrão', async () => {
    const result = await addProject(deps(), { path: 'C:\\Projetos\\app' });

    expect(result.ok && result.data.repositoryKind).toBe('none');
    expect(result.ok && result.data).not.toHaveProperty('defaultBranch');
  });

  it('projeto nasce com trusted false', async () => {
    const result = await addProject(deps(), { path: 'C:\\Projetos\\app' });

    expect(result.ok && result.data.trusted).toBe(false);
  });

  it('pasta repetida, com outra grafia, retorna PROJECT_ALREADY_EXISTS e não grava de novo', async () => {
    const repo = fakeRepository();
    const context = deps({ repo });
    await addProject(context, { path: 'C:\\Projetos\\app' });

    const again = await addProject(
      { ...context, newId: () => 'id-2' },
      { path: 'c:\\projetos\\APP\\' },
    );

    expect(again).toMatchObject({ ok: false, error: { code: 'PROJECT_ALREADY_EXISTS' } });
    expect(repo.records().map((record) => record.id)).toEqual(['id-1']);
  });

  it('caminho que não é diretório retorna PROJECT_PATH_UNAVAILABLE e não grava nada', async () => {
    const repo = fakeRepository();

    const result = await addProject(deps({ repo, fs: fakeFileSystem([]) }), {
      path: 'C:\\Projetos\\app',
    });

    expect(result).toMatchObject({ ok: false, error: { code: 'PROJECT_PATH_UNAVAILABLE' } });
    expect(repo.list()).toEqual([]);
  });

  it.each(['', 'app', '.\\app'])(
    'caminho que não é absoluto (%j) retorna VALIDATION_FAILED',
    async (path) => {
      const result = await addProject(deps(), { path });

      expect(result).toMatchObject({ ok: false, error: { code: 'VALIDATION_FAILED' } });
    },
  );

  it('no Linux, caixa diferente é outra pasta', async () => {
    const context = deps({
      platform: 'linux',
      fs: fakeFileSystem(['/home/ana/Projeto', '/home/ana/projeto']),
    });
    await addProject(context, { path: '/home/ana/Projeto' });

    const second = await addProject(
      { ...context, newId: () => 'id-2' },
      { path: '/home/ana/projeto' },
    );

    expect(second.ok && second.data.normalizedPath).toBe('/home/ana/projeto');
  });

  it('pasta removida que volta é restaurada, sem gravar outro registro', async () => {
    const repo = fakeRepository();
    const context = deps({ repo });
    await addProject(context, { path: 'C:\\Projetos\\app' });
    repo.markRemoved('id-1', '2026-10-19T13:00:00.000Z');

    const result = await addProject(
      { ...context, newId: () => 'id-2' },
      { path: 'C:\\Projetos\\app' },
    );

    expect(result).toEqual({
      ok: true,
      data: expect.objectContaining({ id: 'id-1', updatedAt: NOW }),
    });
    expect(result.ok && result.data).not.toHaveProperty('removedAt');
    expect(repo.records()).toEqual([expect.objectContaining({ id: 'id-1', updatedAt: NOW })]);
    expect(repo.list().map((record) => record.id)).toEqual(['id-1']);
  });

  it('pasta removida cujo diretório sumiu retorna PROJECT_PATH_UNAVAILABLE', async () => {
    const fs = fakeFileSystem(['C:\\Projetos\\app']);
    const repo = fakeRepository();
    const context = deps({ repo, fs });
    await addProject(context, { path: 'C:\\Projetos\\app' });
    repo.markRemoved('id-1', '2026-10-19T13:00:00.000Z');
    fs.remove('C:\\Projetos\\app');

    const result = await addProject(context, { path: 'C:\\Projetos\\app' });

    expect(result).toMatchObject({ ok: false, error: { code: 'PROJECT_PATH_UNAVAILABLE' } });
  });
});
