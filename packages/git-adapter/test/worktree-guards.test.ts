import { execFile } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GitError } from '../src/run-git';
import { createWorktree, removeWorktree } from '../src/worktree';
import { buildWorktreeNames } from '../src/worktree-naming';

// Unitário: o `execFile` é imitado, então nenhum processo é criado aqui. Serve para provar o que o
// Git de verdade não mostra: que uma recusa acontece ANTES de qualquer comando. O Git real fica em
// worktree.integration.test.ts.
vi.mock('node:child_process', () => ({ execFile: vi.fn() }));

type Callback = (error: Error | null, stdout: string, stderr: string) => void;
type Reply = { error?: Error; stdout?: string; stderr?: string };

const execFileMock = vi.mocked(execFile);
const FSMONITOR_OFF = ['-c', 'core.fsmonitor=false'];
const SHA = '0123456789abcdef0123456789abcdef01234567';
const CLEAN_STATUS = `# branch.oid ${SHA}\0# branch.head ph/abcdef12-x\0`;
const DIRTY_STATUS = `${CLEAN_STATUS}1 .M N... 100644 100644 100644 ${SHA} ${SHA} a.txt\0`;

const names = buildWorktreeNames({ missionId: 'abcdef123456', title: 'x', projectSlug: 'app' });
const created: string[] = [];

function exitedWith(code: number, stderr: string): Reply {
  return { error: Object.assign(new Error('Command failed'), { code }), stderr };
}

/** O `execFile` imitado responde conforme o subcomando (argumentos depois do `-c` do adaptador). */
function respond(handler: (args: string[]) => Reply): void {
  execFileMock.mockImplementation(((
    _file: string,
    args: string[],
    _options: object,
    done: Callback,
  ) => {
    const reply = handler(args.slice(FSMONITOR_OFF.length));
    done(reply.error ?? null, reply.stdout ?? '', reply.stderr ?? '');
  }) as unknown as typeof execFile);
}

/** Um repositório em que a base existe (devolve `SHA`) e a branch ainda não (`rev-parse` sai com 1). */
function respondWithFreeBranch(): void {
  respond((args) => {
    if (args[0] !== 'rev-parse') return {};
    return args[args.length - 1]?.startsWith('refs/heads/')
      ? exitedWith(1, '')
      : { stdout: `${SHA}\n` };
  });
}

/** Argumentos de todas as chamadas ao `execFile`, sem o `-c` do adaptador. */
function calls(): string[][] {
  return execFileMock.mock.calls.map((call) =>
    (call[1] as unknown as string[]).slice(FSMONITOR_OFF.length),
  );
}

function temporaryFolder(): string {
  const folder = mkdtempSync(join(tmpdir(), 'project-hub-guardas-'));
  created.push(folder);
  return folder;
}

beforeEach(() => {
  respond(() => ({}));
});

afterEach(() => {
  execFileMock.mockReset();
  for (const folder of created.splice(0)) rmSync(folder, { recursive: true, force: true });
});

describe('createWorktree: recusas antes do Git', () => {
  const worktreesRoot = resolve(tmpdir(), 'raiz');
  const input = { repoPath: resolve('repo'), worktreesRoot, baseRef: 'HEAD' };
  // Uma pasta absoluta, de fora da raiz: a pasta relativa montada à mão aponta direto para ela.
  const outside = resolve(tmpdir(), 'fora', 'x');

  it.each([
    ['sobe um nível', ['..', 'fora', 'x'].join(sep)],
    ['sobe vários níveis', ['..', '..', '..', 'fora', 'x'].join(sep)],
    ['sobe no meio do caminho', ['app', '..', '..', 'fora', 'x'].join(sep)],
    ['sobe com barras normais', '../fora/x'],
    ['sobe com barras normais no meio', 'app/../../fora/x'],
    ['é a própria raiz', '.'],
    ['é a própria raiz, depois de subir e descer', 'app/..'],
    ['é vazia', ''],
    ['é de uma pasta irmã com o nome da raiz mais um sufixo', ['..', 'raiz-evil', 'x'].join(sep)],
    ['é absoluta', outside],
  ])('recusa uma pasta relativa que %s', async (_case, relativeDir) => {
    await expect(
      createWorktree({ ...input, names: { ...names, relativeDir } }),
    ).rejects.toMatchObject({ name: 'GitError', code: 'PATH_OUTSIDE_ALLOWED_SCOPE' });

    expect(execFileMock).not.toHaveBeenCalled();
  });

  describe.runIf(process.platform === 'win32')('no Windows', () => {
    it.each([
      ['é absoluta, de outra unidade', 'Z:\\Windows\\Temp\\x'],
      ['é absoluta, sem a unidade', '\\Windows\\Temp\\x'],
      ['é um caminho de rede', '\\\\servidor\\compartilhamento\\x'],
      ['sobe além da raiz da unidade', `${'..\\'.repeat(40)}Windows\\x`],
    ])('recusa uma pasta relativa que %s', async (_case, relativeDir) => {
      await expect(
        createWorktree({ ...input, names: { ...names, relativeDir } }),
      ).rejects.toMatchObject({ code: 'PATH_OUTSIDE_ALLOWED_SCOPE' });

      expect(execFileMock).not.toHaveBeenCalled();
    });
  });

  it('aceita uma pasta cujo nome apenas começa com dois pontos', async () => {
    respondWithFreeBranch();
    const root = temporaryFolder();

    const worktree = await createWorktree({
      ...input,
      worktreesRoot: root,
      names: { ...names, relativeDir: 'app/..abcdef12-x' },
    });

    expect(worktree.path).toBe(join(root, 'app', '..abcdef12-x'));
  });

  it('recusa uma raiz de worktrees relativa, sem criar processo', async () => {
    await expect(
      createWorktree({ ...input, worktreesRoot: 'worktrees', names }),
    ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });

    expect(execFileMock).not.toHaveBeenCalled();
  });

  it.each([[''], ['-x'], ['--output=arquivo'], ['--show-toplevel']])(
    'recusa a base %j, que o Git leria como opção, sem criar processo',
    async (baseRef) => {
      await expect(createWorktree({ ...input, names, baseRef })).rejects.toMatchObject({
        code: 'WORKTREE_CREATE_FAILED',
      });

      expect(execFileMock).not.toHaveBeenCalled();
    },
  );
});

describe('createWorktree: o que chega ao Git', () => {
  it('resolve a base, confere a branch e a pasta, e cria a partir do commit inteiro', async () => {
    respondWithFreeBranch();
    const worktreesRoot = temporaryFolder();
    const repoPath = temporaryFolder();

    const worktree = await createWorktree({ repoPath, worktreesRoot, names, baseRef: 'main' });

    const path = join(worktreesRoot, 'app', 'abcdef12-x');
    expect(worktree).toEqual({ path, branch: names.branch, baseCommit: SHA });
    expect(calls()).toEqual([
      ['rev-parse', '--verify', '--quiet', 'main^{commit}'],
      ['rev-parse', '--verify', '--quiet', `refs/heads/${names.branch}`],
      ['worktree', 'add', '-b', names.branch, path, SHA],
    ]);
    for (const call of execFileMock.mock.calls) {
      expect(call[2]).toMatchObject({ cwd: repoPath });
    }
  });

  it('branch que já existe é colisão, e o Git não chega a criar nada', async () => {
    respond((args) => (args[0] === 'rev-parse' ? { stdout: `${SHA}\n` } : {}));

    await expect(
      createWorktree({
        repoPath: temporaryFolder(),
        worktreesRoot: temporaryFolder(),
        names,
        baseRef: 'HEAD',
      }),
    ).rejects.toMatchObject({ name: 'GitError', code: 'WORKTREE_COLLISION' });

    expect(calls().some((args) => args[0] === 'worktree')).toBe(false);
  });

  it('pasta que já existe é colisão, e o Git não chega a criar nada', async () => {
    respondWithFreeBranch();
    const worktreesRoot = temporaryFolder();
    mkdirSync(join(worktreesRoot, 'app', 'abcdef12-x'), { recursive: true });

    await expect(
      createWorktree({ repoPath: temporaryFolder(), worktreesRoot, names, baseRef: 'HEAD' }),
    ).rejects.toMatchObject({ code: 'WORKTREE_COLLISION' });

    expect(calls().some((args) => args[0] === 'worktree')).toBe(false);
  });

  it('base que o Git não resolve vira WORKTREE_CREATE_FAILED, sem criar nada', async () => {
    respond(() => exitedWith(1, ''));

    await expect(
      createWorktree({
        repoPath: temporaryFolder(),
        worktreesRoot: temporaryFolder(),
        names,
        baseRef: 'nao-existe',
      }),
    ).rejects.toMatchObject({ name: 'GitError', code: 'WORKTREE_CREATE_FAILED' });

    expect(calls()).toHaveLength(1);
  });

  it('falha do worktree add vira WORKTREE_CREATE_FAILED, com o stderr e sem repeti-lo na mensagem', async () => {
    respond((args) => {
      if (args[0] === 'worktree') return exitedWith(128, 'fatal: conteudo do repositorio\n');
      return args[args.length - 1]?.startsWith('refs/heads/')
        ? exitedWith(1, '')
        : { stdout: `${SHA}\n` };
    });

    const error = await createWorktree({
      repoPath: temporaryFolder(),
      worktreesRoot: temporaryFolder(),
      names,
      baseRef: 'HEAD',
    }).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(GitError);
    expect(error).toMatchObject({
      code: 'WORKTREE_CREATE_FAILED',
      exitCode: 128,
      stderr: 'fatal: conteudo do repositorio\n',
    });
    expect((error as GitError).message).not.toContain('conteudo do repositorio');
  });

  it('tempo esgotado no worktree add também vira WORKTREE_CREATE_FAILED', async () => {
    respond((args) => {
      if (args[0] === 'worktree') {
        return { error: Object.assign(new Error('timed out'), { killed: true }) };
      }
      return args[args.length - 1]?.startsWith('refs/heads/')
        ? exitedWith(1, '')
        : { stdout: `${SHA}\n` };
    });

    await expect(
      createWorktree({
        repoPath: temporaryFolder(),
        worktreesRoot: temporaryFolder(),
        names,
        baseRef: 'HEAD',
      }),
    ).rejects.toMatchObject({ code: 'WORKTREE_CREATE_FAILED' });
  });

  it('Git ausente continua sendo GIT_NOT_AVAILABLE, e não falha de criação', async () => {
    respond(() => ({ error: Object.assign(new Error('spawn git ENOENT'), { code: 'ENOENT' }) }));

    await expect(
      createWorktree({
        repoPath: temporaryFolder(),
        worktreesRoot: temporaryFolder(),
        names,
        baseRef: 'HEAD',
      }),
    ).rejects.toMatchObject({ code: 'GIT_NOT_AVAILABLE' });
  });
});

describe('removeWorktree: primeira guarda, o status', () => {
  const repoPath = resolve('repo');
  const worktreePath = resolve(tmpdir(), 'raiz', 'app', 'abcdef12-x');

  it('com alteração, lança WORKTREE_HAS_UNSAVED_CHANGES e não chama worktree remove', async () => {
    respond(() => ({ stdout: DIRTY_STATUS }));

    await expect(removeWorktree({ repoPath, worktreePath })).rejects.toMatchObject({
      name: 'GitError',
      code: 'WORKTREE_HAS_UNSAVED_CHANGES',
    });

    // Só o status, lido na pasta do worktree. Nenhum `worktree`, com ou sem --force.
    expect(calls()).toHaveLength(1);
    expect(calls()[0]?.[0]).toBe('status');
    expect(execFileMock.mock.calls[0]?.[2]).toMatchObject({ cwd: worktreePath });
  });

  it('com o status falhando, a falha sobe e nada é removido', async () => {
    respond(() => exitedWith(128, 'fatal: not a git repository\n'));

    await expect(removeWorktree({ repoPath, worktreePath })).rejects.toMatchObject({
      code: 'UNKNOWN',
      exitCode: 128,
    });

    expect(calls().every((args) => args[0] === 'status')).toBe(true);
  });

  it('limpo, remove com worktree remove <pasta>, sem --force, a partir do repositório', async () => {
    respond((args) => (args[0] === 'status' ? { stdout: CLEAN_STATUS } : {}));

    await expect(removeWorktree({ repoPath, worktreePath })).resolves.toBeUndefined();

    const all = calls();
    expect(all).toHaveLength(2);
    expect(all[0]?.[0]).toBe('status');
    expect(all[1]).toEqual(['worktree', 'remove', worktreePath]);
    expect(all.flat()).not.toContain('--force');
    expect(all.flat()).not.toContain('-f');
    expect(execFileMock.mock.calls[0]?.[2]).toMatchObject({ cwd: worktreePath });
    expect(execFileMock.mock.calls[1]?.[2]).toMatchObject({ cwd: repoPath });
  });
});

describe('removeWorktree: segunda guarda, o Git sem --force', () => {
  const repoPath = resolve('repo');
  const worktreePath = resolve(tmpdir(), 'raiz', 'app', 'abcdef12-x');

  it('o Git recusar por arquivo modificado ou novo vira WORKTREE_HAS_UNSAVED_CHANGES', async () => {
    respond((args) =>
      args[0] === 'status'
        ? { stdout: CLEAN_STATUS }
        : exitedWith(
            128,
            `fatal: '${worktreePath}' contains modified or untracked files, use --force to delete it\n`,
          ),
    );

    await expect(removeWorktree({ repoPath, worktreePath })).rejects.toMatchObject({
      name: 'GitError',
      code: 'WORKTREE_HAS_UNSAVED_CHANGES',
      exitCode: 128,
    });
  });

  it('outra recusa do Git sobe como veio, sem virar alteração não salva', async () => {
    respond((args) =>
      args[0] === 'status'
        ? { stdout: CLEAN_STATUS }
        : exitedWith(128, `fatal: '${worktreePath}' is a main working tree\n`),
    );

    await expect(removeWorktree({ repoPath, worktreePath })).rejects.toMatchObject({
      name: 'GitError',
      code: 'UNKNOWN',
      exitCode: 128,
    });
  });
});
