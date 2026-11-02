import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GitError } from '../src/run-git';
import { isWriteAllowed, runGitWrite } from '../src/run-git-write';

// Unitário: o `execFile` é imitado, então nenhum processo é criado aqui. Os testes com o Git de
// verdade (hook que falha, push para remote local) ficam no arquivo de integração.
vi.mock('node:child_process', () => ({ execFile: vi.fn() }));

type Callback = (error: Error | null, stdout: string, stderr: string) => void;

const execFileMock = vi.mocked(execFile);
// Uma pasta que existe, para os erros ENOENT não serem confundidos com pasta de trabalho ausente.
const cwd = import.meta.dirname;
const FSMONITOR_OFF = ['-c', 'core.fsmonitor=false'];
const DEFAULT_TIMEOUT_MS = 15_000;
const NETWORK_TIMEOUT_MS = 120_000;

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

describe('runGitWrite: formas permitidas (ADR 0010)', () => {
  it.each([
    [['add', '-A']],
    [['add', '--', 'a.ts', 'b c.ts']],
    [['add', '--', 'pasta/ação.ts']],
    [['restore', '--staged', '--', 'a.ts']],
    [['restore', '--staged', '--', 'a.ts', 'b c.ts']],
    [['restore', '--', 'a.ts']],
    [['commit', '-m', 'Mensagem']],
    [['commit', '-m', 'Título\n\nCorpo com "aspas" e acentuação.']],
    [['commit', '-m', 'x'.repeat(10_000)]],
    [['push']],
    [['push', '-u', 'origin', 'main']],
    [['push', '-u', 'origin', 'feat/painel-direito']],
    [['pull', '--ff-only']],
    [['fetch', '--prune', 'origin']],
  ])('%j passa com os argumentos exatos, depois do -c do fsmonitor', async (args) => {
    await expect(runGitWrite(args, { cwd })).resolves.toEqual({ stdout: 'saida\n' });
    const { file, args: passed } = call();
    expect(file).toBe('git');
    expect(passed).toEqual([...FSMONITOR_OFF, ...args]);
    expect(isWriteAllowed(args)).toBe(true);
  });
});

describe('runGitWrite: formas proibidas rejeitam sem criar processo', () => {
  it.each([
    // push: nada de força, apagar, espelhar, tags nem refspec livre
    [['push', '--force']],
    [['push', '-f']],
    [['push', '--force-with-lease']],
    [['push', '--force-with-lease=main']],
    [['push', '--delete', 'origin', 'x']],
    [['push', '-d', 'origin', 'x']],
    [['push', '--mirror']],
    [['push', '--tags']],
    [['push', '--all']],
    [['push', 'origin', 'main']],
    [['push', 'origin', '+main:main']],
    [['push', 'origin', ':main']],
    [['push', '-u', 'origin']],
    [['push', '-u', 'origin', '']],
    [['push', '-u', 'origin', '-f']],
    [['push', '-u', 'origin', '+main']],
    [['push', '-u', 'origin', 'main:outra']],
    [['push', '-u', 'origin', ':main']],
    [['push', '-u', 'origin', 'main', '--force']],
    [['push', '-u', 'origin', 'a b']],
    [['push', '-u', 'origin', 'a..b']],
    [['push', '-u', 'origin', 'HEAD@{1}']],
    [['push', '-u', 'outro', 'main']],
    [['push', '-u', 'https://exemplo.test/r.git', 'main']],
    [['push', '--set-upstream', 'origin', 'main']],
    [['push', '--no-verify']],
    // commit: sem amend, sem pular hooks, sem -a, sem vazio
    [['commit', '--amend', '-m', 'x']],
    [['commit', '--no-verify', '-m', 'x']],
    [['commit', '-n', '-m', 'x']],
    [['commit', '-a', '-m', 'x']],
    [['commit', '-am', 'x']],
    [['commit', '--allow-empty', '-m', 'x']],
    [['commit', '-m', '']],
    [['commit', '-m', '   \n ']],
    [['commit', '-m', '-x']],
    [['commit', '-m', 'x'.repeat(10_001)]],
    [['commit', '-m']],
    [['commit', '-m', 'a', 'b']],
    [['commit', '-m', 'a', '--amend']],
    [['commit']],
    [['commit', '--message=x']],
    // restore: sempre com `--`
    [['restore', 'a.ts']],
    [['restore', '--staged', 'a.ts']],
    [['restore', '--staged', '--']],
    [['restore', '--']],
    [['restore', '--source=HEAD~1', '--', 'a.ts']],
    [['restore', '--staged', '--worktree', '--', 'a.ts']],
    [['restore', '--', '-x.ts']],
    [['restore', '--', '']],
    // add
    [['add']],
    [['add', '.']],
    [['add', '--all']],
    [['add', '-A', 'a.ts']],
    [['add', '-f', '--', 'a.ts']],
    [['add', '--']],
    [['add', '--', '-x.ts']],
    [['add', '--', 'a.ts', '-x.ts']],
    [['add', '--', '']],
    [['add', 'a.ts']],
    // pull e fetch
    [['pull']],
    [['pull', '--rebase']],
    [['pull', '--ff-only', 'origin']],
    [['pull', '--ff']],
    [['pull', 'origin', 'main']],
    [['fetch']],
    [['fetch', 'origin']],
    [['fetch', '--prune']],
    [['fetch', '--prune', 'outro']],
    [['fetch', '--prune', 'origin', 'main']],
    [['fetch', '--all']],
    // fora da lista
    [['reset', '--hard']],
    [['reset']],
    [['clean', '-fd']],
    [['checkout', 'main']],
    [['switch', 'main']],
    [['merge', 'x']],
    [['rebase', 'main']],
    [['branch', '-D', 'x']],
    [['stash']],
    [['status']],
    [['diff', 'HEAD']],
    [['worktree', 'add', '-b', 'ph/x', 'pasta', 'abc']],
    [['remote', 'add', 'origin', 'x']],
    [['config', 'user.name', 'x']],
    [['-c', 'core.hooksPath=/x', 'commit', '-m', 'x']],
    [['-C', 'outra', 'push']],
    [[]],
  ])('%j é recusado com PERMISSION_DENIED', async (args) => {
    await expect(runGitWrite(args, { cwd })).rejects.toMatchObject({
      name: 'GitError',
      code: 'PERMISSION_DENIED',
    });
    expect(execFileMock).not.toHaveBeenCalled();
    expect(isWriteAllowed(args)).toBe(false);
  });

  it('a recusa é um GitError', async () => {
    await expect(runGitWrite(['push', '--force'], { cwd })).rejects.toBeInstanceOf(GitError);
  });
});

describe('runGitWrite: ambiente e tempo limite', () => {
  it.each([
    [['add', '-A']],
    [['add', '--', 'a.ts']],
    [['restore', '--staged', '--', 'a.ts']],
    [['restore', '--', 'a.ts']],
    [['commit', '-m', 'x']],
    [['push']],
    [['push', '-u', 'origin', 'main']],
    [['pull', '--ff-only']],
    [['fetch', '--prune', 'origin']],
  ])(
    '%j roda sem prompt de credencial, sem travas opcionais e sem variáveis de repositório',
    async (args) => {
      vi.stubEnv('GIT_DIR', '/outro/.git');
      vi.stubEnv('GIT_WORK_TREE', '/outro');
      vi.stubEnv('GIT_INDEX_FILE', '/outro/.git/index');
      vi.stubEnv('GIT_COMMON_DIR', '/outro/.git');
      await runGitWrite(args, { cwd });
      const { options } = call();
      const env = options.env as Record<string, string | undefined>;
      expect(env).toMatchObject({
        GIT_TERMINAL_PROMPT: '0',
        GCM_INTERACTIVE: 'never',
        GIT_LITERAL_PATHSPECS: '1',
        GIT_OPTIONAL_LOCKS: '0',
        LC_ALL: 'C',
      });
      expect(env).not.toHaveProperty('GIT_DIR');
      expect(env).not.toHaveProperty('GIT_WORK_TREE');
      expect(env).not.toHaveProperty('GIT_INDEX_FILE');
      expect(env).not.toHaveProperty('GIT_COMMON_DIR');
      expect(options.cwd).toBe(cwd);
    },
  );

  it('GIT_TERMINAL_PROMPT e GCM_INTERACTIVE herdados não vencem os valores do adaptador', async () => {
    vi.stubEnv('GIT_TERMINAL_PROMPT', '1');
    vi.stubEnv('GCM_INTERACTIVE', 'always');
    await runGitWrite(['push'], { cwd });
    const env = call().options.env as Record<string, string | undefined>;
    expect(env.GIT_TERMINAL_PROMPT).toBe('0');
    expect(env.GCM_INTERACTIVE).toBe('never');
  });

  it.each([
    [['push']],
    [['push', '-u', 'origin', 'main']],
    [['pull', '--ff-only']],
    [['fetch', '--prune', 'origin']],
  ])('%j tem tempo limite de 120 s', async (args) => {
    await runGitWrite(args, { cwd });
    expect(call().options.timeout).toBe(NETWORK_TIMEOUT_MS);
  });

  it.each([
    [['add', '-A']],
    [['add', '--', 'a.ts']],
    [['restore', '--staged', '--', 'a.ts']],
    [['restore', '--', 'a.ts']],
    [['commit', '-m', 'x']],
  ])('%j usa o tempo limite padrão de runGit', async (args) => {
    await runGitWrite(args, { cwd });
    expect(call().options.timeout).toBe(DEFAULT_TIMEOUT_MS);
  });

  it('um tempo limite dado pelo chamador vale também para a rede', async () => {
    await runGitWrite(['fetch', '--prune', 'origin'], { cwd, timeoutMs: 5_000 });
    expect(call().options.timeout).toBe(5_000);
  });

  it('usa o executável dado em gitBinary', async () => {
    await runGitWrite(['add', '-A'], { cwd, gitBinary: '/opt/git' });
    expect(call().file).toBe('/opt/git');
  });
});

describe('runGitWrite: hooks rodam (ADR 0010)', () => {
  it.each([[['commit', '-m', 'x']], [['push']], [['push', '-u', 'origin', 'main']]])(
    '%j não recebe core.hooksPath',
    async (args) => {
      await runGitWrite(args, { cwd });
      const { args: passed } = call();
      expect(passed.join(' ')).not.toContain('hooksPath');
      expect(passed.filter((arg) => arg === '-c')).toHaveLength(1);
      expect(passed.slice(0, 2)).toEqual(FSMONITOR_OFF);
    },
  );
});

describe('runGitWrite: falhas do Git', () => {
  it('erro de saída vira GitError com o código de saída e o stderr (a saída do hook)', async () => {
    const failure = Object.assign(new Error('Command failed'), { code: 1 });
    respondWith(failure, '', 'pre-commit: lint falhou\n');
    const error = await runGitWrite(['commit', '-m', 'x'], { cwd }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(GitError);
    expect(error).toMatchObject({
      code: 'UNKNOWN',
      exitCode: 1,
      stderr: 'pre-commit: lint falhou\n',
    });
    // Não tenta de novo: não era a trava do índice.
    expect(execFileMock).toHaveBeenCalledTimes(1);
  });

  it('executável ausente vira GIT_NOT_AVAILABLE', async () => {
    respondWith(Object.assign(new Error('spawn git ENOENT'), { code: 'ENOENT' }));
    await expect(runGitWrite(['add', '-A'], { cwd })).rejects.toMatchObject({
      code: 'GIT_NOT_AVAILABLE',
    });
  });

  it('tempo limite estourado vira UNKNOWN com a mensagem do limite', async () => {
    respondWith(Object.assign(new Error('timed out'), { killed: true, code: null }));
    await expect(runGitWrite(['push'], { cwd })).rejects.toMatchObject({
      code: 'UNKNOWN',
      message: expect.stringContaining('120'),
    });
  });
});

describe('runGitWrite: passa por withLockAwareness', () => {
  let repo: string;

  beforeEach(async () => {
    repo = await mkdtemp(join(tmpdir(), 'ph-run-git-write-'));
    await mkdir(join(repo, '.git'));
    await writeFile(join(repo, '.git', 'index.lock'), '');
  });

  afterEach(async () => {
    await rm(repo, { recursive: true, force: true });
  });

  it('com index.lock presente, tenta de novo depois de uma falha que cita a trava', async () => {
    let calls = 0;
    execFileMock.mockImplementation(((
      _file: string,
      _args: string[],
      _options: object,
      done: Callback,
    ) => {
      calls += 1;
      if (calls === 1) {
        done(
          Object.assign(new Error('Command failed'), { code: 128 }),
          '',
          "fatal: Unable to create '.git/index.lock': File exists.",
        );
      } else {
        done(null, 'ok\n', '');
      }
    }) as unknown as typeof execFile);

    await expect(runGitWrite(['add', '-A'], { cwd: repo })).resolves.toEqual({ stdout: 'ok\n' });
    expect(calls).toBe(2);
  });
});
