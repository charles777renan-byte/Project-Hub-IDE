import { CHANNELS } from '@project-hub/contracts';
import { GitError } from '@project-hub/git-adapter';
import type { IpcMainInvokeEvent } from 'electron';
import { describe, expect, it, vi } from 'vitest';
import {
  archiveProject,
  type AddProjectDeps,
  type ProjectLifecycleDeps,
} from '@project-hub/application';
import {
  handleAddProject,
  handleChooseDirectory,
  handleProjectLifecycle,
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
    fs: { isDirectory: () => Promise.resolve(true) },
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

describe('registerProjectHandlers', () => {
  it('registra os canais de projetos, inclusive arquivar, desarquivar, remover e listar arquivados', () => {
    const { registry, channels } = fakeRegistry();
    registerProjectHandlers(registry, isTrusted, {
      services: neverCalled,
      lifecycle: neverCalledLifecycle,
      chooseDirectory: () => Promise.resolve(null),
    });

    expect(channels()).toEqual(
      [
        CHANNELS.projectsAdd,
        CHANNELS.projectsArchive,
        CHANNELS.projectsChooseDirectory,
        CHANNELS.projectsList,
        CHANNELS.projectsListArchived,
        CHANNELS.projectsRemove,
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
      chooseDirectory: () => Promise.resolve(null),
    });

    await expect(call(CHANNELS.projectsArchive, trusted, { projectId: 'p1' })).resolves.toEqual({
      ok: true,
      data: undefined,
    });
    expect(archive).toHaveBeenCalledWith('p1', NOW);
  });

  it('projects:list-archived devolve o resumo dos arquivados, com a disponibilidade da pasta', async () => {
    const { registry, call } = fakeRegistry();
    const archived = { ...PROJECT, archivedAt: NOW };
    registerProjectHandlers(registry, isTrusted, {
      services: neverCalled,
      lifecycle: lifecycleWith({ listArchived: () => [archived] }),
      chooseDirectory: () => Promise.resolve(null),
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
      chooseDirectory: () => Promise.resolve(null),
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
      chooseDirectory,
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
