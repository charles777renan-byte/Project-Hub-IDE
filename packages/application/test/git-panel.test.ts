import type { NewProject } from '@project-hub/domain';
import { describe, expect, it } from 'vitest';
import {
  commitChanges,
  discardPaths,
  fetchProject,
  getFileDiff,
  getGitStatus,
  getProjectBranchChanges,
  getProjectBranchLog,
  publishProjectBranch,
  pullProject,
  pushProjectBranch,
  stagePaths,
  unstagePaths,
  type GitPanelDeps,
} from '../src';
import { fakeFileSystem, fakeGitPanel, fakeRepository, type FakeGitPanelOptions } from './fakes';

const PATH = 'C:\\Projetos\\app';
const DETACHED =
  'Esta branch não tem nome (HEAD destacado): crie uma branch no terminal para enviar';

/** Erro como o `GitError` da porta real: traz `code`. A aplicação não importa o adaptador. */
class FakeGitError extends Error {
  readonly code = 'GIT_NOT_FAST_FORWARD';
}

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
  options: FakeGitPanelOptions & {
    seed?: NewProject[];
    directories?: string[];
    outside?: string[];
  } = {},
) {
  const { seed = [project()], directories = [PATH], outside = [], ...panel } = options;
  const repo = fakeRepository();
  for (const seeded of seed) repo.insert(seeded);
  const git = fakeGitPanel(panel);
  const deps: GitPanelDeps = {
    repo,
    git,
    fs: fakeFileSystem(directories, { caseInsensitive: true, outside }),
  };
  return { deps, git };
}

function fail(code: string, message: string) {
  return { ok: false, error: { code, message, retryable: false } };
}

const NOT_FOUND = fail('PROJECT_NOT_FOUND', 'O projeto não foi encontrado.');
const NOT_GIT = fail('VALIDATION_FAILED', 'Esta pasta não é um repositório Git.');
const UNAVAILABLE = fail('PROJECT_PATH_UNAVAILABLE', 'A pasta do projeto não está disponível.');
const OUTSIDE = fail('VALIDATION_FAILED', 'Caminho fora da pasta do projeto.');
const DETACHED_FAILURE = fail('GIT_DETACHED_HEAD', DETACHED);
const NO_UPSTREAM = fail(
  'VALIDATION_FAILED',
  'Esta branch ainda não tem upstream: use Publicar branch.',
);
const HAS_UPSTREAM = fail('VALIDATION_FAILED', 'Esta branch já tem upstream: use Enviar.');

/** Todos os casos de uso, chamados com o projeto `p1` e entradas válidas, para as checagens comuns. */
const ALL_USE_CASES: [string, (deps: GitPanelDeps) => Promise<unknown>][] = [
  ['getGitStatus', (d) => getGitStatus(d, { projectId: 'p1' })],
  ['getFileDiff', (d) => getFileDiff(d, { projectId: 'p1', path: 'a.ts' })],
  ['stagePaths', (d) => stagePaths(d, { projectId: 'p1', paths: ['a.ts'] })],
  ['unstagePaths', (d) => unstagePaths(d, { projectId: 'p1', paths: ['a.ts'] })],
  ['discardPaths', (d) => discardPaths(d, { projectId: 'p1', paths: ['a.ts'] })],
  ['commitChanges', (d) => commitChanges(d, { projectId: 'p1', message: 'msg' })],
  ['pushProjectBranch', (d) => pushProjectBranch(d, { projectId: 'p1' })],
  ['publishProjectBranch', (d) => publishProjectBranch(d, { projectId: 'p1' })],
  ['pullProject', (d) => pullProject(d, { projectId: 'p1' })],
  ['fetchProject', (d) => fetchProject(d, { projectId: 'p1' })],
  ['getProjectBranchLog', (d) => getProjectBranchLog(d, { projectId: 'p1' })],
  ['getProjectBranchChanges', (d) => getProjectBranchChanges(d, { projectId: 'p1' })],
];

describe.each(ALL_USE_CASES)('%s: elegibilidade do projeto', (_name, run) => {
  it('projeto inexistente: PROJECT_NOT_FOUND, sem chamar a porta', async () => {
    const { deps, git } = setup({ seed: [] });

    await expect(run(deps)).resolves.toEqual(NOT_FOUND);
    expect(git.calls).toEqual([]);
  });

  it('projeto removido: PROJECT_NOT_FOUND', async () => {
    const { deps, git } = setup();
    deps.repo.markRemoved('p1', '2026-11-02T12:00:00.000Z');

    await expect(run(deps)).resolves.toEqual(NOT_FOUND);
    expect(git.calls).toEqual([]);
  });

  it('projeto sem Git: VALIDATION_FAILED', async () => {
    const { deps, git } = setup({ seed: [project({ repositoryKind: 'none' })] });

    await expect(run(deps)).resolves.toEqual(NOT_GIT);
    expect(git.calls).toEqual([]);
  });

  it('pasta indisponível: PROJECT_PATH_UNAVAILABLE', async () => {
    const { deps, git } = setup({ directories: [] });

    await expect(run(deps)).resolves.toEqual(UNAVAILABLE);
    expect(git.calls).toEqual([]);
  });
});

describe('getGitStatus', () => {
  it('devolve o estado lido pela porta, com a pasta do projeto', async () => {
    const { deps, git } = setup({ status: { branch: 'feat/y', ahead: 2 } });

    const result = await getGitStatus(deps, { projectId: 'p1' });

    expect(result).toMatchObject({ ok: true, data: { branch: 'feat/y', ahead: 2 } });
    expect(git.calls).toEqual([{ method: 'status', args: [PATH] }]);
  });

  it('propaga o erro da porta, sem capturar', async () => {
    const error = new FakeGitError('o Git falhou');
    const { deps } = setup({ errors: { status: error } });

    await expect(getGitStatus(deps, { projectId: 'p1' })).rejects.toBe(error);
  });
});

describe('getFileDiff', () => {
  it('confere o caminho e devolve o diff da porta', async () => {
    const { deps, git } = setup();

    const result = await getFileDiff(deps, { projectId: 'p1', path: 'src/a.ts' });

    expect(result).toMatchObject({ ok: true, data: { path: 'src/a.ts', binary: false } });
    expect(git.calls).toEqual([{ method: 'fileDiff', args: [PATH, 'src/a.ts'] }]);
  });

  it('caminho fora da pasta: recusa e não chama a porta', async () => {
    const { deps, git } = setup({ outside: ['link/segredo.txt'] });

    await expect(
      getFileDiff(deps, { projectId: 'p1', path: 'link/segredo.txt' }),
    ).resolves.toEqual(OUTSIDE);
    expect(git.calls).toEqual([]);
  });

  it('sem base para comparar: VALIDATION_FAILED, e não um diff vazio', async () => {
    const { deps } = setup({ fileDiff: null });

    await expect(getFileDiff(deps, { projectId: 'p1', path: 'a.ts' })).resolves.toEqual(
      fail('VALIDATION_FAILED', 'Não há base para comparar: a referência origin/main não existe.'),
    );
  });

  it('propaga o erro da porta', async () => {
    const error = new FakeGitError('o Git falhou');
    const { deps } = setup({ errors: { fileDiff: error } });

    await expect(getFileDiff(deps, { projectId: 'p1', path: 'a.ts' })).rejects.toBe(error);
  });
});

describe.each([
  ['stagePaths', stagePaths, 'stage'],
  ['unstagePaths', unstagePaths, 'unstage'],
  ['discardPaths', discardPaths, 'discard'],
] as const)('%s', (_name, run, method) => {
  it('chama a porta com a pasta do projeto e os caminhos', async () => {
    const { deps, git } = setup();

    await expect(run(deps, { projectId: 'p1', paths: ['a.ts', 'src/b.ts'] })).resolves.toEqual({
      ok: true,
      data: undefined,
    });
    expect(git.calls).toEqual([{ method, args: [PATH, ['a.ts', 'src/b.ts']] }]);
  });

  it('lista vazia: VALIDATION_FAILED antes da porta', async () => {
    const { deps, git } = setup();

    await expect(run(deps, { projectId: 'p1', paths: [] })).resolves.toEqual(
      fail('VALIDATION_FAILED', 'Escolha ao menos um arquivo.'),
    );
    expect(git.calls).toEqual([]);
  });

  it('um caminho fora da pasta recusa a lista inteira, sem chamar a porta', async () => {
    const { deps, git } = setup({ outside: ['link/x'] });

    await expect(run(deps, { projectId: 'p1', paths: ['a.ts', 'link/x'] })).resolves.toEqual(
      OUTSIDE,
    );
    expect(git.calls).toEqual([]);
  });

  it('propaga o erro da porta', async () => {
    const error = new FakeGitError('o Git falhou');
    const { deps } = setup({ errors: { [method]: error } });

    await expect(run(deps, { projectId: 'p1', paths: ['a.ts'] })).rejects.toBe(error);
  });
});

describe('commitChanges', () => {
  it('chama a porta com a mensagem e devolve o commit criado', async () => {
    const { deps, git } = setup();

    const result = await commitChanges(deps, { projectId: 'p1', message: 'feat: tudo' });

    expect(result).toEqual({ ok: true, data: { commit: 'a'.repeat(40) } });
    expect(git.calls).toEqual([{ method: 'commit', args: [PATH, 'feat: tudo'] }]);
  });

  it('propaga o erro da porta', async () => {
    const error = new FakeGitError('o Git falhou');
    const { deps } = setup({ errors: { commit: error } });

    await expect(commitChanges(deps, { projectId: 'p1', message: 'x' })).rejects.toBe(error);
  });
});

describe('pushProjectBranch', () => {
  it('com upstream: chama a porta de envio', async () => {
    const { deps, git } = setup();

    const result = await pushProjectBranch(deps, { projectId: 'p1' });

    expect(result).toEqual({ ok: true, data: { branch: 'feat/x' } });
    expect(git.calls).toEqual([
      { method: 'status', args: [PATH] },
      { method: 'push', args: [PATH] },
    ]);
  });

  it('sem upstream: VALIDATION_FAILED e não envia', async () => {
    const { deps, git } = setup({ status: { upstream: null } });

    await expect(pushProjectBranch(deps, { projectId: 'p1' })).resolves.toEqual(NO_UPSTREAM);
    expect(git.calls.map((call) => call.method)).toEqual(['status']);
  });

  it('HEAD destacado: GIT_DETACHED_HEAD, conferido antes do upstream', async () => {
    const { deps, git } = setup({ status: { branch: null, upstream: null } });

    await expect(pushProjectBranch(deps, { projectId: 'p1' })).resolves.toEqual(DETACHED_FAILURE);
    expect(git.calls.map((call) => call.method)).toEqual(['status']);
  });

  it('propaga o erro da porta de envio', async () => {
    const error = new FakeGitError('o remoto avançou');
    const { deps } = setup({ errors: { push: error } });

    await expect(pushProjectBranch(deps, { projectId: 'p1' })).rejects.toBe(error);
  });
});

describe('publishProjectBranch', () => {
  it('sem upstream: chama a mesma porta de envio', async () => {
    const { deps, git } = setup({ status: { upstream: null } });

    const result = await publishProjectBranch(deps, { projectId: 'p1' });

    expect(result).toEqual({ ok: true, data: { branch: 'feat/x' } });
    expect(git.calls).toEqual([
      { method: 'status', args: [PATH] },
      { method: 'push', args: [PATH] },
    ]);
  });

  it('com upstream: VALIDATION_FAILED e não envia', async () => {
    const { deps, git } = setup();

    await expect(publishProjectBranch(deps, { projectId: 'p1' })).resolves.toEqual(HAS_UPSTREAM);
    expect(git.calls.map((call) => call.method)).toEqual(['status']);
  });

  it('HEAD destacado: GIT_DETACHED_HEAD', async () => {
    const { deps, git } = setup({ status: { branch: null, upstream: null } });

    await expect(publishProjectBranch(deps, { projectId: 'p1' })).resolves.toEqual(
      DETACHED_FAILURE,
    );
    expect(git.calls.map((call) => call.method)).toEqual(['status']);
  });

  it('propaga o erro da porta de envio', async () => {
    const error = new FakeGitError('o Git falhou');
    const { deps } = setup({ status: { upstream: null }, errors: { push: error } });

    await expect(publishProjectBranch(deps, { projectId: 'p1' })).rejects.toBe(error);
  });
});

describe('pullProject', () => {
  it('chama a porta e devolve se a branch avançou', async () => {
    const { deps, git } = setup();

    await expect(pullProject(deps, { projectId: 'p1' })).resolves.toEqual({
      ok: true,
      data: { updated: true },
    });
    expect(git.calls).toEqual([
      { method: 'status', args: [PATH] },
      { method: 'pull', args: [PATH] },
    ]);
  });

  it('HEAD destacado: GIT_DETACHED_HEAD, sem chamar a porta de pull', async () => {
    const { deps, git } = setup({ status: { branch: null } });

    await expect(pullProject(deps, { projectId: 'p1' })).resolves.toEqual(DETACHED_FAILURE);
    expect(git.calls.map((call) => call.method)).toEqual(['status']);
  });

  it('propaga o erro da porta', async () => {
    const error = new FakeGitError('a branch divergiu');
    const { deps } = setup({ errors: { pull: error } });

    await expect(pullProject(deps, { projectId: 'p1' })).rejects.toBe(error);
  });
});

describe('fetchProject', () => {
  it('chama a porta de fetch', async () => {
    const { deps, git } = setup();

    await expect(fetchProject(deps, { projectId: 'p1' })).resolves.toEqual({
      ok: true,
      data: undefined,
    });
    expect(git.calls).toEqual([
      { method: 'status', args: [PATH] },
      { method: 'fetch', args: [PATH] },
    ]);
  });

  it('HEAD destacado: GIT_DETACHED_HEAD, sem chamar a porta de fetch', async () => {
    const { deps, git } = setup({ status: { branch: null } });

    await expect(fetchProject(deps, { projectId: 'p1' })).resolves.toEqual(DETACHED_FAILURE);
    expect(git.calls.map((call) => call.method)).toEqual(['status']);
  });

  it('propaga o erro da porta', async () => {
    const error = new FakeGitError('sem rede');
    const { deps } = setup({ errors: { fetch: error } });

    await expect(fetchProject(deps, { projectId: 'p1' })).rejects.toBe(error);
  });
});

describe('getProjectBranchLog', () => {
  it('pede 50 commits à porta', async () => {
    const entry = {
      sha: 'c'.repeat(40),
      shortSha: 'ccccccc',
      author: 'Ana',
      date: '2026-11-02T18:51:40-03:00',
      refs: ['HEAD -> main'],
      subject: 'feat: x',
    };
    const { deps, git } = setup({ log: [entry] });

    await expect(getProjectBranchLog(deps, { projectId: 'p1' })).resolves.toEqual({
      ok: true,
      data: [entry],
    });
    expect(git.calls).toEqual([{ method: 'log', args: [PATH, 50] }]);
  });

  it('propaga o erro da porta', async () => {
    const error = new FakeGitError('o Git falhou');
    const { deps } = setup({ errors: { log: error } });

    await expect(getProjectBranchLog(deps, { projectId: 'p1' })).rejects.toBe(error);
  });
});

describe('getProjectBranchChanges', () => {
  it('devolve as alterações da branch contra a base', async () => {
    const changes = {
      baseRef: 'origin/main',
      mergeBase: 'd'.repeat(40),
      files: [{ path: 'a.ts', status: 'M' as const, added: 3, removed: 1 }],
    };
    const { deps, git } = setup({ branchChanges: changes });

    await expect(getProjectBranchChanges(deps, { projectId: 'p1' })).resolves.toEqual({
      ok: true,
      data: changes,
    });
    expect(git.calls).toEqual([{ method: 'branchChanges', args: [PATH] }]);
  });

  it('propaga o erro da porta', async () => {
    const error = new FakeGitError('o Git falhou');
    const { deps } = setup({ errors: { branchChanges: error } });

    await expect(getProjectBranchChanges(deps, { projectId: 'p1' })).rejects.toBe(error);
  });
});
