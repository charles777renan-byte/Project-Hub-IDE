import type { NewProject } from '@project-hub/domain';
import { describe, expect, it } from 'vitest';
import {
  addPullRequestComment,
  getPullRequestPanel,
  mergeProjectPullRequest,
  type GithubPanelDeps,
  type GithubPanelPort,
} from '../src';
import { fakeFileSystem, fakeGitPanel, fakeRepository, type FakeGitPanelOptions } from './fakes';
import { FakeGhError, fakeGithubPanel, prReading } from './fakes-github';

const PATH = 'C:\\Projetos\\app';

function project(overrides: Partial<NewProject> = {}): NewProject {
  return {
    id: 'p1',
    name: 'app',
    path: PATH,
    normalizedPath: 'c:\\projetos\\app',
    repositoryKind: 'git',
    createdAt: '2026-10-19T12:00:00.000Z',
    ...overrides,
  };
}

function setup(
  options: {
    github?: Partial<GithubPanelPort>;
    git?: FakeGitPanelOptions;
    seed?: NewProject[];
  } = {},
) {
  const { seed = [project()], git: gitOptions = {} } = options;
  const repo = fakeRepository();
  for (const seeded of seed) repo.insert(seeded);
  const git = fakeGitPanel(gitOptions);
  const github = fakeGithubPanel(options.github);
  const deps: GithubPanelDeps = {
    repo,
    git,
    fs: fakeFileSystem([PATH], { caseInsensitive: true }),
    github,
  };
  return { deps, git, github };
}

function fail(code: string, message: string) {
  return { ok: false, error: { code, message, retryable: false } };
}

const NOT_FOUND = fail('PROJECT_NOT_FOUND', 'O projeto não foi encontrado.');
const WRONG_BRANCH = fail('GH_PR_NOT_FOUND', 'O PR informado não é o da branch atual do projeto.');
const NOT_MERGEABLE = fail(
  'GH_PR_NOT_MERGEABLE',
  'O PR não pode ser mesclado agora: atualize a aba e confira o estado do PR.',
);

describe('getPullRequestPanel', () => {
  it('devolve o PR da branch atual, lida do git, com estado ok', async () => {
    const { deps, github } = setup();

    const result = await getPullRequestPanel(deps, { projectId: 'p1' });

    expect(result).toEqual({
      ok: true,
      data: { kind: 'pr', result: { state: 'ok', reading: prReading() } },
    });
    expect(github.pullRequestForBranch).toHaveBeenCalledWith(PATH, 'feat/x');
    expect(github.pullRequest).toHaveBeenCalledWith(PATH, 37);
  });

  it('a branch vem do repositório (git.status), e nunca do pedido', async () => {
    const { deps, github } = setup({
      git: { status: { branch: 'fix/outra' } },
      github: { pullRequest: () => Promise.resolve(prReading({ headRefName: 'fix/outra' })) },
    });

    // O pedido tenta impor uma branch: o caso de uso a ignora.
    const input = { projectId: 'p1', branch: 'main' } as { projectId: string };
    await getPullRequestPanel(deps, input);

    expect(github.pullRequestForBranch).toHaveBeenCalledWith(PATH, 'fix/outra');
  });

  it('sem PR na branch: no-pr, sem ler os detalhes', async () => {
    const { deps, github } = setup({
      github: { pullRequestForBranch: () => Promise.resolve(null) },
    });

    await expect(getPullRequestPanel(deps, { projectId: 'p1' })).resolves.toEqual({
      ok: true,
      data: { kind: 'no-pr' },
    });
    expect(github.pullRequest).not.toHaveBeenCalled();
  });

  it('HEAD destacado: no-pr, sem procurar PR', async () => {
    const { deps, github } = setup({ git: { status: { branch: null } } });

    await expect(getPullRequestPanel(deps, { projectId: 'p1' })).resolves.toEqual({
      ok: true,
      data: { kind: 'no-pr' },
    });
    expect(github.pullRequestForBranch).not.toHaveBeenCalled();
  });

  it('R20: PR de fork com o mesmo nome de branch (headRefName diferente) vira no-pr', async () => {
    const { deps } = setup({
      github: { pullRequest: () => Promise.resolve(prReading({ headRefName: 'feat/y' })) },
    });

    await expect(getPullRequestPanel(deps, { projectId: 'p1' })).resolves.toEqual({
      ok: true,
      data: { kind: 'no-pr' },
    });
  });

  it.each([
    ['sem origin', null],
    ['origin local', 'C:\\remotos\\repo.git'],
    ['origin de outro servidor', 'https://gitlab.com/dono/repo.git'],
    ['GitHub Enterprise', 'https://github.mycompany.com/dono/repo.git'],
    ['host parecido', 'https://github.com.evil.example/dono/repo.git'],
    ['usuário que imita o host', 'https://github.com@evil.example/dono/repo.git'],
  ])('%s: not-applicable, sem chamar o gh', async (_name, origin) => {
    const { deps, github } = setup({ github: { originUrl: () => Promise.resolve(origin) } });

    await expect(getPullRequestPanel(deps, { projectId: 'p1' })).resolves.toEqual({
      ok: true,
      data: { kind: 'not-applicable' },
    });
    expect(github.pullRequestForBranch).not.toHaveBeenCalled();
    expect(github.pullRequest).not.toHaveBeenCalled();
  });

  it.each([
    'https://github.com/dono/repo.git',
    'https://usuario@github.com/dono/repo',
    'git@github.com:dono/repo.git',
    'ssh://git@github.com/dono/repo.git',
    'ssh://git@github.com:22/dono/repo.git',
    'https://GitHub.com/dono/repo\n',
  ])('origin %s é do github.com', async (origin) => {
    const { deps } = setup({ github: { originUrl: () => Promise.resolve(origin) } });

    const result = await getPullRequestPanel(deps, { projectId: 'p1' });

    expect(result).toMatchObject({ ok: true, data: { kind: 'pr' } });
  });

  it('pasta sem Git: not-applicable, sem tocar o git nem o gh', async () => {
    const { deps, git, github } = setup({ seed: [project({ repositoryKind: 'none' })] });

    await expect(getPullRequestPanel(deps, { projectId: 'p1' })).resolves.toEqual({
      ok: true,
      data: { kind: 'not-applicable' },
    });
    expect(git.calls).toEqual([]);
    expect(github.originUrl).not.toHaveBeenCalled();
  });

  it('projeto inexistente: PROJECT_NOT_FOUND, sem chamar o gh', async () => {
    const { deps, github } = setup({ seed: [] });

    await expect(getPullRequestPanel(deps, { projectId: 'p1' })).resolves.toEqual(NOT_FOUND);
    expect(github.originUrl).not.toHaveBeenCalled();
  });

  it('erro do gh vira AppResult com o código e o texto do adaptador', async () => {
    const { deps } = setup({
      github: {
        pullRequest: () =>
          Promise.reject(
            new FakeGhError('GH_NOT_AUTHENTICATED', 'O GitHub CLI não está autenticado.'),
          ),
      },
    });

    await expect(getPullRequestPanel(deps, { projectId: 'p1' })).resolves.toEqual(
      fail('GH_NOT_AUTHENTICATED', 'O GitHub CLI não está autenticado.'),
    );
  });

  it('erro sem código do contrato continua subindo', async () => {
    const { deps } = setup({
      github: { pullRequestForBranch: () => Promise.reject(new Error('inesperado')) },
    });

    await expect(getPullRequestPanel(deps, { projectId: 'p1' })).rejects.toThrow('inesperado');
  });
});

describe('addPullRequestComment', () => {
  const input = { projectId: 'p1', prNumber: 37, body: 'Olá' };

  it('lê o PR e depois comenta, com o texto sem as pontas', async () => {
    const { deps, github } = setup();

    const result = await addPullRequestComment(deps, { ...input, body: '  Olá\n' });

    expect(result).toEqual({ ok: true, data: undefined });
    expect(github.pullRequest).toHaveBeenCalledWith(PATH, 37);
    expect(github.addComment).toHaveBeenCalledWith(PATH, 37, 'Olá');
    const readOrder = github.pullRequest.mock.invocationCallOrder[0] ?? 0;
    const writeOrder = github.addComment.mock.invocationCallOrder[0] ?? 0;
    expect(readOrder).toBeLessThan(writeOrder);
  });

  it.each([
    ['vazio', ''],
    ['só espaços', '   \n\t'],
    ['grande demais', 'a'.repeat(65_537)],
  ])('comentário %s: VALIDATION_FAILED, sem chamar nada', async (_name, body) => {
    const { deps, github, git } = setup();

    const result = await addPullRequestComment(deps, { ...input, body });

    expect(result).toMatchObject({ ok: false, error: { code: 'VALIDATION_FAILED' } });
    expect(github.pullRequest).not.toHaveBeenCalled();
    expect(github.addComment).not.toHaveBeenCalled();
    expect(git.calls).toEqual([]);
  });

  it.each([
    ['zero', 0],
    ['negativo', -3],
    ['fracionário', 1.5],
    ['NaN', Number.NaN],
    ['11 dígitos', 12_345_678_901],
    ['notação científica', 1e21],
  ])('número %s: VALIDATION_FAILED antes de qualquer chamada', async (_name, prNumber) => {
    const { deps, github, git } = setup();

    const result = await addPullRequestComment(deps, { ...input, prNumber });

    expect(result).toMatchObject({ ok: false, error: { code: 'VALIDATION_FAILED' } });
    expect(github.pullRequest).not.toHaveBeenCalled();
    expect(github.addComment).not.toHaveBeenCalled();
    expect(git.calls).toEqual([]);
  });

  it('aceita o maior número de 10 dígitos', async () => {
    const { deps, github } = setup();

    await addPullRequestComment(deps, { ...input, prNumber: 9_999_999_999 });

    expect(github.addComment).toHaveBeenCalledWith(PATH, 9_999_999_999, 'Olá');
  });

  it('M2.2: se a leitura do PR falhar, o comentário não é enviado', async () => {
    const { deps, github } = setup({
      github: {
        pullRequest: () =>
          Promise.reject(
            new FakeGhError('GH_NOT_AVAILABLE', 'Este repositório não é do github.com.'),
          ),
      },
    });

    await expect(addPullRequestComment(deps, input)).resolves.toEqual(
      fail('GH_NOT_AVAILABLE', 'Este repositório não é do github.com.'),
    );
    expect(github.addComment).not.toHaveBeenCalled();
  });

  it('R20: PR de outra branch (headRefName diferente): GH_PR_NOT_FOUND, sem comentar', async () => {
    const { deps, github } = setup({
      github: { pullRequest: () => Promise.resolve(prReading({ headRefName: 'feat/y' })) },
    });

    await expect(addPullRequestComment(deps, input)).resolves.toEqual(WRONG_BRANCH);
    expect(github.addComment).not.toHaveBeenCalled();
  });

  it('HEAD destacado: GH_PR_NOT_FOUND, sem comentar', async () => {
    const { deps, github } = setup({ git: { status: { branch: null } } });

    await expect(addPullRequestComment(deps, input)).resolves.toEqual(WRONG_BRANCH);
    expect(github.addComment).not.toHaveBeenCalled();
  });

  it('projeto inexistente: PROJECT_NOT_FOUND, sem chamar o gh', async () => {
    const { deps, github } = setup({ seed: [] });

    await expect(addPullRequestComment(deps, input)).resolves.toEqual(NOT_FOUND);
    expect(github.pullRequest).not.toHaveBeenCalled();
  });

  it('falha do gh ao comentar vira AppResult, repassando o texto do adaptador', async () => {
    const message = 'Não foi possível falar com o GitHub. A ação pode ter sido concluída: confira.';
    const { deps } = setup({
      github: { addComment: () => Promise.reject(new FakeGhError('GH_NETWORK_FAILED', message)) },
    });

    await expect(addPullRequestComment(deps, input)).resolves.toEqual(
      fail('GH_NETWORK_FAILED', message),
    );
  });
});

describe('mergeProjectPullRequest', () => {
  const input = { projectId: 'p1', prNumber: 37, method: 'squash' as const };

  it('relê o PR aberto e mesclável e então mescla, com a forma pedida', async () => {
    const { deps, github } = setup();

    const result = await mergeProjectPullRequest(deps, input);

    expect(result).toEqual({ ok: true, data: undefined });
    expect(github.mergePullRequest).toHaveBeenCalledWith(PATH, 37, 'squash');
    const readOrder = github.pullRequest.mock.invocationCallOrder[0] ?? 0;
    const writeOrder = github.mergePullRequest.mock.invocationCallOrder[0] ?? 0;
    expect(readOrder).toBeLessThan(writeOrder);
  });

  it.each([
    ['já mesclado', { state: 'MERGED', mergeable: 'UNKNOWN' }],
    ['fechado', { state: 'CLOSED', mergeable: 'UNKNOWN' }],
    ['com conflito', { state: 'OPEN', mergeable: 'CONFLICTING' }],
    ['ainda calculando', { state: 'OPEN', mergeable: 'UNKNOWN' }],
    ['fechado, embora mesclável', { state: 'CLOSED', mergeable: 'MERGEABLE' }],
  ] as const)(
    'estado mudou (%s): GH_PR_NOT_MERGEABLE sem chamar gh pr merge',
    async (_name, changes) => {
      const { deps, github } = setup({
        github: { pullRequest: () => Promise.resolve(prReading(changes)) },
      });

      await expect(mergeProjectPullRequest(deps, input)).resolves.toEqual(NOT_MERGEABLE);
      expect(github.mergePullRequest).not.toHaveBeenCalled();
    },
  );

  it('forma de merge inválida: VALIDATION_FAILED, sem chamar nada', async () => {
    const { deps, github } = setup();

    const result = await mergeProjectPullRequest(deps, {
      ...input,
      method: 'force' as unknown as 'merge',
    });

    expect(result).toMatchObject({ ok: false, error: { code: 'VALIDATION_FAILED' } });
    expect(github.pullRequest).not.toHaveBeenCalled();
    expect(github.mergePullRequest).not.toHaveBeenCalled();
  });

  it.each([
    ['zero', 0],
    ['negativo', -1],
    ['fracionário', 2.5],
    ['11 dígitos', 12_345_678_901],
  ])('número %s: VALIDATION_FAILED antes de qualquer chamada', async (_name, prNumber) => {
    const { deps, github, git } = setup();

    const result = await mergeProjectPullRequest(deps, { ...input, prNumber });

    expect(result).toMatchObject({ ok: false, error: { code: 'VALIDATION_FAILED' } });
    expect(github.pullRequest).not.toHaveBeenCalled();
    expect(github.mergePullRequest).not.toHaveBeenCalled();
    expect(git.calls).toEqual([]);
  });

  it('M2.2: se a leitura do PR falhar, o merge não acontece', async () => {
    const { deps, github } = setup({
      github: {
        pullRequest: () =>
          Promise.reject(
            new FakeGhError('GH_NETWORK_FAILED', 'Não foi possível falar com o GitHub.'),
          ),
      },
    });

    await expect(mergeProjectPullRequest(deps, input)).resolves.toEqual(
      fail('GH_NETWORK_FAILED', 'Não foi possível falar com o GitHub.'),
    );
    expect(github.mergePullRequest).not.toHaveBeenCalled();
  });

  it('R20: PR de outra branch (headRefName diferente): GH_PR_NOT_FOUND, sem mesclar', async () => {
    const { deps, github } = setup({
      github: { pullRequest: () => Promise.resolve(prReading({ headRefName: 'feat/y' })) },
    });

    await expect(mergeProjectPullRequest(deps, input)).resolves.toEqual(WRONG_BRANCH);
    expect(github.mergePullRequest).not.toHaveBeenCalled();
  });

  it('a branch conferida é a lida do git, e não outra', async () => {
    const { deps, github } = setup({
      git: { status: { branch: 'feat/y' } },
      github: { pullRequest: () => Promise.resolve(prReading({ headRefName: 'feat/x' })) },
    });

    await expect(mergeProjectPullRequest(deps, input)).resolves.toEqual(WRONG_BRANCH);
    expect(github.mergePullRequest).not.toHaveBeenCalled();
  });

  it('recusa do GitHub no merge vira AppResult com o código e o texto do adaptador', async () => {
    const message = 'O GitHub recusou o merge: o PR não pode ser mesclado agora.';
    const { deps } = setup({
      github: {
        mergePullRequest: () => Promise.reject(new FakeGhError('GH_PR_NOT_MERGEABLE', message)),
      },
    });

    await expect(mergeProjectPullRequest(deps, input)).resolves.toEqual(
      fail('GH_PR_NOT_MERGEABLE', message),
    );
  });

  it('projeto removido: PROJECT_NOT_FOUND, sem chamar o gh', async () => {
    const { deps, github } = setup();
    deps.repo.markRemoved('p1', '2026-11-02T12:00:00.000Z');

    await expect(mergeProjectPullRequest(deps, input)).resolves.toEqual(NOT_FOUND);
    expect(github.pullRequest).not.toHaveBeenCalled();
  });
});
