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
const UNSUPPORTED = fail(
  'GH_NOT_AVAILABLE',
  'Este repositório não é do github.com, e o Project Hub só lê PRs de lá.',
);
/** Ordem em que o `vi.fn` foi chamado pela primeira vez, para conferir a sequência entre portas. */
const order = (fn: { mock: { invocationCallOrder: number[] } }) =>
  fn.mock.invocationCallOrder[0] ?? 0;
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

  it('R20: PR achado cuja headRefName não é a branch atual vira no-pr', async () => {
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

  it('forma curta com usuário que tem a letra s: someuser@github.com:dono/repo.git é github.com', async () => {
    const { deps } = setup({
      github: { originUrl: () => Promise.resolve('someuser@github.com:dono/repo.git') },
    });

    const result = await getPullRequestPanel(deps, { projectId: 'p1' });

    expect(result).toMatchObject({ ok: true, data: { kind: 'pr' } });
  });

  it('forma curta com host que tem a letra s e não é github.com: not-applicable', async () => {
    const { deps, github } = setup({
      github: { originUrl: () => Promise.resolve('someuser@gitsserver.example:dono/repo.git') },
    });

    await expect(getPullRequestPanel(deps, { projectId: 'p1' })).resolves.toEqual({
      ok: true,
      data: { kind: 'not-applicable' },
    });
    expect(github.pullRequestForBranch).not.toHaveBeenCalled();
  });

  it('git.status com erro do contrato vira AppResult; sem código continua subindo', async () => {
    const coded = setup({
      git: { errors: { status: new FakeGhError('GIT_NOT_AVAILABLE', 'Falha do Git.') } },
    });
    await expect(getPullRequestPanel(coded.deps, { projectId: 'p1' })).resolves.toMatchObject({
      ok: false,
      error: { code: 'GIT_NOT_AVAILABLE', message: 'Falha do Git.' },
    });
    expect(coded.github.pullRequestForBranch).not.toHaveBeenCalled();

    const plain = setup({ git: { errors: { status: new Error('inesperado') } } });
    await expect(getPullRequestPanel(plain.deps, { projectId: 'p1' })).rejects.toThrow(
      'inesperado',
    );
    expect(plain.github.pullRequestForBranch).not.toHaveBeenCalled();
  });

  it.each([
    ['EACCES do Node', 'EACCES'],
    ['código do contrato, mas de fora dos adaptadores', 'PERMISSION_DENIED'],
  ])('erro comum com code (%s) não vaza a mensagem: resposta genérica', async (_name, code) => {
    const leaked = "EACCES: permission denied, open 'C:\Users\ana\segredo\.git\config'";
    const error = Object.assign(new Error(leaked), { code });
    const generic = fail('UNKNOWN', 'Algo deu errado. Tente de novo.');

    const fromGit = setup({ git: { errors: { status: error } } });
    await expect(getPullRequestPanel(fromGit.deps, { projectId: 'p1' })).resolves.toEqual(generic);

    const fromGh = setup({ github: { pullRequestForBranch: () => Promise.reject(error) } });
    const panel = await getPullRequestPanel(fromGh.deps, { projectId: 'p1' });
    expect(panel).toEqual(generic);
    expect(JSON.stringify(panel)).not.toContain('segredo');

    const commenting = setup({ github: { addComment: () => Promise.reject(error) } });
    await expect(
      addPullRequestComment(commenting.deps, { projectId: 'p1', prNumber: 37, body: 'oi' }),
    ).resolves.toEqual(generic);
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

  it('lê o PR e depois comenta, com o início preservado e o final aparado', async () => {
    const { deps, github } = setup();

    const result = await addPullRequestComment(deps, { ...input, body: '  Olá\n' });

    expect(result).toEqual({ ok: true, data: undefined });
    expect(github.pullRequest).toHaveBeenCalledWith(PATH, 37);
    expect(github.addComment).toHaveBeenCalledWith(PATH, 37, '  Olá');
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
    ['texto', '37' as unknown as number],
  ])('número %s: VALIDATION_FAILED antes de qualquer chamada', async (_name, prNumber) => {
    const { deps, github, git } = setup();

    const result = await addPullRequestComment(deps, { ...input, prNumber });

    expect(result).toMatchObject({ ok: false, error: { code: 'VALIDATION_FAILED' } });
    expect(github.pullRequest).not.toHaveBeenCalled();
    expect(github.addComment).not.toHaveBeenCalled();
    expect(git.calls).toEqual([]);
  });

  it('aceita o maior número de 10 dígitos', async () => {
    const { deps, github } = setup({
      github: { pullRequestForBranch: () => Promise.resolve(9_999_999_999) },
    });

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

  it('R30: origin do GitHub Enterprise: recusa antes de qualquer chamada ao gh', async () => {
    const { deps, github } = setup({
      github: { originUrl: () => Promise.resolve('https://github.mycompany.com/dono/repo.git') },
    });

    await expect(addPullRequestComment(deps, input)).resolves.toEqual(UNSUPPORTED);
    expect(github.pullRequest).not.toHaveBeenCalled();
    expect(github.pullRequestForBranch).not.toHaveBeenCalled();
    expect(github.addComment).not.toHaveBeenCalled();
  });

  it('R30: sem origin: recusa antes de qualquer chamada ao gh', async () => {
    const { deps, github } = setup({ github: { originUrl: () => Promise.resolve(null) } });

    await expect(addPullRequestComment(deps, input)).resolves.toEqual(UNSUPPORTED);
    expect(github.pullRequest).not.toHaveBeenCalled();
    expect(github.addComment).not.toHaveBeenCalled();
  });

  it('R31: número diferente do PR da branch: GH_PR_NOT_FOUND, sem comentar', async () => {
    const { deps, github } = setup({
      github: { pullRequestForBranch: () => Promise.resolve(38) },
    });

    await expect(addPullRequestComment(deps, input)).resolves.toEqual(WRONG_BRANCH);
    expect(github.addComment).not.toHaveBeenCalled();
  });

  it('R31: branch sem PR: GH_PR_NOT_FOUND, sem comentar', async () => {
    const { deps, github } = setup({
      github: { pullRequestForBranch: () => Promise.resolve(null) },
    });

    await expect(addPullRequestComment(deps, input)).resolves.toEqual(WRONG_BRANCH);
    expect(github.addComment).not.toHaveBeenCalled();
  });

  it('R31: número igual ao PR da branch: comenta, depois de ler o PR e de achar o da branch', async () => {
    const { deps, github } = setup();

    await expect(addPullRequestComment(deps, input)).resolves.toEqual({
      ok: true,
      data: undefined,
    });
    expect(github.pullRequestForBranch).toHaveBeenCalledWith(PATH, 'feat/x');
    expect(order(github.originUrl)).toBeLessThan(order(github.pullRequest));
    expect(order(github.pullRequest)).toBeLessThan(order(github.pullRequestForBranch));
    expect(order(github.pullRequestForBranch)).toBeLessThan(order(github.addComment));
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

  it('PR em rascunho: GH_PR_NOT_MERGEABLE com mensagem de rascunho, sem chamar gh pr merge', async () => {
    const { deps, github } = setup({
      github: {
        pullRequest: () => Promise.resolve(prReading({ isDraft: true, mergeable: 'MERGEABLE' })),
      },
    });

    await expect(mergeProjectPullRequest(deps, input)).resolves.toEqual(
      fail(
        'GH_PR_NOT_MERGEABLE',
        'O PR está em rascunho: marque-o como pronto para revisão no GitHub antes de mesclar.',
      ),
    );
    expect(github.mergePullRequest).not.toHaveBeenCalled();
  });

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
    ['NaN', Number.NaN],
    ['notação científica', 1e21],
    ['texto', '37' as unknown as number],
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

  it('R30: origin do GitHub Enterprise: recusa antes de qualquer chamada ao gh', async () => {
    const { deps, github } = setup({
      github: { originUrl: () => Promise.resolve('https://github.mycompany.com/dono/repo.git') },
    });

    await expect(mergeProjectPullRequest(deps, input)).resolves.toEqual(UNSUPPORTED);
    expect(github.pullRequest).not.toHaveBeenCalled();
    expect(github.pullRequestForBranch).not.toHaveBeenCalled();
    expect(github.mergePullRequest).not.toHaveBeenCalled();
  });

  it('R31: número diferente do PR da branch: GH_PR_NOT_FOUND, sem mesclar', async () => {
    const { deps, github } = setup({
      github: { pullRequestForBranch: () => Promise.resolve(38) },
    });

    await expect(mergeProjectPullRequest(deps, input)).resolves.toEqual(WRONG_BRANCH);
    expect(github.mergePullRequest).not.toHaveBeenCalled();
  });

  it('R31: HEAD destacado: GH_PR_NOT_FOUND, sem mesclar e sem procurar PR', async () => {
    const { deps, github } = setup({ git: { status: { branch: null } } });

    await expect(mergeProjectPullRequest(deps, input)).resolves.toEqual(WRONG_BRANCH);
    expect(github.pullRequestForBranch).not.toHaveBeenCalled();
    expect(github.mergePullRequest).not.toHaveBeenCalled();
  });

  it('R31: número igual ao PR da branch: mescla, depois de ler o PR e de achar o da branch', async () => {
    const { deps, github } = setup();

    await expect(mergeProjectPullRequest(deps, input)).resolves.toEqual({
      ok: true,
      data: undefined,
    });
    expect(order(github.originUrl)).toBeLessThan(order(github.pullRequest));
    expect(order(github.pullRequest)).toBeLessThan(order(github.pullRequestForBranch));
    expect(order(github.pullRequestForBranch)).toBeLessThan(order(github.mergePullRequest));
  });

  it('projeto removido: PROJECT_NOT_FOUND, sem chamar o gh', async () => {
    const { deps, github } = setup();
    deps.repo.markRemoved('p1', '2026-11-02T12:00:00.000Z');

    await expect(mergeProjectPullRequest(deps, input)).resolves.toEqual(NOT_FOUND);
    expect(github.pullRequest).not.toHaveBeenCalled();
  });
});
