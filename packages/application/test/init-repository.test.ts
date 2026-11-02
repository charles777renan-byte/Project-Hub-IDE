import type { AppResult, RepositoryInitPreview } from '@project-hub/contracts';
import type { NewProject } from '@project-hub/domain';
import { describe, expect, it, vi } from 'vitest';
import {
  initProjectRepository,
  previewRepositoryInit,
  type InitRepositoryDeps,
} from '../src/projects/init-repository';
import type { RepositoryInitializer } from '../src/ports';
import { fakeFileSystem, fakeRepository } from './fakes';

const NOW = '2026-11-02T12:00:00.000Z';
const PATH = 'C:\\Projetos\\app';

const PREVIEW: RepositoryInitPreview = {
  identityConfigured: true,
  createsGitignore: true,
  sensitiveFiles: ['.env'],
};

function project(overrides: Partial<NewProject> = {}): NewProject {
  return {
    id: 'p1',
    name: 'app',
    path: PATH,
    normalizedPath: 'c:\\projetos\\app',
    repositoryKind: 'none',
    createdAt: '2026-10-19T12:00:00.000Z',
    ...overrides,
  };
}

function initializer(overrides: Partial<RepositoryInitializer> = {}): RepositoryInitializer {
  return {
    preview: vi.fn(() => Promise.resolve<AppResult<RepositoryInitPreview>>({ ok: true, data: PREVIEW })),
    init: vi.fn(() => Promise.resolve<AppResult<{ defaultBranch: string }>>({ ok: true, data: { defaultBranch: 'main' } })),
    ...overrides,
  };
}

function deps(
  overrides: Partial<Omit<InitRepositoryDeps, 'repo'>> & { seed?: NewProject[] } = {},
): InitRepositoryDeps {
  const { seed = [project()], ...rest } = overrides;
  const repo = fakeRepository();
  for (const seeded of seed) repo.insert(seeded);
  return {
    repo,
    initializer: initializer(),
    fs: fakeFileSystem([PATH], { caseInsensitive: true }),
    now: () => NOW,
    ...rest,
  };
}

describe('previewRepositoryInit', () => {
  it('devolve a prévia da pasta sem Git, sem escrever nada', async () => {
    const d = deps();

    await expect(previewRepositoryInit(d, { projectId: 'p1' })).resolves.toEqual({
      ok: true,
      data: PREVIEW,
    });
    expect(d.initializer.init).not.toHaveBeenCalled();
  });

  it('recusa projeto que já é Git, projeto inexistente e pasta indisponível', async () => {
    await expect(
      previewRepositoryInit(deps({ seed: [project({ repositoryKind: 'git' })] }), { projectId: 'p1' }),
    ).resolves.toMatchObject({ ok: false, error: { code: 'VALIDATION_FAILED' } });
    await expect(previewRepositoryInit(deps(), { projectId: 'x' })).resolves.toMatchObject({
      ok: false,
      error: { code: 'PROJECT_NOT_FOUND' },
    });
    await expect(
      previewRepositoryInit(deps({ fs: fakeFileSystem([]) }), { projectId: 'p1' }),
    ).resolves.toMatchObject({ ok: false, error: { code: 'PROJECT_PATH_UNAVAILABLE' } });
  });

  it('projeto removido conta como inexistente', async () => {
    const d = deps();
    d.repo.markRemoved('p1', NOW);

    await expect(previewRepositoryInit(d, { projectId: 'p1' })).resolves.toMatchObject({
      ok: false,
      error: { code: 'PROJECT_NOT_FOUND' },
    });
  });
});

describe('initProjectRepository', () => {
  it('cria o repositório, grava o tipo e a branch no projeto e devolve o registro atualizado', async () => {
    const d = deps();

    const result = await initProjectRepository(d, { projectId: 'p1' });

    expect(d.initializer.init).toHaveBeenCalledWith(PATH);
    expect(result).toMatchObject({
      ok: true,
      data: { id: 'p1', repositoryKind: 'git', defaultBranch: 'main', updatedAt: NOW },
    });
  });

  it('se a criação falha, o projeto fica como estava e a falha segue para a tela', async () => {
    const d = deps({
      initializer: initializer({
        init: vi.fn(() =>
          Promise.resolve<AppResult<{ defaultBranch: string }>>({
            ok: false,
            error: { code: 'UNKNOWN', message: 'falhou', retryable: false },
          }),
        ),
      }),
    });

    await expect(initProjectRepository(d, { projectId: 'p1' })).resolves.toMatchObject({
      ok: false,
      error: { code: 'UNKNOWN', message: 'falhou' },
    });
    expect(d.repo.get('p1')).toMatchObject({ repositoryKind: 'none' });
  });

  it('não cria o repositório de uma pasta que já é Git', async () => {
    const d = deps({ seed: [project({ repositoryKind: 'git' })] });

    await expect(initProjectRepository(d, { projectId: 'p1' })).resolves.toMatchObject({
      ok: false,
      error: { code: 'VALIDATION_FAILED' },
    });
    expect(d.initializer.init).not.toHaveBeenCalled();
  });
});
