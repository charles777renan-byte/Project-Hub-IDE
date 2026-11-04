import { describe, expect, it } from 'vitest';
import {
  GH_NETWORK_FAILED_MESSAGE,
  GH_NOT_AUTHENTICATED_MESSAGE,
  PR_VIEW_FIELDS,
  classifyGhFailure,
  ghEnvironment,
  isAllowedGhCommand,
  resolveGhCommand,
} from '../src/run-gh';

// Unitário: nada aqui cria processo. A lista de permissão, a escolha do executável, o ambiente e a leitura do
// `stderr` são funções puras. Com processo de verdade (o `gh` falso) estão os testes de integração.

const LIST = [
  'pr',
  'list',
  '--head',
  'feat/x',
  '--state',
  'all',
  '--limit',
  '1',
  '--json',
  'number',
];
const VIEW = ['pr', 'view', '12', '--json', PR_VIEW_FIELDS];

describe('lista de permissão: formas permitidas', () => {
  it('pr list --head <branch> --state all --limit 1 --json number', () => {
    expect(isAllowedGhCommand(LIST)).toBe(true);
  });

  it('pr view <n> --json <campos fixos>', () => {
    expect(isAllowedGhCommand(VIEW)).toBe(true);
  });

  it('pr comment <n> --body=<texto>', () => {
    expect(isAllowedGhCommand(['pr', 'comment', '12', '--body=Pode mesclar.'])).toBe(true);
  });

  it.each(['--merge', '--squash', '--rebase'])('pr merge <n> %s', (flag) => {
    expect(isAllowedGhCommand(['pr', 'merge', '12', flag])).toBe(true);
  });

  it('o corpo do comentário aceita quebra de linha, aspas e "-" na frente, sempre no mesmo argumento', () => {
    for (const body of [
      'linha 1\nlinha 2',
      '--admin',
      '-x "y" $(z) `w` ; &',
      '  recuo',
      '<img src=x>',
    ]) {
      expect(isAllowedGhCommand(['pr', 'comment', '12', `--body=${body}`])).toBe(true);
    }
  });
});

describe('lista de permissão: formas proibidas', () => {
  it.each([
    ['api', ['api', 'repos/o/r']],
    ['repo', ['repo', 'view']],
    ['auth', ['auth', 'status']],
    ['run', ['run', 'list']],
    ['pr create', ['pr', 'create', '--title', 'x']],
    ['pr close', ['pr', 'close', '12']],
    ['pr review', ['pr', 'review', '12', '--approve']],
    ['pr checkout', ['pr', 'checkout', '12']],
    ['pr (sem subcomando)', ['pr']],
    ['sem argumentos', []],
    ['opção antes do subcomando (-R)', ['-R', 'o/r', ...VIEW]],
    ['opção antes do subcomando (--repo)', ['--repo', 'o/r', ...VIEW]],
    ['pr merge --admin', ['pr', 'merge', '12', '--squash', '--admin']],
    ['pr merge --auto', ['pr', 'merge', '12', '--squash', '--auto']],
    ['pr merge --delete-branch', ['pr', 'merge', '12', '--squash', '--delete-branch']],
    ['pr merge --admin sozinho', ['pr', 'merge', '12', '--admin']],
    ['pr merge sem a forma', ['pr', 'merge', '12']],
    ['pr merge com a forma colada', ['pr', 'merge', '12', '--squash --admin']],
    ['pr merge com duas formas', ['pr', 'merge', '12', '--squash', '--merge']],
    ['pr merge com a forma solta de outro jeito', ['pr', 'merge', '12', 'squash']],
  ])('recusa %s', (_name, args) => {
    expect(isAllowedGhCommand(args)).toBe(false);
  });

  it.each([
    '-1',
    '0',
    '1.5',
    '1e3',
    '01',
    '+1',
    ' 1',
    '1 ',
    'abc',
    '',
    '12345678901',
    '12;ls',
    '--json',
  ])('recusa o número de PR %j em view, comment e merge', (n) => {
    expect(isAllowedGhCommand(['pr', 'view', n, '--json', PR_VIEW_FIELDS])).toBe(false);
    expect(isAllowedGhCommand(['pr', 'comment', n, '--body=oi'])).toBe(false);
    expect(isAllowedGhCommand(['pr', 'merge', n, '--merge'])).toBe(false);
  });

  it('pr list: --head vazio, com "-" na frente, com quebra de linha ou ausente', () => {
    const withHead = (head: string) => ['pr', 'list', '--head', head, ...LIST.slice(4)];
    expect(isAllowedGhCommand(withHead(''))).toBe(false);
    expect(isAllowedGhCommand(withHead('--web'))).toBe(false);
    expect(isAllowedGhCommand(withHead('-R'))).toBe(false);
    expect(isAllowedGhCommand(withHead('a\nb'))).toBe(false);
    expect(isAllowedGhCommand(['pr', 'list', ...LIST.slice(4)])).toBe(false);
  });

  it('pr list: outros --state, --limit e --json, ou argumento a mais', () => {
    const base = [...LIST];
    expect(isAllowedGhCommand(base.map((a) => (a === 'all' ? 'open' : a)))).toBe(false);
    expect(isAllowedGhCommand(base.map((a) => (a === '1' ? '100' : a)))).toBe(false);
    expect(isAllowedGhCommand(base.map((a) => (a === 'number' ? 'number,title' : a)))).toBe(false);
    expect(isAllowedGhCommand([...base, '--web'])).toBe(false);
  });

  it('pr view: outros campos, campos a menos, ou argumento a mais', () => {
    expect(isAllowedGhCommand(['pr', 'view', '12', '--json', 'number'])).toBe(false);
    expect(isAllowedGhCommand(['pr', 'view', '12', '--json', `${PR_VIEW_FIELDS},body`])).toBe(
      false,
    );
    expect(isAllowedGhCommand([...VIEW, '--web'])).toBe(false);
    expect(isAllowedGhCommand(['pr', 'view', '12'])).toBe(false);
  });

  it('pr comment: corpo como argumento solto, vazio, só de espaços ou com argumentos a mais', () => {
    expect(isAllowedGhCommand(['pr', 'comment', '12', '--body', 'oi'])).toBe(false);
    expect(isAllowedGhCommand(['pr', 'comment', '12', 'oi'])).toBe(false);
    expect(isAllowedGhCommand(['pr', 'comment', '12', '-b', 'oi'])).toBe(false);
    expect(isAllowedGhCommand(['pr', 'comment', '12', '--body-file=x'])).toBe(false);
    expect(isAllowedGhCommand(['pr', 'comment', '12', '--body='])).toBe(false);
    expect(isAllowedGhCommand(['pr', 'comment', '12', '--body= \n\t '])).toBe(false);
    expect(isAllowedGhCommand(['pr', 'comment', '12', '--body=oi', '--edit-last'])).toBe(false);
    expect(isAllowedGhCommand(['pr', 'comment', '12', '--body=oi', '--web'])).toBe(false);
    expect(isAllowedGhCommand(['pr', 'comment', '12'])).toBe(false);
  });
});

describe('executável do gh (resolveGhCommand)', () => {
  const script = '/pasta/fake-gh.mjs';

  it('com PROJECT_HUB_ENV=test e PROJECT_HUB_GH_BIN, roda o script pelo execPath', () => {
    expect(
      resolveGhCommand({ PROJECT_HUB_ENV: 'test', PROJECT_HUB_GH_BIN: script }, true, '/bin/node'),
    ).toEqual({
      command: '/bin/node',
      commandPrefix: [script],
      extraEnv: { ELECTRON_RUN_AS_NODE: '1' },
    });
  });

  it('sem PROJECT_HUB_ENV, ou com outro valor, a variável é ignorada e vale o gh do PATH', () => {
    for (const value of [undefined, '', 'production', 'development', 'TEST', 'true']) {
      expect(
        resolveGhCommand({ PROJECT_HUB_ENV: value, PROJECT_HUB_GH_BIN: script }, true, '/bin/node'),
      ).toEqual({ command: 'gh', commandPrefix: [], extraEnv: {} });
    }
  });

  it('sem allowTestOverrides (aplicativo empacotado), PROJECT_HUB_GH_BIN é ignorada mesmo com PROJECT_HUB_ENV=test', () => {
    expect(
      resolveGhCommand({ PROJECT_HUB_ENV: 'test', PROJECT_HUB_GH_BIN: script }, false, '/bin/node'),
    ).toEqual({ command: 'gh', commandPrefix: [], extraEnv: {} });
  });

  it('com allowTestOverrides, mas sem PROJECT_HUB_ENV=test, a variável também é ignorada', () => {
    expect(resolveGhCommand({ PROJECT_HUB_GH_BIN: script }, true, '/bin/node')).toEqual({
      command: 'gh',
      commandPrefix: [],
      extraEnv: {},
    });
  });

  it('com PROJECT_HUB_ENV=test e sem a variável (ou vazia), vale o gh do PATH', () => {
    for (const bin of [undefined, '']) {
      expect(resolveGhCommand({ PROJECT_HUB_ENV: 'test', PROJECT_HUB_GH_BIN: bin }, true)).toEqual({
        command: 'gh',
        commandPrefix: [],
        extraEnv: {},
      });
    }
  });
});

describe('ambiente do gh (ghEnvironment)', () => {
  it('liga as quatro variáveis fixas, mesmo contra o valor herdado', () => {
    const env = ghEnvironment({
      GH_PROMPT_DISABLED: '0',
      NO_COLOR: '',
      CLICOLOR: '1',
      GH_NO_UPDATE_NOTIFIER: '',
    });

    expect(env).toMatchObject({
      GH_PROMPT_DISABLED: '1',
      NO_COLOR: '1',
      CLICOLOR: '0',
      GH_NO_UPDATE_NOTIFIER: '1',
    });
  });

  it('remove GH_REPO e GH_HOST herdados (também com outra caixa), e mantém o resto', () => {
    const env = ghEnvironment({
      GH_REPO: 'outro/repo',
      GH_HOST: 'ghe.example.com',
      gh_repo: 'outro/repo',
      CLICOLOR_FORCE: '1',
      GH_FORCE_TTY: '1',
      GH_TOKEN: 'segredo',
      GH_CONFIG_DIR: '/cfg',
      PATH: '/bin',
    });

    expect(env['GH_REPO']).toBeUndefined();
    expect(env['GH_HOST']).toBeUndefined();
    expect(env['gh_repo']).toBeUndefined();
    expect(env['CLICOLOR_FORCE']).toBeUndefined();
    expect(env['GH_FORCE_TTY']).toBeUndefined();
    expect(env).toMatchObject({ GH_TOKEN: 'segredo', GH_CONFIG_DIR: '/cfg', PATH: '/bin' });
  });

  it('remove GIT_DIR, GIT_WORK_TREE, GIT_COMMON_DIR e GIT_INDEX_FILE herdadas, com qualquer caixa', () => {
    const env = ghEnvironment({
      GIT_DIR: '/outro/.git',
      git_dir: '/outro/.git',
      GIT_WORK_TREE: '/outro',
      Git_Common_Dir: '/outro/.git',
      GIT_INDEX_FILE: '/outro/.git/index',
      PATH: '/bin',
    });

    expect(env['GIT_DIR']).toBeUndefined();
    expect(env['git_dir']).toBeUndefined();
    expect(env['GIT_WORK_TREE']).toBeUndefined();
    expect(env['Git_Common_Dir']).toBeUndefined();
    expect(env['GIT_INDEX_FILE']).toBeUndefined();
    expect(Object.keys(env).filter((name) => name.toUpperCase().startsWith('GIT_'))).toEqual([]);
    expect(env['PATH']).toBe('/bin');
  });

  it('as variáveis GIT_* que vêm das extras também caem', () => {
    const env = ghEnvironment({}, { GIT_DIR: '/outro/.git' });

    expect(env['GIT_DIR']).toBeUndefined();
  });

  it('as variáveis extras (do gh falso) entram, mas GH_REPO delas também cai', () => {
    const env = ghEnvironment({}, { ELECTRON_RUN_AS_NODE: '1', GH_REPO: 'x/y' });

    expect(env['ELECTRON_RUN_AS_NODE']).toBe('1');
    expect(env['GH_REPO']).toBeUndefined();
  });

  it('não altera o objeto de origem', () => {
    const source = { GH_REPO: 'a/b' };
    ghEnvironment(source);
    expect(source).toEqual({ GH_REPO: 'a/b' });
  });
});

describe('leitura do stderr do gh (classifyGhFailure)', () => {
  const list = LIST;
  const merge = ['pr', 'merge', '12', '--squash'];

  // Texto copiado do `gh` 2.92 real, com GH_CONFIG_DIR apontando para uma pasta vazia (código de saída 4).
  const UNAUTHENTICATED =
    'To get started with GitHub CLI, please run:  gh auth login\nAlternatively, populate the GH_TOKEN environment variable with a GitHub API authentication token.';
  // Texto copiado do `gh` 2.92 real, com HTTPS_PROXY apontando para uma porta fechada (código de saída 1).
  const NETWORK =
    'Post "https://api.github.com/graphql": proxyconnect tcp: dial tcp 127.0.0.1:1: connectex: No connection could be made because the target machine actively refused it.';
  // Texto copiado do `gh` 2.92 real, com `pr view 999999` (código de saída 1).
  const NOT_FOUND =
    'GraphQL: Could not resolve to a PullRequest with the number of 999999. (repository.pullRequest)';

  it('sem login: o texto real do gh vira GH_NOT_AUTHENTICATED', () => {
    expect(classifyGhFailure(list, UNAUTHENTICATED)).toBe('GH_NOT_AUTHENTICATED');
  });

  it.each([
    'You are not logged into any GitHub hosts. To log in, run: gh auth login',
    'HTTP 401: Bad credentials (https://api.github.com/graphql)',
    'authentication required',
  ])('outras formas de falta de login: %s', (stderr) => {
    expect(classifyGhFailure(list, stderr)).toBe('GH_NOT_AUTHENTICATED');
  });

  it('sem rede: o texto real do gh vira GH_NETWORK_FAILED', () => {
    expect(classifyGhFailure(list, NETWORK)).toBe('GH_NETWORK_FAILED');
  });

  it.each([
    'Get "https://api.github.com/repos": dial tcp: lookup api.github.com: no such host',
    'Post "https://api.github.com/graphql": context deadline exceeded (Client.Timeout exceeded)',
    'error connecting to api.github.com\ncheck your internet connection or https://githubstatus.com',
    'HTTP 502: Bad Gateway',
  ])('outras formas de falha de rede: %s', (stderr) => {
    expect(classifyGhFailure(list, stderr)).toBe('GH_NETWORK_FAILED');
  });

  it('PR inexistente: o texto real do gh vira GH_PR_NOT_FOUND, em qualquer comando', () => {
    expect(classifyGhFailure(['pr', 'view', '999999'], NOT_FOUND)).toBe('GH_PR_NOT_FOUND');
    expect(classifyGhFailure(merge, NOT_FOUND)).toBe('GH_PR_NOT_FOUND');
  });

  it.each([
    'X Pull request #12 is not mergeable: the merge commit cannot be cleanly created.',
    'GraphQL: Pull Request is not mergeable (mergePullRequest)',
    'GraphQL: Base branch policy prohibits the merge. (mergePullRequest)',
    'X Pull request #12 is already merged',
    'X Pull request #12 is closed',
    'Pull request #12 is a draft',
    'X Pull request #12 is still a draft',
    // Textos conhecidos do gh e do GitHub, NÃO capturados do gh real (isso exigiria um merge de verdade).
  ])('merge recusado: %s', (stderr) => {
    expect(classifyGhFailure(merge, stderr)).toBe('GH_PR_NOT_MERGEABLE');
  });

  it('GH_PR_NOT_MERGEABLE só vale no merge: no comentário o mesmo texto não é reconhecido', () => {
    expect(
      classifyGhFailure(['pr', 'comment', '12', '--body=oi'], 'is not mergeable'),
    ).toBeUndefined();
  });

  it('texto desconhecido não é reconhecido', () => {
    expect(classifyGhFailure(list, 'algo inesperado')).toBeUndefined();
    expect(classifyGhFailure(list, '')).toBeUndefined();
  });

  it('as mensagens dos códigos são em português e não carregam a saída do gh', () => {
    expect(GH_NOT_AUTHENTICATED_MESSAGE).toContain('gh auth login');
    expect(GH_NETWORK_FAILED_MESSAGE).not.toMatch(/dial tcp|proxyconnect/u);
  });
});
