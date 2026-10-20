import type { AppResult } from '@project-hub/contracts';
import { describe, expect, it, vi } from 'vitest';
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

/** Devolve o dado do resultado. Se o resultado for falha, o teste quebra com o código do erro. */
function dataOf<T>(result: AppResult<T>): T {
  if (!result.ok) throw new Error(`esperava sucesso, veio ${result.error.code}`);
  return result.data;
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

    expect(result).toMatchObject({ ok: true, data: { repositoryKind: 'none' } });
    expect(dataOf(result)).not.toHaveProperty('defaultBranch');
  });

  it('projeto nasce com trusted false e sem favorito', async () => {
    const result = await addProject(deps(), { path: 'C:\\Projetos\\app' });

    expect(result).toMatchObject({ ok: true, data: { trusted: false, isFavorite: false } });
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

  // No Windows, absoluto é só o que tem letra de unidade ou raiz UNC. `\app` tem raiz, mas é relativo à unidade.
  it.each(['', 'app', '.\\app', '\\app', 'C:app'])(
    'caminho que não é absoluto (%j) retorna VALIDATION_FAILED',
    async (path) => {
      const result = await addProject(deps(), { path });

      expect(result).toMatchObject({ ok: false, error: { code: 'VALIDATION_FAILED' } });
    },
  );

  it('aceita caminho UNC do Windows, com servidor e compartilhamento', async () => {
    const context = deps({
      fs: fakeFileSystem(['\\\\servidor\\pasta\\app'], { caseInsensitive: true }),
    });

    const result = await addProject(context, { path: '\\\\servidor\\pasta\\app' });

    expect(result).toMatchObject({
      ok: true,
      data: { name: 'app', path: '\\\\servidor\\pasta\\app' },
    });
  });

  // A raiz UNC sem barra final é raiz real do Windows: o win32 a devolve sem a barra no parse.
  it('aceita a raiz UNC sem barra final, que é a raiz de um compartilhamento', async () => {
    const context = deps({
      fs: fakeFileSystem(['\\\\servidor\\pasta\\'], { caseInsensitive: true }),
    });

    const result = await addProject(context, { path: '\\\\servidor\\pasta' });

    expect(result).toMatchObject({
      ok: true,
      data: { name: 'pasta', path: '\\\\servidor\\pasta\\' },
    });
  });

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

    expect(second).toMatchObject({ ok: true, data: { normalizedPath: '/home/ana/projeto' } });
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
    expect(dataOf(result)).not.toHaveProperty('removedAt');
    expect(repo.records()).toEqual([expect.objectContaining({ id: 'id-1', updatedAt: NOW })]);
    expect(repo.list().map((record) => record.id)).toEqual(['id-1']);
  });

  it('pasta removida que volta com Git é restaurada como git, com a branch padrão do detector', async () => {
    const repo = fakeRepository();
    const context = deps({ repo });
    await addProject(context, { path: 'C:\\Projetos\\app' });
    repo.markRemoved('id-1', '2026-10-19T13:00:00.000Z');

    const result = await addProject(
      { ...context, git: fakeGit({ kind: 'git', defaultBranch: 'main' }), newId: () => 'id-2' },
      { path: 'C:\\Projetos\\app' },
    );

    expect(result).toEqual({
      ok: true,
      data: expect.objectContaining({
        id: 'id-1',
        repositoryKind: 'git',
        defaultBranch: 'main',
        updatedAt: NOW,
      }),
    });
    expect(dataOf(result)).not.toHaveProperty('removedAt');
    // O que o banco guardou é o mesmo que a resposta mostra.
    expect(repo.get('id-1')).toEqual(dataOf(result));
    expect(repo.list().map((record) => record.id)).toEqual(['id-1']);
  });

  it('pasta removida que volta sem Git perde o tipo git e a branch padrão antigos', async () => {
    const repo = fakeRepository();
    const context = deps({ repo, git: fakeGit({ kind: 'git', defaultBranch: 'main' }) });
    await addProject(context, { path: 'C:\\Projetos\\app' });
    repo.markRemoved('id-1', '2026-10-19T13:00:00.000Z');

    const result = await addProject(
      { ...context, git: fakeGit({ kind: 'none' }), newId: () => 'id-2' },
      { path: 'C:\\Projetos\\app' },
    );

    expect(result).toMatchObject({ ok: true, data: { id: 'id-1', repositoryKind: 'none' } });
    expect(dataOf(result)).not.toHaveProperty('defaultBranch');
    expect(repo.get('id-1')).toEqual(dataOf(result));
  });

  it('pasta já cadastrada não roda o Git', async () => {
    const detect = vi.fn(() => Promise.resolve({ kind: 'none' as const }));
    const context = deps({ git: { detect } });
    await addProject(context, { path: 'C:\\Projetos\\app' });
    detect.mockClear();

    const again = await addProject(
      { ...context, newId: () => 'id-2' },
      { path: 'C:\\Projetos\\app' },
    );

    expect(again).toMatchObject({ ok: false, error: { code: 'PROJECT_ALREADY_EXISTS' } });
    expect(detect).not.toHaveBeenCalled();
  });

  // A consulta de duplicata acontece antes do Git, que é assíncrono: a checagem que vale para a gravação
  // é a de depois dele. Sem ela, o segundo cadastro bateria no índice único e subiria como erro.
  it('dois cadastros simultâneos da mesma pasta: um grava e o outro recebe PROJECT_ALREADY_EXISTS', async () => {
    const repo = fakeRepository();
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const git = {
      detect: async () => {
        await gate;
        return { kind: 'none' as const };
      },
    };
    const context = deps({ repo, git });

    const first = addProject({ ...context, newId: () => 'id-1' }, { path: 'C:\\Projetos\\app' });
    const second = addProject({ ...context, newId: () => 'id-2' }, { path: 'C:\\Projetos\\app' });
    release();

    expect(await first).toMatchObject({ ok: true, data: { id: 'id-1' } });
    expect(await second).toMatchObject({ ok: false, error: { code: 'PROJECT_ALREADY_EXISTS' } });
    expect(repo.records().map((record) => record.id)).toEqual(['id-1']);
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
