import { execFile } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { isAbsolute, relative } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GitError, runGit, runGitWorktree } from '../src/run-git';

// Unitário: o `execFile` é imitado, então nenhum processo é criado aqui. O Git de verdade fica em
// worktree.integration.test.ts.
vi.mock('node:child_process', () => ({ execFile: vi.fn() }));

type Callback = (error: Error | null, stdout: string, stderr: string) => void;

const execFileMock = vi.mocked(execFile);
// Uma pasta que existe, para os erros ENOENT não serem confundidos com pasta de trabalho ausente.
const cwd = import.meta.dirname;
const FSMONITOR_OFF = ['-c', 'core.fsmonitor=false'];
const SHA = '0123456789abcdef0123456789abcdef01234567';

/**
 * Confere os argumentos de um `worktree add`: depois do `-c` do fsmonitor vem o `-c core.hooksPath`,
 * que aponta o Git para uma pasta sem hooks, e só então o subcomando. Devolve a pasta de hooks.
 */
function expectAddArgs(passed: string[], args: string[]): string {
  expect(passed.slice(0, 2)).toEqual(FSMONITOR_OFF);
  expect(passed[2]).toBe('-c');
  expect(passed[3]).toMatch(/^core\.hooksPath=.+/);
  expect(passed.slice(4)).toEqual(args);
  return (passed[3] ?? '').slice('core.hooksPath='.length);
}

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

describe('runGitWorktree: só duas formas fixas', () => {
  it.each([
    // `add`: só `-b <branch> <pasta> <base>`.
    [['worktree', 'add', '--force', '-b', 'ph/x', 'C:\\w\\x', SHA]],
    [['worktree', 'add', '-b', 'ph/x', 'C:\\w\\x', SHA, '--force']],
    [['worktree', 'add', '-B', 'ph/x', 'C:\\w\\x', SHA]],
    [['worktree', 'add', '--detach', 'C:\\w\\x', SHA]],
    [['worktree', 'add', 'C:\\w\\x', SHA]],
    [['worktree', 'add', 'C:\\w\\x']],
    [['worktree', 'add', '-b', 'ph/x', 'C:\\w\\x']],
    [['worktree', 'add', '-b', 'ph/x', 'C:\\w\\x', SHA, 'sobra']],
    [['worktree', 'add', '-b', '--force', 'C:\\w\\x', SHA]],
    [['worktree', 'add', '-b', 'ph/x', '--force', SHA]],
    [['worktree', 'add', '-b', 'ph/x', 'C:\\w\\x', '--detach']],
    [['worktree', 'add', '-b', 'ph/x', 'C:\\w\\x', '-f']],
    [['worktree', 'add', '-b', '', 'C:\\w\\x', SHA]],
    [['worktree', 'add', '-b', 'ph/x', '', SHA]],
    [['worktree', 'add', '-b', 'ph/x', 'C:\\w\\x', '']],
    [['worktree', 'add']],
    // `remove`: só `<pasta>`, nunca com --force.
    [['worktree', 'remove', '--force', 'C:\\w\\x']],
    [['worktree', 'remove', '-f', 'C:\\w\\x']],
    [['worktree', 'remove', 'C:\\w\\x', '--force']],
    [['worktree', 'remove', 'C:\\w\\x', '-f']],
    [['worktree', 'remove', '-f', '-f', 'C:\\w\\x']],
    [['worktree', 'remove', '--', 'C:\\w\\x']],
    [['worktree', 'remove', 'C:\\w\\x', 'C:\\w\\y']],
    [['worktree', 'remove', '--force']],
    [['worktree', 'remove', '']],
    [['worktree', 'remove']],
    // Outros subcomandos de `worktree`.
    [['worktree']],
    [['worktree', 'list']],
    [['worktree', 'list', '--porcelain']],
    [['worktree', 'prune']],
    [['worktree', 'move', 'C:\\w\\x', 'C:\\w\\y']],
    [['worktree', 'lock', 'C:\\w\\x']],
    [['worktree', 'unlock', 'C:\\w\\x']],
    [['worktree', 'repair']],
    // Nada fora de `worktree`: apagar branch, falar com a rede ou mexer no histórico.
    [['branch', '-d', 'ph/x']],
    [['branch', '-D', 'ph/x']],
    [['branch', '--delete', 'ph/x']],
    [['branch', '-m', 'ph/x', 'ph/y']],
    [['branch', 'ph/x']],
    [['push']],
    [['push', 'origin', '--delete', 'ph/x']],
    [['fetch']],
    [['pull']],
    [['merge', 'ph/x']],
    [['commit', '-m', 'x']],
    [['reset', '--hard']],
    [['clean', '-fd']],
    [['checkout', 'ph/x']],
    [['rm', '-r', 'a.txt']],
    [['update-ref', '-d', 'refs/heads/ph/x']],
    // Os de leitura passam por `runGit`.
    [['status']],
    [['rev-parse', 'HEAD']],
    [['branch', '--show-current']],
    // Opção antes do subcomando: `-c` e `-C` mudariam o comportamento do Git.
    [['-c', 'core.fsmonitor=comando', 'worktree', 'remove', 'C:\\w\\x']],
    [['-C', 'C:\\outro', 'worktree', 'remove', 'C:\\w\\x']],
    [['--git-dir=C:\\outro', 'worktree', 'remove', 'C:\\w\\x']],
    [['--version']],
    [['']],
    [[]],
  ])('recusa %j antes de criar um processo', async (args) => {
    await expect(runGitWorktree(args, { cwd })).rejects.toMatchObject({
      code: 'PERMISSION_DENIED',
    });
    await expect(runGitWorktree(args, { cwd })).rejects.toBeInstanceOf(GitError);

    expect(execFileMock).not.toHaveBeenCalled();
  });

  it('as formas de worktree continuam recusadas por runGit, que só lê', async () => {
    await expect(
      runGit(['worktree', 'add', '-b', 'ph/x', 'C:\\w\\x', SHA], { cwd }),
    ).rejects.toMatchObject({ code: 'PERMISSION_DENIED' });
    await expect(runGit(['worktree', 'remove', 'C:\\w\\x'], { cwd })).rejects.toMatchObject({
      code: 'PERMISSION_DENIED',
    });

    expect(execFileMock).not.toHaveBeenCalled();
  });

  it('aceita worktree add -b <branch> <pasta> <base>', async () => {
    const args = ['worktree', 'add', '-b', 'ph/abcdef12-x', 'C:\\w\\app\\abcdef12-x', SHA];

    await runGitWorktree(args, { cwd });

    expectAddArgs(call().args, args);
  });

  it('aceita worktree remove <pasta>', async () => {
    const args = ['worktree', 'remove', 'C:\\w\\app\\abcdef12-x'];

    await runGitWorktree(args, { cwd });

    expect(call().args).toEqual([...FSMONITOR_OFF, ...args]);
    expect(call().args).not.toContain('--force');
    expect(call().args).not.toContain('-f');
  });
});

describe('runGitWorktree: como o processo é criado', () => {
  const addArgs = ['worktree', 'add', '-b', 'ph/x', 'C:\\w\\x', SHA];

  it('passa os argumentos em array, sem shell, e devolve a saída', async () => {
    const result = await runGitWorktree(addArgs, { cwd });

    expect(result).toEqual({ stdout: 'saida\n' });
    const { file, args, options } = call();
    expect(file).toBe('git');
    expectAddArgs(args, addArgs);
    expect(options.shell ?? false).toBe(false);
    expect(options).toMatchObject({ cwd, encoding: 'utf8', windowsHide: true });
  });

  it('passa -c core.fsmonitor=false antes do subcomando, uma vez só', async () => {
    const removeArgs = ['worktree', 'remove', 'C:\\w\\x'];
    await runGitWorktree(removeArgs, { cwd });

    const passed = call().args;
    expect(passed).toEqual([...FSMONITOR_OFF, ...removeArgs]);
    expect(passed.filter((arg) => arg === '-c')).toHaveLength(1);
  });

  it('usa o gitBinary informado', async () => {
    await runGitWorktree(addArgs, { cwd, gitBinary: 'C:\\Git\\git.exe' });

    expect(call().file).toBe('C:\\Git\\git.exe');
  });

  // O checkout de um repositório grande leva bem mais que os 15 s de uma leitura. Cortá-lo no meio
  // deixaria um worktree pela metade.
  it('o tempo limite padrão é de 120 segundos, e timeoutMs o troca', async () => {
    await runGitWorktree(addArgs, { cwd });
    expect(call().options.timeout).toBe(120_000);

    execFileMock.mockClear();
    await runGitWorktree(addArgs, { cwd, timeoutMs: 500 });
    expect(call().options.timeout).toBe(500);
  });

  it('roda com mensagens em inglês, sem travas opcionais e sem herdar o repositório do ambiente', async () => {
    vi.stubEnv('GIT_DIR', 'C:\\outro\\.git');
    vi.stubEnv('GIT_WORK_TREE', 'C:\\outro');
    vi.stubEnv('GIT_INDEX_FILE', 'C:\\outro\\.git\\index');
    vi.stubEnv('GIT_COMMON_DIR', 'C:\\outro\\.git');
    vi.stubEnv('PH_TESTE_VARIAVEL', 'mantida');

    await runGitWorktree(addArgs, { cwd });

    const env = call().options.env as Record<string, string | undefined>;
    expect(env).toMatchObject({
      LC_ALL: 'C',
      GIT_OPTIONAL_LOCKS: '0',
      PH_TESTE_VARIAVEL: 'mantida',
    });
    expect(env).not.toHaveProperty('GIT_DIR');
    expect(env).not.toHaveProperty('GIT_WORK_TREE');
    expect(env).not.toHaveProperty('GIT_INDEX_FILE');
    expect(env).not.toHaveProperty('GIT_COMMON_DIR');
  });

  it('nome com espaço, aspas, acento e metacaracteres de shell segue como um único argumento', async () => {
    const path = 'C:\\w\\meu app\\a"b ação & calc | dir; $(x) `y`';
    const args = ['worktree', 'add', '-b', 'ph/abcdef12-x', path, SHA];

    await runGitWorktree(args, { cwd });

    expectAddArgs(call().args, args);
  });
});

// O `worktree add` faz um checkout, e o checkout roda o hook `post-checkout` do repositório. Num
// repositório de terceiros (seção 17.1) isso é código que o Project Hub executaria. O `-c` do
// adaptador aponta `core.hooksPath` para uma pasta vazia, só nesse subcomando.
describe('runGitWorktree: hooks do repositório no worktree add', () => {
  const addArgs = ['worktree', 'add', '-b', 'ph/x', 'C:\\w\\x', SHA];
  const removeArgs = ['worktree', 'remove', 'C:\\w\\x'];

  /** Faz o `execFile` imitado registrar o estado da pasta de hooks no instante da chamada. */
  function watchHooksFolder(outcome: Error | null = null): {
    seen: { inside: string[]; existed: boolean }[];
  } {
    const seen: { inside: string[]; existed: boolean }[] = [];
    execFileMock.mockImplementation(((
      _file: string,
      args: string[],
      _options: object,
      done: Callback,
    ) => {
      const folder = (args[3] ?? '').slice('core.hooksPath='.length);
      seen.push({
        existed: existsSync(folder),
        inside: existsSync(folder) ? readdirSync(folder) : [],
      });
      done(outcome, '', '');
    }) as unknown as typeof execFile);
    return { seen };
  }

  it('worktree add leva core.hooksPath para uma pasta vazia, criada na pasta temporária', async () => {
    const { seen } = watchHooksFolder();

    await runGitWorktree(addArgs, { cwd });

    const folder = expectAddArgs(call().args, addArgs);
    expect(seen).toEqual([{ existed: true, inside: [] }]);
    expect(isAbsolute(folder)).toBe(true);
    expect(relative(tmpdir(), folder).startsWith('..')).toBe(false);
  });

  it('a pasta de hooks é apagada depois da criação', async () => {
    watchHooksFolder();

    await runGitWorktree(addArgs, { cwd });

    expect(existsSync(expectAddArgs(call().args, addArgs))).toBe(false);
  });

  it('a pasta de hooks é apagada também quando o Git falha', async () => {
    watchHooksFolder(Object.assign(new Error('Command failed'), { code: 128 }));

    await expect(runGitWorktree(addArgs, { cwd })).rejects.toMatchObject({ exitCode: 128 });

    expect(existsSync(expectAddArgs(call().args, addArgs))).toBe(false);
  });

  it('cada criação usa a sua pasta de hooks', async () => {
    watchHooksFolder();

    await runGitWorktree(addArgs, { cwd });
    await runGitWorktree(addArgs, { cwd });

    const [first, second] = execFileMock.mock.calls.map((c) => (c[1] as string[])[3]);
    expect(first).toBeDefined();
    expect(first).not.toBe(second);
  });

  it('worktree remove não leva core.hooksPath: só o add faz checkout', async () => {
    await runGitWorktree(removeArgs, { cwd });

    expect(call().args).toEqual([...FSMONITOR_OFF, ...removeArgs]);
    expect(call().args.join(' ')).not.toContain('hooksPath');
  });

  it('runGit não leva core.hooksPath', async () => {
    await runGit(['status'], { cwd });

    expect(call().args).toEqual([...FSMONITOR_OFF, 'status']);
  });
});

describe('runGitWorktree: falhas', () => {
  const removeArgs = ['worktree', 'remove', 'C:\\w\\x'];

  it('saída com código diferente de zero vira GitError com código e stderr', async () => {
    respondWith(Object.assign(new Error('Command failed'), { code: 128 }), '', 'fatal: algo\n');

    await expect(runGitWorktree(removeArgs, { cwd })).rejects.toMatchObject({
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

    const error = await runGitWorktree(removeArgs, { cwd }).catch((caught: unknown) => caught);

    expect((error as GitError).message).not.toContain('conteudo do repositorio');
  });

  it('estouro do tempo limite diz que o Git foi interrompido', async () => {
    respondWith(Object.assign(new Error('timed out'), { killed: true, signal: 'SIGTERM' }));

    await expect(runGitWorktree(removeArgs, { cwd, timeoutMs: 2_000 })).rejects.toMatchObject({
      code: 'UNKNOWN',
      message: expect.stringContaining('2 s'),
    });
  });

  it('executável ausente vira GIT_NOT_AVAILABLE com a instrução', async () => {
    respondWith(Object.assign(new Error('spawn git ENOENT'), { code: 'ENOENT' }));

    await expect(runGitWorktree(removeArgs, { cwd })).rejects.toMatchObject({
      code: 'GIT_NOT_AVAILABLE',
      message: 'Instale o Git e reinicie o Project Hub.',
    });
  });
});
