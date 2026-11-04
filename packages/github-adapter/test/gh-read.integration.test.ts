import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { GhError, getPullRequest, getPullRequestForBranch } from '../src/index';
import { PR_VIEW_FIELDS } from '../src/run-gh';
import { createWorkspace, fakeGhEnv, readCalls, type Workspace } from './fake-gh';

// Processo de verdade: o `gh` é o falso (`fixtures/fake-gh.mjs`), que responde com a saída real de
// `gh pr view` guardada em `fixtures/gh-pr-view.json`.

let workspace: Workspace;

beforeEach(() => {
  workspace = createWorkspace();
});

afterEach(() => {
  workspace.remove();
});

const env = (scenario = 'pr-open') => fakeGhEnv(workspace, scenario);
const now = () => new Date('2026-11-03T21:30:00.000Z');

describe('getPullRequestForBranch', () => {
  it('devolve o número do PR da branch, pela forma exata do pr list', async () => {
    const number = await getPullRequestForBranch(workspace.repo, 'feat/painel', {
      allowTestOverrides: true,
      env: env(),
    });

    expect(number).toBe(47);
    expect(readCalls(workspace).map((call) => call.argv)).toEqual([
      [
        'pr',
        'list',
        '--head',
        'feat/painel',
        '--state',
        'all',
        '--limit',
        '30',
        '--json',
        'number,isCrossRepository',
      ],
    ]);
  });

  it('branch sem PR (lista vazia): null', async () => {
    await expect(
      getPullRequestForBranch(workspace.repo, 'feat/painel', {
        allowTestOverrides: true,
        env: env('no-pr'),
      }),
    ).resolves.toBeNull();
  });

  it('"no pull requests found" do gh não é erro: null', async () => {
    await expect(
      getPullRequestForBranch(workspace.repo, 'feat/painel', {
        allowTestOverrides: true,
        env: env('no-pr-error'),
      }),
    ).resolves.toBeNull();
  });

  it('nome de branch inválido (vazio ou com "-" na frente): PERMISSION_DENIED, sem criar processo', async () => {
    for (const branch of ['', '--web', '-R']) {
      await expect(
        getPullRequestForBranch(workspace.repo, branch, { allowTestOverrides: true, env: env() }),
      ).rejects.toMatchObject({ code: 'PERMISSION_DENIED' });
    }
    expect(readCalls(workspace)).toEqual([]);
  });

  it('sem login e sem rede viram os códigos GH_*', async () => {
    await expect(
      getPullRequestForBranch(workspace.repo, 'x', {
        allowTestOverrides: true,
        env: env('unauthenticated'),
      }),
    ).rejects.toMatchObject({ code: 'GH_NOT_AUTHENTICATED' });
    await expect(
      getPullRequestForBranch(workspace.repo, 'x', {
        allowTestOverrides: true,
        env: env('network'),
      }),
    ).rejects.toMatchObject({ code: 'GH_NETWORK_FAILED' });
  });

  it('saída que não é JSON vira UNKNOWN', async () => {
    await expect(
      getPullRequestForBranch(workspace.repo, 'x', {
        allowTestOverrides: true,
        env: env('garbage'),
      }),
    ).rejects.toMatchObject({ code: 'UNKNOWN' });
  });
});

describe('getPullRequest', () => {
  it('lê o PR da fixture real pela forma exata do pr view, com a hora da leitura', async () => {
    const reading = await getPullRequest(workspace.repo, 47, {
      allowTestOverrides: true,
      env: env(),
      now,
    });

    expect(reading.readAt).toBe('2026-11-03T21:30:00.000Z');
    expect(reading.pr).toMatchObject({
      number: 47,
      state: 'MERGED',
      url: 'https://github.com/charles777renan-byte/Project-Hub-IDE/pull/47',
    });
    expect(reading.checks).toHaveLength(7);
    expect(readCalls(workspace).map((call) => call.argv)).toEqual([
      ['pr', 'view', '47', '--json', PR_VIEW_FIELDS],
    ]);
  });

  it('sem `now`, a hora da leitura é a de agora, em ISO 8601', async () => {
    const before = Date.now();
    const { readAt } = await getPullRequest(workspace.repo, 47, {
      allowTestOverrides: true,
      env: env(),
    });

    expect(new Date(readAt).toISOString()).toBe(readAt);
    expect(Date.parse(readAt)).toBeGreaterThanOrEqual(before);
  });

  it('valores que o contrato não conhece são normalizados, e a leitura sai valendo', async () => {
    const { pr, checks } = await getPullRequest(workspace.repo, 47, {
      allowTestOverrides: true,
      env: env('unknown-enums'),
      now,
    });

    expect(pr).toMatchObject({
      state: 'CLOSED',
      mergeable: 'UNKNOWN',
      mergeStateStatus: 'UNKNOWN',
      reviewDecision: null,
    });
    expect(checks[0]).toMatchObject({ status: 'PENDING' });
    expect(checks[1]).toMatchObject({ conclusion: 'ACTION_REQUIRED' });
  });

  it.each(['foreign-host', 'lookalike-host'])(
    'URL de outro host (%s): GH_NOT_AVAILABLE com mensagem de repositório não suportado',
    async (scenario) => {
      const attempt = getPullRequest(workspace.repo, 47, {
        allowTestOverrides: true,
        env: env(scenario),
        now,
      });

      await expect(attempt).rejects.toBeInstanceOf(GhError);
      await expect(attempt).rejects.toMatchObject({
        code: 'GH_NOT_AVAILABLE',
        message: 'Este repositório não é do github.com, e o Project Hub só lê PRs de lá.',
      });
    },
  );

  it('PR que não existe: GH_PR_NOT_FOUND', async () => {
    await expect(
      getPullRequest(workspace.repo, 999_999, {
        allowTestOverrides: true,
        env: env('not-found'),
        now,
      }),
    ).rejects.toMatchObject({ code: 'GH_PR_NOT_FOUND' });
  });

  it('número inválido: VALIDATION_FAILED, sem criar processo', async () => {
    for (const number of [0, -1, 1.5, Number.NaN]) {
      await expect(
        getPullRequest(workspace.repo, number, { allowTestOverrides: true, env: env() }),
      ).rejects.toMatchObject({
        code: 'VALIDATION_FAILED',
      });
    }
    expect(readCalls(workspace)).toEqual([]);
  });

  it('saída que não é JSON vira UNKNOWN, e o tempo limite vira GH_NETWORK_FAILED', async () => {
    await expect(
      getPullRequest(workspace.repo, 47, { allowTestOverrides: true, env: env('garbage'), now }),
    ).rejects.toMatchObject({ code: 'UNKNOWN' });
    await expect(
      getPullRequest(workspace.repo, 47, {
        allowTestOverrides: true,
        env: env('hang'),
        now,
        timeoutMs: 400,
      }),
    ).rejects.toMatchObject({ code: 'GH_NETWORK_FAILED' });
  });
});
