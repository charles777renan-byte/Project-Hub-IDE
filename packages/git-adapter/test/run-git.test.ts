import { execFile } from 'node:child_process';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GitError, LOG_FORMAT, runApproved, runGit } from '../src/run-git';

// Unitário: o `execFile` é imitado, então nenhum processo é criado aqui. Os testes com o Git de
// verdade ficam nos arquivos *.integration.test.ts.
vi.mock('node:child_process', () => ({ execFile: vi.fn() }));

type Callback = (error: Error | null, stdout: string, stderr: string) => void;

const execFileMock = vi.mocked(execFile);
// Uma pasta que existe, para os erros ENOENT não serem confundidos com pasta de trabalho ausente.
const cwd = import.meta.dirname;
// Vai antes do subcomando em toda chamada: o `core.fsmonitor` de um repositório não confiável executa
// um comando no `git status`.
const FSMONITOR_OFF = ['-c', 'core.fsmonitor=false'];
// O nome inteiro de um commit (SHA-1 e SHA-256): o que o `merge-base` devolve.
const SHA = '0123456789abcdef0123456789abcdef01234567';
const SHA256 = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
// As opções que o `diff` com `--patch` leva contra a base: sem diff externo nem filtro de texto.
const PATCH_OPTIONS = ['--patch', '--no-renames', '--no-ext-diff', '--no-textconv', '--no-color'];

/** Faz o `execFile` imitado terminar logo, com o erro e as saídas dadas. */
function respondWith(error: Error | null, stdout = '', stderr = ''): void {
  execFileMock.mockImplementation(((
    _file: string,
    _args: string[],
    _options: object,
    done: Callback,
  ) => {
    done(error, stdout, stderr);
  }) as unknown as typeof execFile);
}

/** Argumentos da única chamada ao `execFile`. */
function call(): { file: string; args: string[]; options: Record<string, unknown> } {
  expect(execFileMock).toHaveBeenCalledTimes(1);
  const [file, args, options] = execFileMock.mock.calls[0] as unknown as [
    string,
    string[],
    Record<string, unknown>,
  ];
  return { file, args, options };
}

beforeEach(() => {
  respondWith(null, 'saida\n');
});

afterEach(() => {
  execFileMock.mockReset();
  vi.unstubAllEnvs();
});

describe('runGit: só comandos de leitura', () => {
  it.each([
    [['commit', '-m', 'x']],
    [['push']],
    [['pull']],
    [['fetch']],
    [['merge', 'outra']],
    [['checkout', 'outra']],
    [['reset', '--hard']],
    [['worktree', 'add', 'pasta']],
    // As formas fixas de worktree são de `runGitWorktree`; `runGit` só lê.
    [['worktree', 'add', '-b', 'ph/x', 'pasta', 'abc']],
    [['worktree', 'remove', 'pasta']],
    [['branch']],
    [['branch', '--list']],
    [['branch', 'nome']],
    [['branch', '-D', 'nome']],
    [['branch', '--show-current', 'nome']],
    [['symbolic-ref', 'HEAD', 'refs/heads/outra']],
    [['symbolic-ref', '--delete', 'HEAD']],
    [['symbolic-ref', '-d', 'HEAD']],
    [['symbolic-ref', '--short']],
    [['symbolic-ref', '-m', 'motivo', 'HEAD']],
    // `diff` só contra HEAD, com as opções de leitura; diff externo, filtro de texto e saída em
    // arquivo ficam de fora.
    [['diff']],
    [['diff', 'main']],
    [['diff', 'HEAD', 'outra']],
    [['diff', 'HEAD', '--ext-diff']],
    [['diff', 'HEAD', '--textconv']],
    [['diff', 'HEAD', '--output=/tmp/alvo']],
    [['diff', '--cached', 'HEAD']],
    // `check-ignore` só vale em `-- <caminhos>`: `-z` o Git só aceita com `--stdin`, `--stdin` lê
    // caminhos de fora da lista, e `--no-index` e as demais opções mudam o que o Git responde.
    [['check-ignore', '-z', '--', 'a']],
    [['check-ignore', '--stdin']],
    [['check-ignore', '--no-index', '--', 'a']],
    [['check-ignore', 'a']],
    [['check-ignore', '--']],
    [['check-ignore', '--', '.env', '']],
    [['check-ignore', '-v', '--', '.env']],
    [['check-ignore']],
    // `log` só com o formato fixo, `-n` de 1 a 50 e `--decorate=short`: `--output` escreve em arquivo.
    [['log']],
    [['log', '-n', '51', LOG_FORMAT, '--decorate=short']],
    [['log', '-n', '0', LOG_FORMAT, '--decorate=short']],
    [['log', '-n', '051', LOG_FORMAT, '--decorate=short']],
    [['log', '-n', '+5', LOG_FORMAT, '--decorate=short']],
    [['log', '-n', '5x', LOG_FORMAT, '--decorate=short']],
    [['log', '--output=x']],
    [['log', '-n', '5', LOG_FORMAT, '--decorate=short', '--output=x']],
    [['log', '-n', '5', '--format=%H', '--decorate=short']],
    [['log', '-n', '5', LOG_FORMAT]],
    [['log', '-n', '5', LOG_FORMAT, '--decorate=short', 'main']],
    // `rev-list --left-right --count <ref>...HEAD`: o operando nunca vira opção.
    [['rev-list', '--left-right', '--count', '-x...HEAD']],
    [['rev-list', '--left-right', '--count', '...HEAD']],
    [['rev-list', '--left-right', '--count', 'origin/main...main']],
    [['rev-list', '--count', 'origin/main...HEAD']],
    [['rev-list', '--left-right', '--count', 'origin/main...HEAD', '--output=x']],
    [['rev-list', 'HEAD']],
    // `merge-base HEAD <ref>`, e nada além disso.
    [['merge-base', '--is-ancestor', 'HEAD', 'main']],
    [['merge-base', 'HEAD', '-x']],
    [['merge-base', 'main', 'HEAD']],
    [['merge-base', 'HEAD']],
    [['merge-base', 'HEAD', 'a', 'b']],
    [['merge-base']],
    // `diff` contra a base só com o nome inteiro do commit (o `merge-base` calculado pelo adaptador).
    [['diff', '--numstat', SHA]],
    [['diff', SHA, '--numstat']],
    [['diff', '--name-status', SHA]],
    [['diff', '--numstat', '--name-status', '-z', SHA]],
    [['diff', '--numstat', '-z', SHA, '--', 'a.txt']],
    [['diff', '--numstat', '-z', SHA, 'HEAD']],
    [['diff', '--numstat', '-z', 'main']],
    [['diff', '--numstat', '-z', SHA.slice(0, 12)]],
    [['diff', '--numstat', '-z', `${SHA}0`]],
    [['diff', '--numstat', '-z', '--ext-diff', SHA]],
    [['diff', '--numstat', '-z', '--output=x', SHA]],
    [['diff', SHA]],
    [['diff', SHA, '--', 'a.txt']],
    [['diff', SHA, ...PATCH_OPTIONS]],
    [['diff', SHA, ...PATCH_OPTIONS, '--']],
    [['diff', SHA, ...PATCH_OPTIONS, '--', 'a.txt', 'b.txt']],
    [['diff', SHA, ...PATCH_OPTIONS, '--', '']],
    [['diff', SHA, '--patch', '--no-ext-diff', '--', 'a.txt']],
    [['diff', SHA, '--patch', '--no-textconv', '--', 'a.txt']],
    [['diff', SHA, ...PATCH_OPTIONS, '-z', '--', 'a.txt']],
    [['diff', SHA, ...PATCH_OPTIONS, '--output=x', '--', 'a.txt']],
    [['diff', 'main', ...PATCH_OPTIONS, '--', 'a.txt']],
    // `ls-files -z -- <caminhos>`: sem as opções que listam outra coisa nem leem de fora.
    [['ls-files']],
    [['ls-files', '-z']],
    [['ls-files', '-z', '--']],
    [['ls-files', '--', 'a.txt']],
    [['ls-files', '-z', 'a.txt']],
    [['ls-files', '-z', '--', '']],
    [['ls-files', '-z', '--', 'a.txt', '']],
    [['ls-files', '-z', '-o', '--', 'a.txt']],
    [['ls-files', '-z', '--others', '--', 'a.txt']],
    [['ls-files', '-s', '-z', '--', 'a.txt']],
    [['ls-files', '--exclude-from=x', '-z', '--', 'a.txt']],
    // `config` só lê chaves conhecidas, uma de cada vez.
    [['config', '--get', 'remote.origin.pushurl']],
    [['config', '--get', 'remote.origin.url', 'extra']],
    [['config', '--get', 'remote.upstream.url']],
    [['config', 'remote.origin.url', 'https://alvo']],
    [['config', '--add', 'remote.origin.url', 'https://alvo']],
    [['config', '--unset', 'remote.origin.url']],
    [['config', '--get-all', 'remote.origin.url']],
    [['config', '--get', 'core.hooksPath']],
    // Opção antes do subcomando: `-c` mudaria a configuração do Git para esta chamada.
    [['-c', 'core.fsmonitor=comando', 'status']],
    [['--version']],
    [['']],
    [[]],
  ])('recusa %j antes de criar um processo', async (args) => {
    await expect(runGit(args, { cwd })).rejects.toMatchObject({ code: 'PERMISSION_DENIED' });
    await expect(runGit(args, { cwd })).rejects.toBeInstanceOf(GitError);

    expect(execFileMock).not.toHaveBeenCalled();
  });

  it.each([
    [['status']],
    [['status', '--porcelain=v2', '--branch', '-z']],
    [['rev-parse', '--is-inside-work-tree']],
    [['rev-parse', '--is-inside-work-tree', '--show-prefix']],
    [['rev-parse', 'HEAD']],
    [['symbolic-ref', '--short', 'refs/remotes/origin/HEAD']],
    [['symbolic-ref', '-q', 'HEAD']],
    [['branch', '--show-current']],
    [
      [
        'diff',
        'HEAD',
        '--numstat',
        '-z',
        '--no-renames',
        '--no-ext-diff',
        '--no-textconv',
        '--no-color',
      ],
    ],
    [['diff', 'HEAD', '--patch', '--no-renames', '--', ':(literal)a.txt']],
    [['diff', 'HEAD', '--name-status', '--', 'pasta', 'outro']],
    [['check-ignore', '--', '.env', '.vscode/']],
    [['check-ignore', '--', 'config/local.json']],
    // As leituras do painel de código-fonte (ADR 0010).
    [['status', '--porcelain=v2', '--branch', '-z']],
    [['rev-parse', '--abbrev-ref', 'HEAD']],
    [['log', '-n', '1', LOG_FORMAT, '--decorate=short']],
    [['log', '-n', '9', LOG_FORMAT, '--decorate=short']],
    [['log', '-n', '50', LOG_FORMAT, '--decorate=short']],
    [['rev-list', '--left-right', '--count', 'origin/main...HEAD']],
    [['rev-list', '--left-right', '--count', 'origin/feat/ação nova...HEAD']],
    [['merge-base', 'HEAD', 'origin/main']],
    [['merge-base', 'HEAD', SHA]],
    [['diff', '--name-status', '-z', SHA]],
    [['diff', '--name-status', '-z', '--no-renames', '--no-ext-diff', '--no-textconv', SHA]],
    [['diff', '--numstat', '-z', SHA]],
    [['diff', '--numstat', '-z', '--no-renames', '--no-ext-diff', '--no-textconv', SHA]],
    [['diff', '--numstat', '-z', SHA256]],
    [['diff', SHA, ...PATCH_OPTIONS, '--', ':(literal)a[1].txt']],
    [['diff', SHA, '--patch', ...PATCH_OPTIONS, '--', 'pasta/a.txt']],
    [['ls-files', '-z', '--', 'a.txt']],
    [['ls-files', '-z', '--', ':(literal)a[1].txt', ':(literal)./-x']],
    [['config', '--get', 'remote.origin.url']],
  ])('aceita %j', async (args) => {
    await runGit(args, { cwd });

    expect(call().args).toEqual([...FSMONITOR_OFF, ...args]);
  });
});

describe('runGit: como o processo é criado', () => {
  it('passa os argumentos em array, sem shell, e devolve a saída', async () => {
    const result = await runGit(['rev-parse', 'HEAD'], { cwd });

    expect(result).toEqual({ stdout: 'saida\n' });
    const { file, args, options } = call();
    expect(file).toBe('git');
    expect(args).toEqual([...FSMONITOR_OFF, 'rev-parse', 'HEAD']);
    expect(options.shell ?? false).toBe(false);
    expect(options).toMatchObject({ cwd, encoding: 'utf8', windowsHide: true });
  });

  // O `-c` do chamador continua recusado (lista de permissão); o do adaptador vai sempre, antes do
  // subcomando, em todo comando permitido.
  it.each([
    [['status']],
    [['rev-parse', '--is-inside-work-tree']],
    [['symbolic-ref', '--short', 'refs/remotes/origin/HEAD']],
    [['branch', '--show-current']],
  ])('passa -c core.fsmonitor=false antes do subcomando em %j', async (args) => {
    await runGit(args, { cwd });

    const passed = call().args;
    expect(passed.slice(0, 2)).toEqual(FSMONITOR_OFF);
    expect(passed[2]).toBe(args[0]);
    expect(passed.filter((arg) => arg === '-c')).toHaveLength(1);
  });

  it('usa o gitBinary informado', async () => {
    await runGit(['status'], { cwd, gitBinary: 'C:\\Git\\git.exe' });

    expect(call().file).toBe('C:\\Git\\git.exe');
  });

  it('o tempo limite padrão é de 15 segundos, e timeoutMs o troca', async () => {
    await runGit(['status'], { cwd });
    expect(call().options.timeout).toBe(15_000);

    execFileMock.mockClear();
    await runGit(['status'], { cwd, timeoutMs: 500 });
    expect(call().options.timeout).toBe(500);
  });

  it('roda com mensagens em inglês, sem travas opcionais e sem herdar o repositório do ambiente', async () => {
    vi.stubEnv('GIT_DIR', 'C:\\outro\\.git');
    vi.stubEnv('GIT_WORK_TREE', 'C:\\outro');
    vi.stubEnv('GIT_INDEX_FILE', 'C:\\outro\\.git\\index');
    vi.stubEnv('PH_TESTE_VARIAVEL', 'mantida');

    await runGit(['status'], { cwd });

    const env = call().options.env as Record<string, string | undefined>;
    expect(env).toMatchObject({
      LC_ALL: 'C',
      GIT_OPTIONAL_LOCKS: '0',
      PH_TESTE_VARIAVEL: 'mantida',
    });
    expect(env).not.toHaveProperty('GIT_DIR');
    expect(env).not.toHaveProperty('GIT_WORK_TREE');
    expect(env).not.toHaveProperty('GIT_INDEX_FILE');
  });
});

describe('runGit: falhas', () => {
  it('saída com código diferente de zero vira GitError com código e stderr', async () => {
    respondWith(Object.assign(new Error('Command failed'), { code: 128 }), '', 'fatal: algo\n');

    await expect(runGit(['status'], { cwd })).rejects.toMatchObject({
      name: 'GitError',
      code: 'UNKNOWN',
      exitCode: 128,
      stderr: 'fatal: algo\n',
    });
  });

  it('o stdout de um comando que falhou chega ao GitError, ao lado do stderr', async () => {
    respondWith(
      Object.assign(new Error('Command failed'), { code: 1 }),
      'saida do hook\n',
      'error: failed\n',
    );

    await expect(runGit(['status'], { cwd })).rejects.toMatchObject({
      exitCode: 1,
      stdout: 'saida do hook\n',
      stderr: 'error: failed\n',
    });
  });

  it('a mensagem não repete a saída de erro do Git', async () => {
    respondWith(
      Object.assign(new Error('Command failed'), { code: 128 }),
      '',
      'fatal: conteudo do repositorio',
    );

    const error = await runGit(['status'], { cwd }).catch((caught: unknown) => caught);

    expect((error as GitError).message).not.toContain('conteudo do repositorio');
  });

  it('estouro do tempo limite diz que o Git foi interrompido', async () => {
    respondWith(Object.assign(new Error('timed out'), { killed: true, signal: 'SIGTERM' }));

    await expect(runGit(['status'], { cwd, timeoutMs: 2_000 })).rejects.toMatchObject({
      code: 'UNKNOWN',
      message: expect.stringContaining('2 s'),
    });
  });

  it('saída maior que o limite vira GitError', async () => {
    respondWith(
      Object.assign(new Error('maxBuffer exceeded'), { code: 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER' }),
    );

    await expect(runGit(['status'], { cwd })).rejects.toMatchObject({
      code: 'UNKNOWN',
      message: expect.stringContaining('limite'),
    });
  });

  it('executável ausente vira GIT_NOT_AVAILABLE com a instrução', async () => {
    respondWith(Object.assign(new Error('spawn git ENOENT'), { code: 'ENOENT' }));

    await expect(runGit(['status'], { cwd })).rejects.toMatchObject({
      code: 'GIT_NOT_AVAILABLE',
      message: 'Instale o Git e reinicie o Project Hub.',
    });
  });

  it('ENOENT com a pasta de trabalho ausente vira PROJECT_PATH_UNAVAILABLE', async () => {
    respondWith(Object.assign(new Error('spawn git ENOENT'), { code: 'ENOENT' }));

    await expect(runGit(['status'], { cwd: join(cwd, 'sumiu-de-vez') })).rejects.toMatchObject({
      code: 'PROJECT_PATH_UNAVAILABLE',
    });
  });

  it('erro de outro tipo vira GitError e guarda o original em cause', async () => {
    const original = Object.assign(new Error('EACCES'), { code: 'EACCES' });
    respondWith(original);

    await expect(runGit(['status'], { cwd })).rejects.toMatchObject({
      code: 'UNKNOWN',
      cause: original,
    });
  });
});

describe('runApproved: variáveis extras do adaptador', () => {
  it('o extra entra no ambiente, mas não reintroduz as variáveis de repositório', async () => {
    vi.stubEnv('GIT_COMMON_DIR', '/herdado/.git');
    await runApproved(['status'], { cwd }, [], {
      GIT_DIR: 'x',
      GIT_WORK_TREE: 'x',
      GIT_INDEX_FILE: 'x',
      GIT_COMMON_DIR: 'x',
      GIT_LITERAL_PATHSPECS: '1',
    });
    const env = call().options.env as Record<string, string | undefined>;
    expect(env.GIT_LITERAL_PATHSPECS).toBe('1');
    expect(env).not.toHaveProperty('GIT_DIR');
    expect(env).not.toHaveProperty('GIT_WORK_TREE');
    expect(env).not.toHaveProperty('GIT_INDEX_FILE');
    expect(env).not.toHaveProperty('GIT_COMMON_DIR');
  });
});
