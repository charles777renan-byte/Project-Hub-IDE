import * as application from '@project-hub/application';
import {
  CHANNELS,
  responseSchemas,
  type GitStatusDto,
  type PrReadingDto,
} from '@project-hub/contracts';
import type { ProjectRecord } from '@project-hub/domain';
import { GhError } from '@project-hub/github-adapter';
import type { IpcMainInvokeEvent } from 'electron';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { registerGithubHandlers } from '../src/main/ipc/github';
import type { IpcRegistry } from '../src/main/ipc/trusted-handler';

// Os casos de uso reais rodam por baixo; o espião só mostra com que argumento cada um foi chamado.
vi.mock('@project-hub/application', async (importOriginal) => {
  const actual = await importOriginal<typeof application>();
  return {
    ...actual,
    getPullRequestPanel: vi.fn(actual.getPullRequestPanel),
    addPullRequestComment: vi.fn(actual.addPullRequestComment),
    mergeProjectPullRequest: vi.fn(actual.mergeProjectPullRequest),
  };
});

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
  createdAt: '2026-11-03T00:00:00.000Z',
  updatedAt: '2026-11-03T00:00:00.000Z',
};

const STATUS: GitStatusDto = {
  branch: 'feat/x',
  upstream: 'origin/feat/x',
  ahead: 0,
  behind: 0,
  baseRef: 'origin/main',
  linesAdded: 0,
  linesRemoved: 0,
  files: [],
};

const READING: PrReadingDto = {
  pr: {
    number: 37,
    title: 'Painel Checks',
    state: 'OPEN',
    isDraft: false,
    mergeable: 'MERGEABLE',
    mergeStateStatus: 'CLEAN',
    url: 'https://github.com/dono/repo/pull/37',
    updatedAt: '2026-11-03T20:53:49Z',
    headRefName: 'feat/x',
    baseRefName: 'main',
    additions: 10,
    deletions: 2,
    reviewDecision: null,
  },
  checks: [],
  comments: [],
  readAt: '2026-11-03T21:00:00.000Z',
};

function setup() {
  const git = { status: vi.fn(() => Promise.resolve(STATUS)) };
  const github = {
    originUrl: vi.fn(() => Promise.resolve('https://github.com/dono/repo.git')),
    pullRequestForBranch: vi.fn(() => Promise.resolve(37 as number | null)),
    pullRequest: vi.fn(() => Promise.resolve(READING)),
    addComment: vi.fn(() => Promise.resolve()),
    mergePullRequest: vi.fn(() => Promise.resolve()),
  };
  const repo = { get: vi.fn((id: string) => (id === 'p1' ? PROJECT : undefined)) };
  const fs = {
    isDirectory: vi.fn(() => Promise.resolve(true)),
    isInsideProject: vi.fn(() => Promise.resolve(true)),
  };
  const panel = { repo, git, fs, github } as unknown as application.GithubPanelDeps;
  const openExternal = vi.fn((_url: string) => Promise.resolve());
  const fake = fakeRegistry();
  registerGithubHandlers(fake.registry, isTrusted, { panel, openExternal });
  return { fake, git, github, repo, fs, openExternal };
}

/** Um pedido válido por canal. */
const VALID: Record<string, unknown> = {
  [CHANNELS.githubPr]: { projectId: 'p1' },
  [CHANNELS.githubComment]: { projectId: 'p1', prNumber: 37, body: 'Olá' },
  [CHANNELS.githubMerge]: { projectId: 'p1', prNumber: 37, method: 'squash' },
  [CHANNELS.githubOpenUrl]: { url: 'https://github.com/dono/repo/pull/37' },
};
const CHANNEL_LIST = Object.keys(VALID);

let consoleError: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  vi.clearAllMocks();
  consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
});
afterEach(() => {
  consoleError.mockRestore();
});

describe('registerGithubHandlers: contrato dos canais', () => {
  it('registra os canais github:*:v1 e nenhum outro', () => {
    const { fake } = setup();
    const githubChannels = Object.values(CHANNELS).filter((c) => c.startsWith('github:'));
    expect(githubChannels).toHaveLength(4);
    expect(fake.channels()).toEqual([...githubChannels].sort());
  });

  it('um canal desconhecido não existe na superfície', () => {
    const { fake } = setup();
    expect(() => fake.call('github:close:v1', { projectId: 'p1' })).toThrow('não registrado');
    expect(() => fake.call('github:pr', { projectId: 'p1' })).toThrow('não registrado');
  });

  it.each(CHANNEL_LIST)(
    '%s: um pedido válido devolve uma resposta que o contrato aceita',
    async (channel) => {
      const { fake } = setup();
      const result = await fake.call(channel, VALID[channel]);
      expect(result).toMatchObject({ ok: true });
      const schema = responseSchemas[channel as keyof typeof responseSchemas];
      expect(schema.safeParse(result).success).toBe(true);
    },
  );

  it.each(CHANNEL_LIST)(
    '%s recusa remetente de outra origem sem tocar no projeto, no Git, no gh nem no navegador',
    async (channel) => {
      const { fake, git, github, repo, openExternal } = setup();
      const result = await fake.call(channel, VALID[channel], 'https://site.invalido/');
      expect(result).toMatchObject({ ok: false, error: { code: 'PERMISSION_DENIED' } });
      expect(repo.get).not.toHaveBeenCalled();
      expect(git.status).not.toHaveBeenCalled();
      for (const method of Object.values(github)) expect(method).not.toHaveBeenCalled();
      expect(openExternal).not.toHaveBeenCalled();
    },
  );
});

describe('registerGithubHandlers: entrada conferida antes do caso de uso', () => {
  const INVALID: Array<[string, string, unknown]> = [
    ['pr sem projectId', CHANNELS.githubPr, {}],
    ['pr com projectId vazio', CHANNELS.githubPr, { projectId: '' }],
    ['pr sem payload', CHANNELS.githubPr, undefined],
    ['comentário vazio', CHANNELS.githubComment, { projectId: 'p1', prNumber: 37, body: '' }],
    [
      'comentário só de espaços',
      CHANNELS.githubComment,
      { projectId: 'p1', prNumber: 37, body: '   ' },
    ],
    [
      'comentário grande demais',
      CHANNELS.githubComment,
      { projectId: 'p1', prNumber: 37, body: 'x'.repeat(65_537) },
    ],
    ['comentário sem número', CHANNELS.githubComment, { projectId: 'p1', body: 'oi' }],
    [
      'comentário com número zero',
      CHANNELS.githubComment,
      { projectId: 'p1', prNumber: 0, body: 'oi' },
    ],
    [
      'comentário com número negativo',
      CHANNELS.githubComment,
      { projectId: 'p1', prNumber: -1, body: 'oi' },
    ],
    [
      'comentário com número fracionário',
      CHANNELS.githubComment,
      { projectId: 'p1', prNumber: 1.5, body: 'oi' },
    ],
    [
      'comentário com número em texto',
      CHANNELS.githubComment,
      { projectId: 'p1', prNumber: '37', body: 'oi' },
    ],
    ['merge sem método', CHANNELS.githubMerge, { projectId: 'p1', prNumber: 37 }],
    [
      'merge com método desconhecido',
      CHANNELS.githubMerge,
      { projectId: 'p1', prNumber: 37, method: 'force' },
    ],
    [
      'merge com número zero',
      CHANNELS.githubMerge,
      { projectId: 'p1', prNumber: 0, method: 'merge' },
    ],
    ['open-url sem url', CHANNELS.githubOpenUrl, {}],
    ['open-url com url que não é texto', CHANNELS.githubOpenUrl, { url: 42 }],
    ['open-url sem payload', CHANNELS.githubOpenUrl, undefined],
  ];

  it.each(INVALID)(
    '%s vira VALIDATION_FAILED sem chamar o caso de uso',
    async (_name, channel, payload) => {
      const { fake, git, github, repo, openExternal } = setup();

      const result = await fake.call(channel, payload);

      expect(result).toMatchObject({ ok: false, error: { code: 'VALIDATION_FAILED' } });
      expect(application.getPullRequestPanel).not.toHaveBeenCalled();
      expect(application.addPullRequestComment).not.toHaveBeenCalled();
      expect(application.mergeProjectPullRequest).not.toHaveBeenCalled();
      expect(repo.get).not.toHaveBeenCalled();
      expect(git.status).not.toHaveBeenCalled();
      for (const method of Object.values(github)) expect(method).not.toHaveBeenCalled();
      expect(openExternal).not.toHaveBeenCalled();
    },
  );

  it('o que o schema não declara é descartado: a branch e o caminho nunca vêm do pedido', async () => {
    const { fake, github } = setup();

    await fake.call(CHANNELS.githubPr, {
      projectId: 'p1',
      branch: 'outra',
      path: 'C:\\x',
      repoPath: 'D:\\y',
    });

    expect(application.getPullRequestPanel).toHaveBeenCalledWith(expect.anything(), {
      projectId: 'p1',
    });
    expect(github.pullRequestForBranch).toHaveBeenCalledWith(PROJECT.path, 'feat/x');
  });
});

describe('registerGithubHandlers: github:pr:v1', () => {
  it('devolve o PR da branch atual, lido pelo caso de uso', async () => {
    const { fake } = setup();

    const result = await fake.call(CHANNELS.githubPr, { projectId: 'p1' });

    expect(result).toEqual({
      ok: true,
      data: { kind: 'pr', result: { state: 'ok', reading: READING } },
    });
  });

  it('projeto desconhecido volta como PROJECT_NOT_FOUND', async () => {
    const { fake } = setup();
    const result = await fake.call(CHANNELS.githubPr, { projectId: 'nao-existe' });
    expect(result).toMatchObject({ ok: false, error: { code: 'PROJECT_NOT_FOUND' } });
  });

  it('GhError vira resposta com o código e a mensagem dele, sem a saída do gh', async () => {
    const { fake, github } = setup();
    github.pullRequest.mockRejectedValue(
      new GhError('GH_NOT_AUTHENTICATED', 'O GitHub CLI não está autenticado.', {
        exitCode: 4,
        stderr: 'token ghp_SEGREDO inválido',
        stdout: 'título secreto do PR',
      }),
    );

    const result = await fake.call(CHANNELS.githubPr, { projectId: 'p1' });

    expect(result).toEqual({
      ok: false,
      error: {
        code: 'GH_NOT_AUTHENTICATED',
        message: 'O GitHub CLI não está autenticado.',
        retryable: false,
      },
    });
    expect(JSON.stringify(result)).not.toContain('SEGREDO');
    expect(JSON.stringify(result)).not.toContain('secreto');
  });

  it('um erro inesperado vira UNKNOWN, sem repetir o texto dele', async () => {
    const { fake, github } = setup();
    github.pullRequest.mockRejectedValue(new Error('saída bruta do gh: ghp_SEGREDO'));

    const result = await fake.call(CHANNELS.githubPr, { projectId: 'p1' });

    expect(result).toEqual({
      ok: false,
      error: { code: 'UNKNOWN', message: 'Algo deu errado. Tente de novo.', retryable: false },
    });
  });
});

describe('registerGithubHandlers: github:comment:v1', () => {
  it('comenta no PR da branch, com o texto sem as pontas', async () => {
    const { fake, github } = setup();

    const result = await fake.call(CHANNELS.githubComment, {
      projectId: 'p1',
      prNumber: 37,
      body: '  Olá  ',
    });

    expect(result).toEqual({ ok: true, data: undefined });
    expect(application.addPullRequestComment).toHaveBeenCalledWith(expect.anything(), {
      projectId: 'p1',
      prNumber: 37,
      body: 'Olá',
    });
    expect(github.addComment).toHaveBeenCalledWith(PROJECT.path, 37, 'Olá');
  });

  it('PR de outra branch: GH_PR_NOT_FOUND, e nada é escrito', async () => {
    const { fake, github } = setup();

    const result = await fake.call(CHANNELS.githubComment, {
      projectId: 'p1',
      prNumber: 99,
      body: 'oi',
    });

    expect(result).toMatchObject({ ok: false, error: { code: 'GH_PR_NOT_FOUND' } });
    expect(github.addComment).not.toHaveBeenCalled();
  });

  it('falha de rede na escrita chega como veio, sem aviso de tentar de novo acrescentado', async () => {
    const { fake, github } = setup();
    const message = 'Não foi possível falar com o GitHub. O comentário pode ter sido publicado.';
    github.addComment.mockRejectedValue(new GhError('GH_NETWORK_FAILED', message));

    const result = await fake.call(CHANNELS.githubComment, VALID[CHANNELS.githubComment]);

    expect(result).toEqual({
      ok: false,
      error: { code: 'GH_NETWORK_FAILED', message, retryable: false },
    });
  });
});

describe('registerGithubHandlers: github:merge:v1', () => {
  it.each(['merge', 'squash', 'rebase'] as const)('mescla com o método %s', async (method) => {
    const { fake, github } = setup();

    const result = await fake.call(CHANNELS.githubMerge, { projectId: 'p1', prNumber: 37, method });

    expect(result).toEqual({ ok: true, data: undefined });
    expect(github.mergePullRequest).toHaveBeenCalledWith(PROJECT.path, 37, method);
  });

  it('PR que não está mesclável: GH_PR_NOT_MERGEABLE, sem chamar o merge', async () => {
    const { fake, github } = setup();
    github.pullRequest.mockResolvedValue({
      ...READING,
      pr: { ...READING.pr, mergeable: 'CONFLICTING' },
    });

    const result = await fake.call(CHANNELS.githubMerge, VALID[CHANNELS.githubMerge]);

    expect(result).toMatchObject({ ok: false, error: { code: 'GH_PR_NOT_MERGEABLE' } });
    expect(github.mergePullRequest).not.toHaveBeenCalled();
  });

  it('GhError do merge chega com código e mensagem, sem a saída do gh', async () => {
    const { fake, github } = setup();
    github.mergePullRequest.mockRejectedValue(
      new GhError('GH_PR_NOT_MERGEABLE', 'O GitHub recusou o merge.', {
        stderr: 'GraphQL: texto do GitHub',
      }),
    );

    const result = await fake.call(CHANNELS.githubMerge, VALID[CHANNELS.githubMerge]);

    expect(result).toEqual({
      ok: false,
      error: {
        code: 'GH_PR_NOT_MERGEABLE',
        message: 'O GitHub recusou o merge.',
        retryable: false,
      },
    });
  });
});

describe('registerGithubHandlers: github:open-url:v1', () => {
  const ACCEPTED = [
    'https://github.com/dono/repo/pull/37',
    'https://github.com/dono/repo/actions/runs/123/job/456?pr=37#step:3:1',
    'https://github.com',
    'https://GitHub.com/dono/repo',
  ];

  it.each(ACCEPTED)('abre %s no navegador', async (url) => {
    const { fake, openExternal } = setup();

    const result = await fake.call(CHANNELS.githubOpenUrl, { url });

    expect(result).toEqual({ ok: true, data: undefined });
    expect(openExternal).toHaveBeenCalledTimes(1);
    // O que abre é o endereço conferido e normalizado, não o texto cru.
    expect(openExternal).toHaveBeenCalledWith(new URL(url).href);
  });

  const REFUSED: Array<[string, string]> = [
    ['host que só começa com github.com', 'https://github.com.evil.com/x'],
    ['host com github.com no meio', 'https://evil.com/github.com'],
    ['subdomínio api', 'https://api.github.com/repos/a/b'],
    ['subdomínio gist', 'https://gist.github.com/a/b'],
    ['host com ponto final', 'https://github.com./a'],
    ['http sem TLS', 'http://github.com/a/b'],
    ['usuário na URL', 'https://user@github.com/a/b'],
    ['usuário e senha na URL', 'https://user:senha@github.com/a/b'],
    ['usuário disfarçando o host', 'https://github.com@evil.com/a'],
    ['porta explícita', 'https://github.com:8443/a/b'],
    ['esquema javascript', 'javascript:alert(1)'],
    ['esquema file', 'file:///C:/Windows/System32/calc.exe'],
    ['esquema ssh', 'ssh://git@github.com/a/b.git'],
    ['esquema mailto', 'mailto:alguem@github.com'],
    ['esquema data', 'data:text/html,<script>alert(1)</script>'],
    ['URL vazia', ''],
    ['só espaços', '   '],
    ['texto que não é URL', 'isto não é uma url'],
    ['URL relativa', '/dono/repo/pull/37'],
    ['sem esquema', 'github.com/dono/repo'],
  ];

  it.each(REFUSED)('recusa %s e não chama o openExternal', async (_name, url) => {
    const { fake, openExternal } = setup();

    const result = await fake.call(CHANNELS.githubOpenUrl, { url });

    expect(result).toEqual({
      ok: false,
      error: {
        code: 'VALIDATION_FAILED',
        message: 'Só é possível abrir endereços do github.com.',
        retryable: false,
      },
    });
    expect(openExternal).not.toHaveBeenCalled();
    // A recusa não devolve a URL crua, que veio de texto do GitHub.
    if (url.trim() !== '') expect(JSON.stringify(result)).not.toContain(url);
  });

  it('falha do navegador vira resposta em português, sem repetir a URL nem o erro', async () => {
    const { fake, openExternal } = setup();
    openExternal.mockRejectedValue(new Error('ERR_FAILED https://github.com/dono/repo'));

    const result = await fake.call(CHANNELS.githubOpenUrl, VALID[CHANNELS.githubOpenUrl]);

    expect(result).toEqual({
      ok: false,
      error: {
        code: 'UNKNOWN',
        message: 'Não foi possível abrir o link no navegador.',
        retryable: false,
      },
    });
  });
});
