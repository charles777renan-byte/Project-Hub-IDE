import { realpathSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { GhError, addComment, mergePullRequest } from '../src/index';
import { runGh } from '../src/run-gh';
import {
  createWorkspace,
  failureOf,
  fakeGhEnv,
  readCalls,
  withoutGhOnPath,
  type Workspace,
} from './fake-gh';

// Processo de verdade: o `gh` é o falso (`fixtures/fake-gh.mjs`), um script Node que o adaptador roda pelo
// `process.execPath`. Nenhum teste aqui toca o GitHub, e nenhum comentário nem merge acontece de verdade.

let workspace: Workspace;

beforeEach(() => {
  workspace = createWorkspace();
});

afterEach(() => {
  workspace.remove();
});

const env = (scenario = 'pr-open', extra: NodeJS.ProcessEnv = {}) =>
  fakeGhEnv(workspace, scenario, extra);

describe('addComment', () => {
  it('chama o gh com a forma exata: pr comment <n> --body=<texto>, na pasta do projeto', async () => {
    await addComment(workspace.repo, 12, 'Pode mesclar.', { env: env() });

    const calls = readCalls(workspace);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.argv).toEqual(['pr', 'comment', '12', '--body=Pode mesclar.']);
    expect(realpathSync.native(calls[0]?.cwd ?? '')).toBe(realpathSync.native(workspace.repo));
  });

  it('corpo com quebra de linha, aspas e "-" na frente chega inteiro, num argumento só', async () => {
    const body = '--admin\nsegunda linha com "aspas" e $(isto) e `aquilo` ; & | > <x>';

    await addComment(workspace.repo, 12, body, { env: env() });

    expect(readCalls(workspace)[0]?.argv).toEqual(['pr', 'comment', '12', `--body=${body}`]);
  });

  it('o corpo sai sem espaços nas pontas, como o contrato o normaliza', async () => {
    await addComment(workspace.repo, 12, '  oi  \n', { env: env() });

    expect(readCalls(workspace)[0]?.argv[3]).toBe('--body=oi');
  });

  it.each([
    ['número zero', 0, 'oi'],
    ['número negativo', -1, 'oi'],
    ['número fracionário', 1.5, 'oi'],
    ['número não finito', Number.NaN, 'oi'],
    ['corpo vazio', 12, ''],
    ['corpo só de espaços', 12, ' \n\t '],
    ['corpo com mais de 65 536 caracteres', 12, 'a'.repeat(65_537)],
  ])('%s: VALIDATION_FAILED, sem criar processo', async (_name, number, body) => {
    await expect(addComment(workspace.repo, number, body, { env: env() })).rejects.toMatchObject({
      code: 'VALIDATION_FAILED',
    });
    expect(readCalls(workspace)).toEqual([]);
  });
});

describe('mergePullRequest', () => {
  it.each(['merge', 'squash', 'rebase'] as const)(
    'chama o gh com a forma exata: pr merge <n> --%s',
    async (method) => {
      await mergePullRequest(workspace.repo, 12, method, { env: env() });

      expect(readCalls(workspace).map((call) => call.argv)).toEqual([
        ['pr', 'merge', '12', `--${method}`],
      ]);
    },
  );

  it('forma de mesclar desconhecida (vinda de fora do tipo): VALIDATION_FAILED, sem criar processo', async () => {
    const method = 'squash --admin' as unknown as 'squash';

    await expect(
      mergePullRequest(workspace.repo, 12, method, { env: env() }),
    ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
    expect(readCalls(workspace)).toEqual([]);
  });

  it.each([0, -3, 2.5])('número %s: VALIDATION_FAILED, sem criar processo', async (number) => {
    await expect(
      mergePullRequest(workspace.repo, number, 'merge', { env: env() }),
    ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
    expect(readCalls(workspace)).toEqual([]);
  });
});

describe('ambiente do gh', () => {
  it('o gh recebe as variáveis fixas e não recebe GH_REPO nem GH_HOST herdados', async () => {
    await mergePullRequest(workspace.repo, 12, 'merge', {
      env: env('pr-open', {
        GH_REPO: 'outro/repositorio',
        GH_HOST: 'ghe.example.com',
        CLICOLOR_FORCE: '1',
        GH_FORCE_TTY: '1',
        GH_PROMPT_DISABLED: '0',
      }),
    });

    expect(readCalls(workspace)[0]?.env).toEqual({
      GH_REPO: null,
      GH_HOST: null,
      GH_PROMPT_DISABLED: '1',
      NO_COLOR: '1',
      CLICOLOR: '0',
      GH_NO_UPDATE_NOTIFIER: '1',
      CLICOLOR_FORCE: null,
      GH_FORCE_TTY: null,
    });
  });
});

describe('falhas do gh viram códigos com mensagem em português e sem a saída dele', () => {
  const outcomes = [
    ['unauthenticated', 'GH_NOT_AUTHENTICATED', /gh auth login/u],
    ['network', 'GH_NETWORK_FAILED', /conexão/u],
    ['not-found', 'GH_PR_NOT_FOUND', /não foi encontrado/u],
  ] as const;

  it.each(outcomes)('comentar com o cenário %s: %s', async (scenario, code, message) => {
    const attempt = addComment(workspace.repo, 12, 'oi', { env: env(scenario) });

    await expect(attempt).rejects.toBeInstanceOf(GhError);
    await expect(attempt).rejects.toMatchObject({ code, message: expect.stringMatching(message) });
    await expect(attempt).rejects.toMatchObject({
      stderr: expect.not.stringMatching(/^$/u) as unknown,
    });
  });

  it('merge recusado pelo GitHub: GH_PR_NOT_MERGEABLE, com o stderr só no campo stderr', async () => {
    const attempt = mergePullRequest(workspace.repo, 12, 'squash', { env: env('not-mergeable') });

    await expect(attempt).rejects.toMatchObject({
      code: 'GH_PR_NOT_MERGEABLE',
      exitCode: 1,
      stderr: expect.stringContaining('is not mergeable') as unknown,
    });
    await expect(attempt).rejects.not.toMatchObject({
      message: expect.stringContaining('is not mergeable') as unknown,
    });
  });

  it('a mensagem do sem login não carrega o stderr cru', async () => {
    const error = await failureOf(
      addComment(workspace.repo, 12, 'oi', {
        env: env('unauthenticated'),
      }),
    );

    expect(error.message).not.toContain('To get started');
    expect(error.stderr).toContain('To get started');
    expect(error.exitCode).toBe(4);
  });

  it('falha que o adaptador não reconhece: UNKNOWN com o código de saída, sem o texto do gh', async () => {
    const error = await failureOf(
      mergePullRequest(workspace.repo, 12, 'merge', {
        env: env('unknown-error'),
      }),
    );

    expect(error.code).toBe('UNKNOWN');
    expect(error.message).toBe('O comando "gh pr merge" terminou com erro (código 1).');
    expect(error.message).not.toContain('<script>');
  });

  it('tempo limite: o gh é interrompido e vira GH_NETWORK_FAILED', async () => {
    const started = Date.now();

    await expect(
      mergePullRequest(workspace.repo, 12, 'merge', { env: env('hang'), timeoutMs: 400 }),
    ).rejects.toMatchObject({
      code: 'GH_NETWORK_FAILED',
      message: expect.stringContaining('demorou mais de 0.4 s') as unknown,
    });
    expect(Date.now() - started).toBeLessThan(10_000);
  });

  it('tempo limite de uma escrita manda conferir o PR, para não duplicar um comentário público', async () => {
    const error = await failureOf(
      addComment(workspace.repo, 12, 'oi', { env: env('hang'), timeoutMs: 400 }),
    );

    expect(error.message).toContain('A ação pode ter sido concluída');
    expect(error.message).not.toContain('tente de novo');
  });
});

describe('o gh falso só vale em teste', () => {
  it.each([undefined, '', 'production', 'development', 'TEST'])(
    'com PROJECT_HUB_ENV=%j a variável PROJECT_HUB_GH_BIN é ignorada: vale o gh do PATH',
    async (value) => {
      // Sem `gh` no PATH, o único jeito de o falso rodar seria a variável valer. Ele não roda, e o erro é o
      // de executável ausente.
      const source = fakeGhEnv(workspace, 'pr-open', { PROJECT_HUB_ENV: value });
      const attempt = mergePullRequest(workspace.repo, 12, 'merge', {
        env: withoutGhOnPath(source, workspace.emptyDir),
      });

      await expect(attempt).rejects.toMatchObject({
        code: 'GH_NOT_AVAILABLE',
        message: expect.stringContaining('GitHub CLI não encontrado') as unknown,
      });
      expect(readCalls(workspace)).toEqual([]);
    },
  );

  it('sem gh no PATH e sem o falso: GH_NOT_AVAILABLE com a instrução de instalar', async () => {
    const source = { ...process.env, PROJECT_HUB_ENV: undefined, PROJECT_HUB_GH_BIN: undefined };

    await expect(
      addComment(workspace.repo, 12, 'oi', { env: withoutGhOnPath(source, workspace.emptyDir) }),
    ).rejects.toMatchObject({
      code: 'GH_NOT_AVAILABLE',
      message: expect.stringContaining('cli.github.com'),
    });
  });

  it('pasta do projeto que não existe não é confundida com gh ausente', async () => {
    await expect(
      addComment(join(workspace.repo, 'sumiu'), 12, 'oi', { env: env() }),
    ).rejects.toMatchObject({ code: 'PROJECT_PATH_UNAVAILABLE' });
  });
});

describe('runGh recusa formas fora da lista sem criar processo', () => {
  it.each([
    ['api'],
    ['repo', 'view'],
    ['auth', 'status'],
    ['run', 'list'],
    ['pr', 'create', '--title', 'x'],
    ['pr', 'merge', '12', '--squash', '--admin'],
    ['pr', 'merge', '12', '--squash', '--auto'],
    ['pr', 'merge', '12', '--squash', '--delete-branch'],
    ['pr', 'merge', '--admin'],
    ['pr', 'comment', '12', '--body', 'solto'],
    ['pr', 'comment', '-1', '--body=oi'],
    ['pr', 'view', '1.5', '--json', 'number'],
    ['pr', 'list', '--head', '', '--state', 'all', '--limit', '1', '--json', 'number'],
    ['pr', 'list', '--head', '--web', '--state', 'all', '--limit', '1', '--json', 'number'],
  ])('%s', async (...args) => {
    await expect(runGh(args, { cwd: workspace.repo, env: env() })).rejects.toMatchObject({
      code: 'PERMISSION_DENIED',
    });
    expect(readCalls(workspace)).toEqual([]);
  });
});
