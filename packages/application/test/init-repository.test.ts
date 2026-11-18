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
import {
  GIT_IDENTITY_EMAIL_KEY,
  GIT_IDENTITY_NAME_KEY,
  suggestGitIdentity,
} from '../src/projects/git-identity';
import { DISPLAY_NAME_KEY } from '../src/profile/profile';
import type { SettingsRepository } from '../src/ports';

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

/** Configurações em memória, com o que o teste semeia. */
function settings(seed: Record<string, string> = {}): SettingsRepository & { all(): Record<string, string> } {
  const values = new Map(Object.entries(seed));
  return {
    get: (key) => values.get(key),
    set: (key, value) => void values.set(key, value),
    remove: (key) => void values.delete(key),
    all: () => Object.fromEntries(values),
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
    identity: { settings: settings(), osUserName: () => 'charl' },
    ...rest,
  };
}

const NO_IDENTITY: RepositoryInitPreview = { ...PREVIEW, identityConfigured: false };

function withoutIdentity(): RepositoryInitializer {
  return initializer({
    preview: vi.fn(() =>
      Promise.resolve<AppResult<RepositoryInitPreview>>({ ok: true, data: NO_IDENTITY }),
    ),
  });
}

describe('suggestGitIdentity', () => {
  it('usa o nome do perfil e um e-mail local com o usuário do sistema', () => {
    expect(
      suggestGitIdentity({
        settings: settings({ [DISPLAY_NAME_KEY]: 'Ana Souza' }),
        osUserName: () => 'Ana.Souza',
      }),
    ).toEqual({ name: 'Ana Souza', email: 'ana.souza@project-hub.local' });
  });

  it('sem perfil, o nome é o usuário do sistema', () => {
    expect(suggestGitIdentity({ settings: settings(), osUserName: () => 'charl' })).toEqual({
      name: 'charl',
      email: 'charl@project-hub.local',
    });
  });

  it('repete a identidade que a pessoa usou da última vez', () => {
    expect(
      suggestGitIdentity({
        settings: settings({
          [DISPLAY_NAME_KEY]: 'Ana',
          [GIT_IDENTITY_NAME_KEY]: 'Ana Souza',
          [GIT_IDENTITY_EMAIL_KEY]: 'ana@empresa.com',
        }),
        osUserName: () => 'charl',
      }),
    ).toEqual({ name: 'Ana Souza', email: 'ana@empresa.com' });
  });

  it('limpa o que o Git não aceita e nunca devolve nome ou e-mail vazio', () => {
    expect(
      suggestGitIdentity({
        settings: settings({ [DISPLAY_NAME_KEY]: '-<Ana>' }),
        osUserName: () => 'João da Silva',
      }),
    ).toEqual({ name: 'Ana', email: 'joao-da-silva@project-hub.local' });
    expect(suggestGitIdentity({ settings: settings(), osUserName: () => '' })).toEqual({
      name: 'Usuário',
      email: 'usuario@project-hub.local',
    });
  });
});

describe('previewRepositoryInit', () => {
  it('devolve a prévia da pasta sem Git, sem escrever nada', async () => {
    const d = deps();

    await expect(previewRepositoryInit(d, { projectId: 'p1' })).resolves.toEqual({
      ok: true,
      data: PREVIEW,
    });
    expect(d.initializer.init).not.toHaveBeenCalled();
  });

  it('sem identidade no Git, a prévia traz o autor proposto; com identidade, não traz', async () => {
    const d = deps({ initializer: withoutIdentity() });

    await expect(previewRepositoryInit(d, { projectId: 'p1' })).resolves.toEqual({
      ok: true,
      data: {
        ...NO_IDENTITY,
        suggestedIdentity: { name: 'charl', email: 'charl@project-hub.local' },
      },
    });
    const configured = await previewRepositoryInit(deps(), { projectId: 'p1' });
    expect(configured.ok && configured.data.suggestedIdentity).toBeUndefined();
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

    expect(d.initializer.init).toHaveBeenCalledWith(PATH, undefined);
    expect(result).toMatchObject({
      ok: true,
      data: { id: 'p1', repositoryKind: 'git', defaultBranch: 'main', updatedAt: NOW },
    });
  });

  it('repassa a identidade confirmada e a guarda para o próximo projeto', async () => {
    const store = settings();
    const d = deps({ identity: { settings: store, osUserName: () => 'charl' } });
    const identity = { name: 'Ana Souza', email: 'ana@empresa.com' };

    const result = await initProjectRepository(d, { projectId: 'p1', identity });

    expect(result.ok).toBe(true);
    expect(d.initializer.init).toHaveBeenCalledWith(PATH, identity);
    expect(store.all()).toEqual({
      [GIT_IDENTITY_NAME_KEY]: 'Ana Souza',
      [GIT_IDENTITY_EMAIL_KEY]: 'ana@empresa.com',
    });
  });

  it('se a criação falha, a identidade informada não é guardada', async () => {
    const store = settings();
    const d = deps({
      identity: { settings: store, osUserName: () => 'charl' },
      initializer: initializer({
        init: vi.fn(() =>
          Promise.resolve<AppResult<{ defaultBranch: string }>>({
            ok: false,
            error: { code: 'UNKNOWN', message: 'falhou', retryable: false },
          }),
        ),
      }),
    });

    await initProjectRepository(d, {
      projectId: 'p1',
      identity: { name: 'Ana', email: 'ana@empresa.com' },
    });

    expect(store.all()).toEqual({});
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
