import type { GitPanelDeps } from '@project-hub/application';
import { CHANNELS, responseSchemas, type GitStatusDto } from '@project-hub/contracts';
import type { ProjectRecord } from '@project-hub/domain';
import { GitError } from '@project-hub/git-adapter';
import type { IpcMainInvokeEvent } from 'electron';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { registerGitHandlers } from '../src/main/ipc/git';
import type { IpcRegistry } from '../src/main/ipc/trusted-handler';

const TRUSTED = 'file:///app/index.html';
const isTrusted = (event: IpcMainInvokeEvent) => event.senderFrame?.url === TRUSTED;

function fakeRegistry() {
  const listeners = new Map<string, (event: IpcMainInvokeEvent, payload?: unknown) => unknown>();
  const registry: IpcRegistry = {
    handle(channel, listener) {
      listeners.set(channel, listener);
    },
  };
  return {
    registry,
    channels: () => [...listeners.keys()].sort(),
    call(channel: string, payload?: unknown, senderUrl = TRUSTED) {
      const listener = listeners.get(channel);
      if (listener === undefined) throw new Error(`canal ${channel} não registrado`);
      const event = { senderFrame: { url: senderUrl } } as unknown as IpcMainInvokeEvent;
      return listener(event, payload);
    },
  };
}

const PROJECT: ProjectRecord = {
  id: 'p1',
  name: 'Projeto',
  path: 'C:\\projetos\\p1',
  normalizedPath: 'c:\\projetos\\p1',
  repositoryKind: 'git',
  isFavorite: false,
  trusted: false,
  createdAt: '2026-11-02T00:00:00.000Z',
  updatedAt: '2026-11-02T00:00:00.000Z',
};

const STATUS: GitStatusDto = {
  branch: 'feat/x',
  upstream: 'origin/feat/x',
  ahead: 1,
  behind: 0,
  baseRef: 'origin/main',
  linesAdded: 3,
  linesRemoved: 1,
  files: [{ path: 'a.ts', staged: null, unstaged: 'M' }],
};

/** Uma porta de Git de mentira: cada método é um espião que responde algo válido. */
function fakeGit() {
  return {
    status: vi.fn(() => Promise.resolve(STATUS)),
    fileDiff: vi.fn(() =>
      Promise.resolve({
        path: 'a.ts',
        baseRef: 'origin/main',
        patch: '',
        binary: false,
        truncated: false,
      }),
    ),
    stage: vi.fn(() => Promise.resolve()),
    unstage: vi.fn(() => Promise.resolve()),
    discard: vi.fn(() => Promise.resolve()),
    commit: vi.fn(() => Promise.resolve({ commit: 'a'.repeat(40) })),
    push: vi.fn(() => Promise.resolve({ branch: 'feat/x' })),
    pull: vi.fn(() => Promise.resolve({ updated: true })),
    fetch: vi.fn(() => Promise.resolve()),
    log: vi.fn(() => Promise.resolve([])),
    branchChanges: vi.fn(() =>
      Promise.resolve({ baseRef: 'origin/main', mergeBase: null, files: [] }),
    ),
  };
}

function setup() {
  const git = fakeGit();
  const repo = { get: vi.fn((id: string) => (id === 'p1' ? PROJECT : undefined)) };
  const fs = {
    isDirectory: vi.fn(() => Promise.resolve(true)),
    isInsideProject: vi.fn(() => Promise.resolve(true)),
  };
  const deps = { repo, git, fs } as unknown as GitPanelDeps;
  const fake = fakeRegistry();
  registerGitHandlers(fake.registry, isTrusted, deps);
  return { fake, git, repo, fs };
}

/** Um pedido válido por canal. */
const VALID: Record<string, unknown> = {
  [CHANNELS.gitStatus]: { projectId: 'p1' },
  [CHANNELS.gitDiff]: { projectId: 'p1', path: 'src/a.ts' },
  [CHANNELS.gitStage]: { projectId: 'p1', paths: ['src/a.ts'] },
  [CHANNELS.gitUnstage]: { projectId: 'p1', paths: ['src/a.ts'] },
  [CHANNELS.gitDiscard]: { projectId: 'p1', paths: ['src/a.ts'] },
  [CHANNELS.gitCommit]: { projectId: 'p1', message: 'feat: algo' },
  [CHANNELS.gitPush]: { projectId: 'p1' },
  [CHANNELS.gitPublish]: { projectId: 'p1' },
  [CHANNELS.gitPull]: { projectId: 'p1' },
  [CHANNELS.gitFetch]: { projectId: 'p1' },
  [CHANNELS.gitLog]: { projectId: 'p1' },
  [CHANNELS.gitBranchChanges]: { projectId: 'p1' },
};
const CHANNEL_LIST = Object.keys(VALID);
const NO_UPSTREAM: GitStatusDto = { ...STATUS, upstream: null, ahead: null, behind: null };

let consoleError: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
});
afterEach(() => {
  consoleError.mockRestore();
});

describe('registerGitHandlers: contrato dos canais', () => {
  it('registra os doze canais git:*:v1 e nenhum outro', () => {
    const { fake } = setup();
    const gitChannels = Object.values(CHANNELS).filter((channel) => channel.startsWith('git:'));
    expect(gitChannels).toHaveLength(12);
    expect(fake.channels()).toEqual([...gitChannels].sort());
    expect(fake.channels()).toEqual([...CHANNEL_LIST].sort());
  });

  it('um canal desconhecido não existe na superfície', () => {
    const { fake } = setup();
    expect(() => fake.call('git:reset:v1', { projectId: 'p1' })).toThrow('não registrado');
    expect(() => fake.call('git:status', { projectId: 'p1' })).toThrow('não registrado');
  });

  it.each(CHANNEL_LIST)(
    '%s: um pedido válido devolve uma resposta que o contrato aceita',
    async (channel) => {
      const { fake, git } = setup();
      // Publicar só vale para a branch que ainda não tem upstream.
      if (channel === CHANNELS.gitPublish) git.status.mockResolvedValue(NO_UPSTREAM);
      const result = await fake.call(channel, VALID[channel]);
      expect(result).toMatchObject({ ok: true });
      const schema = responseSchemas[channel as keyof typeof responseSchemas];
      expect(schema.safeParse(result).success).toBe(true);
    },
  );

  it.each(CHANNEL_LIST)(
    '%s recusa remetente de outra origem sem tocar no projeto nem no Git',
    async (channel) => {
      const { fake, git, repo } = setup();
      const result = await fake.call(channel, VALID[channel], 'https://site.invalido/');
      expect(result).toMatchObject({ ok: false, error: { code: 'PERMISSION_DENIED' } });
      expect(repo.get).not.toHaveBeenCalled();
      for (const method of Object.values(git)) expect(method).not.toHaveBeenCalled();
    },
  );
});

describe('registerGitHandlers: entrada conferida antes do caso de uso', () => {
  const INVALID: Array<[string, string, unknown]> = [
    ['projectId vazio', CHANNELS.gitStatus, { projectId: '' }],
    ['sem projectId', CHANNELS.gitPush, {}],
    ['publicar sem projectId', CHANNELS.gitPublish, {}],
    ['sem payload', CHANNELS.gitFetch, undefined],
    ['caminho com ..', CHANNELS.gitStage, { projectId: 'p1', paths: ['../x'] }],
    ['caminho absoluto', CHANNELS.gitUnstage, { projectId: 'p1', paths: ['/etc/passwd'] }],
    ['pasta .git', CHANNELS.gitDiscard, { projectId: 'p1', paths: ['.git/config'] }],
    ['lista de caminhos vazia', CHANNELS.gitStage, { projectId: 'p1', paths: [] }],
    ['caminho do diff com ..', CHANNELS.gitDiff, { projectId: 'p1', path: '../x' }],
    ['mensagem vazia', CHANNELS.gitCommit, { projectId: 'p1', message: '' }],
    ['mensagem só de espaços', CHANNELS.gitCommit, { projectId: 'p1', message: '   ' }],
  ];

  it.each(INVALID)(
    '%s vira VALIDATION_FAILED sem chamar o caso de uso',
    async (_name, channel, payload) => {
      const { fake, git, repo, fs } = setup();
      const result = await fake.call(channel, payload);
      expect(result).toMatchObject({ ok: false, error: { code: 'VALIDATION_FAILED' } });
      expect(repo.get).not.toHaveBeenCalled();
      expect(fs.isDirectory).not.toHaveBeenCalled();
      expect(fs.isInsideProject).not.toHaveBeenCalled();
      for (const method of Object.values(git)) expect(method).not.toHaveBeenCalled();
    },
  );

  it('um campo branch no payload não chega ao caso de uso nem à porta', async () => {
    const { fake, git } = setup();
    const branch = 'main; rm -rf /';
    for (const channel of [CHANNELS.gitPush, CHANNELS.gitPull, CHANNELS.gitFetch]) {
      const result = await fake.call(channel, { projectId: 'p1', branch });
      expect(result).toMatchObject({ ok: true });
    }
    git.status.mockResolvedValue(NO_UPSTREAM);
    expect(await fake.call(CHANNELS.gitPublish, { projectId: 'p1', branch })).toMatchObject({
      ok: true,
    });
    // A porta recebe só a pasta do projeto: o nome da branch sai do processo principal.
    expect(git.push).toHaveBeenCalledTimes(2);
    for (const call of git.push.mock.calls) expect(call).toEqual([PROJECT.path]);
    expect(git.push).toHaveBeenCalledWith(PROJECT.path);
    expect(git.pull).toHaveBeenCalledWith(PROJECT.path);
    expect(git.fetch).toHaveBeenCalledWith(PROJECT.path);
  });

  it('git:push:v1 com upstream chama a porta de push', async () => {
    const { fake, git } = setup();
    expect(await fake.call(CHANNELS.gitPush, VALID[CHANNELS.gitPush])).toMatchObject({ ok: true });
    expect(git.push).toHaveBeenCalledTimes(1);
    expect(git.push).toHaveBeenCalledWith(PROJECT.path);
  });

  it('git:push:v1 sem upstream devolve VALIDATION_FAILED do caso de uso, sem publicar', async () => {
    const { fake, git } = setup();
    git.status.mockResolvedValue(NO_UPSTREAM);
    expect(await fake.call(CHANNELS.gitPush, VALID[CHANNELS.gitPush])).toMatchObject({
      ok: false,
      error: { code: 'VALIDATION_FAILED', message: expect.stringContaining('Publicar branch') },
    });
    expect(git.push).not.toHaveBeenCalled();
  });

  it('git:publish:v1 sem upstream chama a porta de push', async () => {
    const { fake, git } = setup();
    git.status.mockResolvedValue(NO_UPSTREAM);
    expect(await fake.call(CHANNELS.gitPublish, VALID[CHANNELS.gitPublish])).toMatchObject({
      ok: true,
    });
    expect(git.push).toHaveBeenCalledTimes(1);
    expect(git.push).toHaveBeenCalledWith(PROJECT.path);
  });

  it('git:publish:v1 com upstream devolve VALIDATION_FAILED do caso de uso, sem enviar', async () => {
    const { fake, git } = setup();
    expect(await fake.call(CHANNELS.gitPublish, VALID[CHANNELS.gitPublish])).toMatchObject({
      ok: false,
      error: { code: 'VALIDATION_FAILED', message: expect.stringContaining('Enviar') },
    });
    expect(git.push).not.toHaveBeenCalled();
  });

  it.each([CHANNELS.gitPush, CHANNELS.gitPublish])(
    '%s com o HEAD destacado devolve GIT_DETACHED_HEAD sem chamar o push',
    async (channel) => {
      const { fake, git } = setup();
      git.status.mockResolvedValue({ ...NO_UPSTREAM, branch: null });
      expect(await fake.call(channel, VALID[channel])).toMatchObject({
        ok: false,
        error: { code: 'GIT_DETACHED_HEAD' },
      });
      expect(git.push).not.toHaveBeenCalled();
    },
  );

  it('o commit leva a mensagem sem as pontas, e o resto do payload fica de fora', async () => {
    const { fake, git } = setup();
    await fake.call(CHANNELS.gitCommit, { projectId: 'p1', message: '  feat: x  ', amend: true });
    expect(git.commit).toHaveBeenCalledWith(PROJECT.path, 'feat: x');
  });

  it('um pedido válido chega à porta com a pasta do projeto, não com o id', async () => {
    const { fake, git } = setup();
    await fake.call(CHANNELS.gitStage, VALID[CHANNELS.gitStage]);
    expect(git.stage).toHaveBeenCalledWith(PROJECT.path, ['src/a.ts']);
    await fake.call(CHANNELS.gitLog, VALID[CHANNELS.gitLog]);
    expect(git.log).toHaveBeenCalledWith(PROJECT.path, 50);
  });
});

describe('registerGitHandlers: o erro chega ao renderer só com código e mensagem', () => {
  const SENTINEL = 'SEGREDO-TESTE';

  it('GitError com cause, stdout e stderr não vaza nada além do código e da mensagem', async () => {
    const { fake, git } = setup();
    git.commit.mockRejectedValue(
      new GitError('GIT_HOOK_FAILED', 'Um hook do Git recusou o commit.', {
        exitCode: 1,
        stdout: `saída ${SENTINEL}`,
        stderr: `erro ${SENTINEL}`,
        cause: new Error(`causa ${SENTINEL}`),
      }),
    );

    const result = await fake.call(CHANNELS.gitCommit, VALID[CHANNELS.gitCommit]);

    expect(result).toMatchObject({
      ok: false,
      error: { code: 'GIT_HOOK_FAILED', message: 'Um hook do Git recusou o commit.' },
    });
    expect(JSON.stringify(result)).not.toContain(SENTINEL);
  });

  it('erro que não é GitError vira UNKNOWN com mensagem segura', async () => {
    const { fake, git } = setup();
    git.push.mockRejectedValue(new Error(`falha interna ${SENTINEL} C:\\segredo`));

    const result = await fake.call(CHANNELS.gitPush, VALID[CHANNELS.gitPush]);

    expect(result).toMatchObject({ ok: false, error: { code: 'UNKNOWN' } });
    expect(JSON.stringify(result)).not.toContain(SENTINEL);
    expect(JSON.stringify(result)).not.toContain('segredo');
  });

  it('a falha do Git é registrada no console, e o IPC não rejeita', async () => {
    const { fake, git } = setup();
    git.status.mockRejectedValue(
      new GitError('GIT_NOT_AVAILABLE', 'Instale o Git e reinicie o Project Hub.'),
    );

    await expect(fake.call(CHANNELS.gitStatus, VALID[CHANNELS.gitStatus])).resolves.toMatchObject({
      ok: false,
      error: { code: 'GIT_NOT_AVAILABLE' },
    });
    expect(consoleError).toHaveBeenCalled();
  });
});
