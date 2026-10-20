import { execFile } from 'node:child_process';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GitError, runGit } from '../src/run-git';

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
