import { CHANNELS } from '@project-hub/contracts';
import { GitError } from '@project-hub/git-adapter';
import type { IpcMainInvokeEvent } from 'electron';
import { describe, expect, it, vi } from 'vitest';
import {
  archiveProject,
  type AddProjectDeps,
  type InitRepositoryDeps,
  type ProjectLifecycleDeps,
} from '@project-hub/application';
import {
  handleAddProject,
  handleChooseDirectory,
  handleInitRepository,
  handleOpenFolder,
  handleProjectLifecycle,
  handleRepositoryPreview,
  handleSetGroup,
  handleSetNickname,
  registerProjectHandlers,
} from '../src/main/ipc/projects';
import { registerTrustedHandler, type IpcRegistry } from '../src/main/ipc/trusted-handler';

// Os handlers recebem o evento do Electron. Aqui ele é uma imitação com só o remetente.
type Listener = (event: IpcMainInvokeEvent, payload?: unknown) => Promise<unknown>;

function fakeRegistry() {
  const listeners = new Map<string, Listener>();
  const registry: IpcRegistry = {
    handle: (channel, listener) => {
      listeners.set(channel, listener);
    },
  };
  return {
    registry,
    call(channel: string, event: IpcMainInvokeEvent, payload?: unknown) {
      const listener = listeners.get(channel);
      if (listener === undefined) throw new Error(`canal ${channel} não registrado`);
      return listener(event, payload);
    },
    channels: () => [...listeners.keys()].sort(),
  };
}

const trusted = {
  senderFrame: { url: 'http://localhost:5173/#/projects' },
} as unknown as IpcMainInvokeEvent;
const foreign = { senderFrame: { url: 'https://evil.example/' } } as unknown as IpcMainInvokeEvent;
const isTrusted = (event: IpcMainInvokeEvent) => event === trusted;

// Serviços vazios: qualquer uso deles quebra o teste, porque a entrada devia ser recusada antes.
const neverCalled = {} as AddProjectDeps;
const neverCalledLifecycle = {} as ProjectLifecycleDeps;
const neverCalledRepository = {} as InitRepositoryDeps;

const NOW = '2026-10-21T09:00:00.000Z';
type ProjectRecord = NonNullable<ReturnType<ProjectLifecycleDeps['repo']['get']>>;
const PROJECT: ProjectRecord = {
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

/** Caso de uso de ciclo de vida com o repositório falso: o projeto existe e a pasta também. */
function lifecycleWith(repo: Partial<ProjectLifecycleDeps['repo']> = {}): ProjectLifecycleDeps {
  return {
    repo: {
      get: () => PROJECT,
      listArchived: () => [],
      archive: () => undefined,
      ...repo,
    } as ProjectLifecycleDeps['repo'],
    missions: { listMissions: () => [] },
    fs: { isDirectory: () => Promise.resolve(true), isInsideProject: () => Promise.resolve(true) },
    now: () => NOW,
  };
}

describe('registerTrustedHandler', () => {
  it('remetente confiável recebe o resultado do handler', async () => {
    const { registry, call } = fakeRegistry();
    registerTrustedHandler(registry, 'canal:teste:v1', isTrusted, () =>
      Promise.resolve({ ok: true, data: 'pong' }),
    );

    await expect(call('canal:teste:v1', trusted)).resolves.toEqual({ ok: true, data: 'pong' });
  });

  it('remetente de outra origem recebe PERMISSION_DENIED, e o handler não roda', async () => {
    const { registry, call } = fakeRegistry();
    const handler = vi.fn(() => Promise.resolve({ ok: true as const, data: 'pong' }));
    registerTrustedHandler(registry, 'canal:teste:v1', isTrusted, handler);

    await expect(call('canal:teste:v1', foreign)).resolves.toMatchObject({
      ok: false,
      error: { code: 'PERMISSION_DENIED' },
    });
    expect(handler).not.toHaveBeenCalled();
  });

  it('erro inesperado no handler vira UNKNOWN e não rejeita para o renderer', async () => {
    const { registry, call } = fakeRegistry();
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    registerTrustedHandler(registry, 'canal:teste:v1', isTrusted, () =>
      Promise.reject(new Error('disco cheio')),
    );

    await expect(call('canal:teste:v1', trusted)).resolves.toMatchObject({
      ok: false,
      error: { code: 'UNKNOWN' },
    });
    expect(log).toHaveBeenCalled();
    log.mockRestore();
  });

  // Só o GitError tem código e mensagem pensados para a tela. Qualquer outro erro continua UNKNOWN.
  it('GitError chega ao renderer com o código e a mensagem dele', async () => {
    const { registry, call } = fakeRegistry();
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    registerTrustedHandler(registry, 'canal:teste:v1', isTrusted, () =>
      Promise.reject(new GitError('GIT_NOT_AVAILABLE', 'Instale o Git e reinicie o Project Hub.')),
    );

    await expect(call('canal:teste:v1', trusted)).resolves.toEqual({
      ok: false,
      error: {
        code: 'GIT_NOT_AVAILABLE',
        message: 'Instale o Git e reinicie o Project Hub.',
        retryable: false,
      },
    });
    // O erro continua no log, com a saída do Git que a mensagem não mostra.
    expect(log).toHaveBeenCalled();
    log.mockRestore();
  });

  it('erro que só parece um GitError (mesmo code e message) continua UNKNOWN', async () => {
    const { registry, call } = fakeRegistry();
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    registerTrustedHandler(registry, 'canal:teste:v1', isTrusted, () =>
      Promise.reject(Object.assign(new Error('Instale o Git'), { code: 'GIT_NOT_AVAILABLE' })),
    );

    await expect(call('canal:teste:v1', trusted)).resolves.toMatchObject({
      ok: false,
      error: { code: 'UNKNOWN' },
    });
    log.mockRestore();
  });
});

describe('handleAddProject', () => {
  it.each([{ path: 123 }, { path: '' }, { path: null }, {}, null, 'C:\\Projetos\\app'])(
    'payload inválido (%j) vira VALIDATION_FAILED, sem chegar à aplicação',
    async (payload) => {
      const result = await handleAddProject(neverCalled, payload);

      expect(result).toMatchObject({ ok: false, error: { code: 'VALIDATION_FAILED' } });
    },
  );
});

describe('handleProjectLifecycle', () => {
  it.each([null, {}, { projectId: '' }, { projectId: 1 }, 'p1'])(
    'payload inválido (%j) vira VALIDATION_FAILED, sem chegar ao caso de uso',
    (payload) => {
      const action = vi.fn(archiveProject);

      expect(handleProjectLifecycle(action, neverCalledLifecycle, payload)).toMatchObject({
        ok: false,
        error: { code: 'VALIDATION_FAILED' },
      });
      expect(action).not.toHaveBeenCalled();
    },
  );

  it('payload válido chama o caso de uso com o id do projeto', () => {
    const action = vi.fn(() => ({ ok: true as const, data: undefined }));
    const deps = lifecycleWith();

    expect(handleProjectLifecycle(action, deps, { projectId: 'p1' })).toEqual({
      ok: true,
      data: undefined,
    });
    expect(action).toHaveBeenCalledWith(deps, { projectId: 'p1' });
  });
});

describe('handleChooseDirectory', () => {
  it('devolve { path } quando a pessoa escolhe uma pasta', async () => {
    await expect(
      handleChooseDirectory(() => Promise.resolve('C:\\Projetos\\app')),
    ).resolves.toEqual({ ok: true, data: { path: 'C:\\Projetos\\app' } });
  });

  it('devolve null quando a pessoa cancela', async () => {
    await expect(handleChooseDirectory(() => Promise.resolve(null))).resolves.toEqual({
      ok: true,
      data: null,
    });
  });
});

describe('handleOpenFolder', () => {
  function deps(overrides: { found?: boolean; directory?: boolean; problem?: string } = {}) {
    const openFolder = vi.fn(() => Promise.resolve(overrides.problem ?? ''));
    return {
      openFolder,
      deps: {
        services: {
          repo: { get: () => (overrides.found === false ? undefined : PROJECT) },
          fs: { isDirectory: () => Promise.resolve(overrides.directory !== false) },
        } as unknown as AddProjectDeps,
        lifecycle: neverCalledLifecycle,
        repository: neverCalledRepository,
        chooseDirectory: () => Promise.resolve(null),
        openFolder,
      },
    };
  }

  it('recusa a entrada sem o id do projeto, sem abrir nada', async () => {
    const { deps: d, openFolder } = deps();
    await expect(handleOpenFolder(d, {})).resolves.toMatchObject({
      ok: false,
      error: { code: 'VALIDATION_FAILED' },
    });
    expect(openFolder).not.toHaveBeenCalled();
  });

  it('abre a pasta do registro, e não um caminho vindo da tela', async () => {
    const { deps: d, openFolder } = deps();
    await expect(handleOpenFolder(d, { projectId: 'p1', path: 'C:\\Windows' })).resolves.toEqual({
      ok: true,
      data: undefined,
    });
    expect(openFolder).toHaveBeenCalledWith(PROJECT.path);
  });

  it('projeto desconhecido e pasta que sumiu viram erro do contrato', async () => {
    await expect(
      handleOpenFolder(deps({ found: false }).deps, { projectId: 'x' }),
    ).resolves.toMatchObject({ ok: false, error: { code: 'PROJECT_NOT_FOUND' } });
    const missing = deps({ directory: false });
    await expect(handleOpenFolder(missing.deps, { projectId: 'p1' })).resolves.toMatchObject({
      ok: false,
      error: { code: 'PROJECT_PATH_UNAVAILABLE' },
    });
    expect(missing.openFolder).not.toHaveBeenCalled();
  });

  it('falha do sistema ao abrir vira UNKNOWN, sem repassar o texto cru', async () => {
    const { deps: d } = deps({ problem: 'erro interno do sistema' });
    const result = await handleOpenFolder(d, { projectId: 'p1' });
    expect(result).toMatchObject({ ok: false, error: { code: 'UNKNOWN' } });
    expect(JSON.stringify(result)).not.toContain('erro interno');
  });
});

describe('handleSetGroup', () => {
  it('recusa entrada fora do contrato, sem chamar a aplicação', () => {
    expect(handleSetGroup(neverCalledLifecycle, { projectId: 'p1', group: 5 })).toMatchObject({
      ok: false,
      error: { code: 'VALIDATION_FAILED' },
    });
    expect(handleSetGroup(neverCalledLifecycle, {})).toMatchObject({
      ok: false,
      error: { code: 'VALIDATION_FAILED' },
    });
  });
});

describe('handleSetNickname', () => {
  it('recusa entrada fora do contrato, sem chamar a aplicação', () => {
    expect(handleSetNickname(neverCalledLifecycle, { projectId: 'p1', nickname: 5 })).toMatchObject(
      {
        ok: false,
        error: { code: 'VALIDATION_FAILED' },
      },
    );
    expect(handleSetNickname(neverCalledLifecycle, {})).toMatchObject({
      ok: false,
      error: { code: 'VALIDATION_FAILED' },
    });
  });

  it('apelido com mais de 24 caracteres volta com a mensagem do limite', () => {
    expect(
      handleSetNickname(neverCalledLifecycle, { projectId: 'p1', nickname: 'x'.repeat(25) }),
    ).toMatchObject({
      ok: false,
      error: { code: 'VALIDATION_FAILED', message: 'O apelido pode ter até 24 caracteres.' },
    });
  });
});

describe('registerProjectHandlers', () => {
  it('registra os canais de projetos, inclusive arquivar, desarquivar, remover e listar arquivados', () => {
    const { registry, channels } = fakeRegistry();
    registerProjectHandlers(registry, isTrusted, {
      services: neverCalled,
      lifecycle: neverCalledLifecycle,
      repository: neverCalledRepository,
      chooseDirectory: () => Promise.resolve(null),
      openFolder: () => Promise.resolve(''),
    });

    expect(channels()).toEqual(
      [
        CHANNELS.projectsAdd,
        CHANNELS.projectsArchive,
        CHANNELS.projectsChooseDirectory,
        CHANNELS.projectsList,
        CHANNELS.projectsListArchived,
        CHANNELS.projectsRemove,
        CHANNELS.projectsOpenFolder,
        CHANNELS.projectsRepositoryPreview,
        CHANNELS.projectsInitRepository,
        CHANNELS.projectsSetGroup,
        CHANNELS.projectsSetNickname,
        CHANNELS.projectsUnarchive,
      ].sort(),
    );
  });

  it('projects:archive chama o caso de uso e grava o arquivamento com a data de agora', async () => {
    const { registry, call } = fakeRegistry();
    const archive = vi.fn();
    registerProjectHandlers(registry, isTrusted, {
      services: neverCalled,
      lifecycle: lifecycleWith({ archive }),
      repository: neverCalledRepository,
      chooseDirectory: () => Promise.resolve(null),
      openFolder: () => Promise.resolve(''),
    });

    await expect(call(CHANNELS.projectsArchive, trusted, { projectId: 'p1' })).resolves.toEqual({
      ok: true,
      data: undefined,
    });
    expect(archive).toHaveBeenCalledWith('p1', NOW);
  });

  it('projects:remove que deu certo avisa onRemoved com o id do projeto', async () => {
    const { registry, call } = fakeRegistry();
    const onRemoved = vi.fn();
    registerProjectHandlers(registry, isTrusted, {
      services: neverCalled,
      lifecycle: lifecycleWith({ markRemoved: () => undefined }),
      repository: neverCalledRepository,
      chooseDirectory: () => Promise.resolve(null),
      openFolder: () => Promise.resolve(''),
      onRemoved,
    });

    await expect(call(CHANNELS.projectsRemove, trusted, { projectId: 'p1' })).resolves.toEqual({
      ok: true,
      data: undefined,
    });
    expect(onRemoved).toHaveBeenCalledExactlyOnceWith('p1');
  });

  it('projects:remove que falhou não avisa onRemoved', async () => {
    const { registry, call } = fakeRegistry();
    const onRemoved = vi.fn();
    registerProjectHandlers(registry, isTrusted, {
      services: neverCalled,
      lifecycle: lifecycleWith({ get: () => undefined }),
      repository: neverCalledRepository,
      chooseDirectory: () => Promise.resolve(null),
      openFolder: () => Promise.resolve(''),
      onRemoved,
    });

    await expect(
      call(CHANNELS.projectsRemove, trusted, { projectId: 'p1' }),
    ).resolves.toMatchObject({ ok: false, error: { code: 'PROJECT_NOT_FOUND' } });
    await call(CHANNELS.projectsRemove, trusted, {});
    expect(onRemoved).not.toHaveBeenCalled();
  });

  it('uma falha em onRemoved não desfaz a remoção', async () => {
    const { registry, call } = fakeRegistry();
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    registerProjectHandlers(registry, isTrusted, {
      services: neverCalled,
      lifecycle: lifecycleWith({ markRemoved: () => undefined }),
      repository: neverCalledRepository,
      chooseDirectory: () => Promise.resolve(null),
      openFolder: () => Promise.resolve(''),
      onRemoved: () => {
        throw new Error('falhou');
      },
    });

    await expect(call(CHANNELS.projectsRemove, trusted, { projectId: 'p1' })).resolves.toEqual({
      ok: true,
      data: undefined,
    });
    log.mockRestore();
  });

  it('projects:list-archived devolve o resumo dos arquivados, com a disponibilidade da pasta', async () => {
    const { registry, call } = fakeRegistry();
    const archived = { ...PROJECT, archivedAt: NOW };
    registerProjectHandlers(registry, isTrusted, {
      services: neverCalled,
      lifecycle: lifecycleWith({ listArchived: () => [archived] }),
      repository: neverCalledRepository,
      chooseDirectory: () => Promise.resolve(null),
      openFolder: () => Promise.resolve(''),
    });

    await expect(call(CHANNELS.projectsListArchived, trusted)).resolves.toEqual({
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

  it('projects:add com o Git ausente responde GIT_NOT_AVAILABLE com a instrução, e não UNKNOWN', async () => {
    const { registry, call } = fakeRegistry();
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    // Aplicação de verdade (addProject), com um detector que falha como o do Git ausente.
    const services = {
      repo: { findByNormalizedPath: () => undefined },
      fs: { isDirectory: () => Promise.resolve(true) },
      git: {
        detect: () =>
          Promise.reject(
            new GitError('GIT_NOT_AVAILABLE', 'Instale o Git e reinicie o Project Hub.'),
          ),
      },
      platform: 'win32',
      now: () => '2026-10-19T12:00:00.000Z',
      newId: () => 'id-1',
    } as unknown as AddProjectDeps;
    registerProjectHandlers(registry, isTrusted, {
      services,
      lifecycle: neverCalledLifecycle,
      repository: neverCalledRepository,
      chooseDirectory: () => Promise.resolve(null),
      openFolder: () => Promise.resolve(''),
    });

    await expect(
      call(CHANNELS.projectsAdd, trusted, { path: 'C:\\Projetos\\app' }),
    ).resolves.toMatchObject({
      ok: false,
      error: { code: 'GIT_NOT_AVAILABLE', message: 'Instale o Git e reinicie o Project Hub.' },
    });
    log.mockRestore();
  });

  it('recusa todos os canais de projetos para remetente de outra origem, sem tocar na aplicação', async () => {
    const { registry, call, channels } = fakeRegistry();
    const chooseDirectory = vi.fn(() => Promise.resolve('C:\\Projetos\\app'));
    registerProjectHandlers(registry, isTrusted, {
      services: neverCalled,
      lifecycle: neverCalledLifecycle,
      repository: neverCalledRepository,
      chooseDirectory,
      openFolder: () => Promise.resolve(''),
    });

    for (const channel of channels()) {
      await expect(call(channel, foreign, { path: 'C:\\Projetos\\app' })).resolves.toMatchObject({
        ok: false,
        error: { code: 'PERMISSION_DENIED' },
      });
    }
    expect(chooseDirectory).not.toHaveBeenCalled();
  });
});

describe('criar o repositório Git: entrada conferida antes da aplicação (ADR 0009)', () => {
  it('a prévia e a criação recusam a entrada sem o id, sem chegar à aplicação', async () => {
    await expect(handleRepositoryPreview(neverCalledRepository, {})).resolves.toMatchObject({
      ok: false,
      error: { code: 'VALIDATION_FAILED' },
    });
    await expect(
      handleInitRepository(neverCalledRepository, { path: 'C:\\x' }),
    ).resolves.toMatchObject({ ok: false, error: { code: 'VALIDATION_FAILED' } });
  });
});
