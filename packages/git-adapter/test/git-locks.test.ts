import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  adminLockReason,
  gitAdminDir,
  INDEX_LOCK_RETRY_DELAYS_MS,
  withLockAwareness,
} from '../src/git-locks';
import { GitError } from '../src/run-git';

// Pastas reais na pasta temporária do sistema: a leitura de `.git`, `locked` e `index.lock` é o que
// está sendo testado, então nada aqui é imitado. O `sleep` é falso, para nenhum teste esperar de verdade.
const folders: string[] = [];

function newFolder(): string {
  const folder = mkdtempSync(join(tmpdir(), 'project-hub-travas-'));
  folders.push(folder);
  return folder;
}

/** Um repositório de mentira: só a pasta `.git`, que é tudo o que `withLockAwareness` olha. */
function fakeRepo(): { repo: string; admin: string } {
  const repo = newFolder();
  const admin = join(repo, '.git');
  mkdirSync(admin);
  return { repo, admin };
}

/** Um worktree de mentira: `.git` é um arquivo que aponta para a pasta administrativa. */
function fakeWorktree(): { worktree: string; admin: string } {
  const worktree = newFolder();
  const admin = newFolder();
  writeFileSync(join(worktree, '.git'), `gitdir: ${admin}\n`);
  return { worktree, admin };
}

/** A falha que o Git dá quando `index.lock` existe: o texto de `stderr` é o que identifica a trava. */
function indexLockError(admin: string): GitError {
  return new GitError('UNKNOWN', 'O comando "git worktree" terminou com erro (código 128).', {
    exitCode: 128,
    stderr: `fatal: Unable to create '${join(admin, 'index.lock')}': File exists.\n`,
  });
}

afterEach(() => {
  for (const folder of folders.splice(0)) rmSync(folder, { recursive: true, force: true });
});

describe('INDEX_LOCK_RETRY_DELAYS_MS', () => {
  it('espera 200, 400 e 800 ms', () => {
    expect(INDEX_LOCK_RETRY_DELAYS_MS).toEqual([200, 400, 800]);
  });
});

describe('gitAdminDir', () => {
  it('devolve a própria pasta .git quando ela é uma pasta', async () => {
    const { repo, admin } = fakeRepo();

    expect(await gitAdminDir(repo)).toBe(admin);
  });

  it('resolve gitdir relativo a partir da pasta do worktree', async () => {
    const worktree = newFolder();
    writeFileSync(join(worktree, '.git'), 'gitdir: ../repo/.git/worktrees/wt\n');

    expect(await gitAdminDir(worktree)).toBe(resolve(worktree, '../repo/.git/worktrees/wt'));
  });

  it('aceita gitdir absoluto', async () => {
    const { worktree, admin } = fakeWorktree();

    expect(await gitAdminDir(worktree)).toBe(admin);
  });

  it('devolve undefined sem .git, ou com um .git que não aponta para nada', async () => {
    const semGit = newFolder();
    const semLinha = newFolder();
    writeFileSync(join(semLinha, '.git'), 'qualquer coisa\n');

    expect(await gitAdminDir(semGit)).toBeUndefined();
    expect(await gitAdminDir(semLinha)).toBeUndefined();
  });
});

describe('adminLockReason', () => {
  it('devolve undefined quando não há arquivo locked', async () => {
    const { worktree } = fakeWorktree();

    expect(await adminLockReason(worktree)).toBeUndefined();
  });

  it('devolve o texto aparado do arquivo locked', async () => {
    const { worktree, admin } = fakeWorktree();
    writeFileSync(join(admin, 'locked'), '  em uso pela IDE\n');

    expect(await adminLockReason(worktree)).toBe('em uso pela IDE');
  });

  it('usa "sem motivo informado" quando o arquivo locked está vazio', async () => {
    const { worktree, admin } = fakeWorktree();
    writeFileSync(join(admin, 'locked'), '\n');

    expect(await adminLockReason(worktree)).toBe('sem motivo informado');
  });

  it('conta uma pasta que não é do Git como sem trava', async () => {
    expect(await adminLockReason(newFolder())).toBeUndefined();
  });
});

describe('withLockAwareness', () => {
  it('recusa com GIT_LOCKED e o motivo quando o worktree está travado, sem rodar o comando', async () => {
    const { repo } = fakeRepo();
    const { worktree, admin } = fakeWorktree();
    writeFileSync(join(admin, 'locked'), 'em uso pela IDE');
    const run = vi.fn();
    const sleep = vi.fn(async (_ms: number) => {});

    await expect(withLockAwareness({ repo, worktree }, run, { sleep })).rejects.toMatchObject({
      name: 'GitError',
      code: 'GIT_LOCKED',
      message: expect.stringContaining('em uso pela IDE'),
    });

    expect(run).not.toHaveBeenCalled();
    expect(sleep).not.toHaveBeenCalled();
  });

  it('usa "sem motivo informado" quando o arquivo locked está vazio', async () => {
    const { repo } = fakeRepo();
    const { worktree, admin } = fakeWorktree();
    writeFileSync(join(admin, 'locked'), '');

    await expect(
      withLockAwareness({ repo, worktree }, vi.fn(), { sleep: vi.fn(async (_ms: number) => {}) }),
    ).rejects.toMatchObject({
      code: 'GIT_LOCKED',
      message: `O worktree está travado pelo Git (sem motivo informado). Destrave-o com \`git worktree unlock ${worktree}\` e tente de novo.`,
    });
  });

  it('troca quebras de linha e espaços seguidos por um espaço só no motivo', async () => {
    const { repo } = fakeRepo();
    const { worktree, admin } = fakeWorktree();
    writeFileSync(join(admin, 'locked'), 'em uso\n\n  pela\r\n   IDE');

    await expect(
      withLockAwareness({ repo, worktree }, vi.fn(), { sleep: vi.fn(async (_ms: number) => {}) }),
    ).rejects.toMatchObject({
      code: 'GIT_LOCKED',
      message: expect.stringContaining('(em uso pela IDE)'),
    });
  });

  it('corta o motivo em 200 caracteres, com … no fim', async () => {
    const { repo } = fakeRepo();
    const { worktree, admin } = fakeWorktree();
    writeFileSync(join(admin, 'locked'), 'a'.repeat(300));
    const motivoCortado = `${'a'.repeat(199)}…`;

    await expect(
      withLockAwareness({ repo, worktree }, vi.fn(), { sleep: vi.fn(async (_ms: number) => {}) }),
    ).rejects.toMatchObject({
      code: 'GIT_LOCKED',
      message: `O worktree está travado pelo Git (${motivoCortado}). Destrave-o com \`git worktree unlock ${worktree}\` e tente de novo.`,
    });
  });

  it('confere a trava de novo quando o comando falha, e a trava vence o erro do Git', async () => {
    const { repo } = fakeRepo();
    const { worktree, admin } = fakeWorktree();
    const run = vi.fn(async () => {
      // O worktree foi travado enquanto o comando rodava.
      writeFileSync(join(admin, 'locked'), 'travado no meio');
      throw new GitError('UNKNOWN', 'falha do git');
    });

    await expect(
      withLockAwareness({ repo, worktree }, run, { sleep: vi.fn(async (_ms: number) => {}) }),
    ).rejects.toMatchObject({
      code: 'GIT_LOCKED',
      message: expect.stringContaining('travado no meio'),
    });

    expect(run).toHaveBeenCalledTimes(1);
  });

  it('devolve o resultado sem esperar quando o comando dá certo', async () => {
    const { repo } = fakeRepo();
    const sleep = vi.fn(async (_ms: number) => {});

    await expect(withLockAwareness({ repo }, async () => 'ok', { sleep })).resolves.toBe('ok');

    expect(sleep).not.toHaveBeenCalled();
  });

  it('tenta de novo depois de index.lock e devolve o resultado quando ele some', async () => {
    const { repo, admin } = fakeRepo();
    const lock = join(admin, 'index.lock');
    writeFileSync(lock, '');
    const sleep = vi.fn(async (_ms: number) => {
      rmSync(lock);
    });
    const run = vi
      .fn<() => Promise<string>>()
      .mockRejectedValueOnce(indexLockError(admin))
      .mockResolvedValueOnce('ok');

    await expect(withLockAwareness({ repo }, run, { sleep })).resolves.toBe('ok');

    expect(sleep).toHaveBeenCalledTimes(1);
    expect(sleep).toHaveBeenCalledWith(200);
    expect(run).toHaveBeenCalledTimes(2);
  });

  it('desiste com GIT_LOCKED depois de 200, 400 e 800 ms quando index.lock persiste', async () => {
    const { repo, admin } = fakeRepo();
    writeFileSync(join(admin, 'index.lock'), '');
    const sleep = vi.fn(async (_ms: number) => {});
    const original = indexLockError(admin);
    const run = vi.fn(async () => {
      throw original;
    });

    const error = await withLockAwareness({ repo }, run, { sleep }).catch(
      (caught: unknown) => caught,
    );

    expect(error).toBeInstanceOf(GitError);
    expect(error).toMatchObject({
      code: 'GIT_LOCKED',
      message: 'Outro processo do Git está usando o repositório. Feche-o e tente de novo.',
      // O que o chamador usa para classificar a falha continua à mão no erro novo.
      stderr: original.stderr,
      exitCode: 128,
    });
    // `toMatchObject` compara erros só pela mensagem: o `cause` tem que ser o próprio erro original.
    expect((error as GitError).cause).toBe(original);
    expect(sleep.mock.calls.map(([ms]) => ms)).toEqual([200, 400, 800]);
    expect(run).toHaveBeenCalledTimes(4);
  });

  it('respeita as esperas informadas', async () => {
    const { repo, admin } = fakeRepo();
    writeFileSync(join(admin, 'index.lock'), '');
    const sleep = vi.fn(async (_ms: number) => {});
    const run = vi.fn(async () => {
      throw indexLockError(admin);
    });

    await expect(withLockAwareness({ repo }, run, { delaysMs: [5], sleep })).rejects.toMatchObject({
      code: 'GIT_LOCKED',
    });

    expect(sleep.mock.calls.map(([ms]) => ms)).toEqual([5]);
    expect(run).toHaveBeenCalledTimes(2);
  });

  it('relança o erro original, sem esperar, quando o erro não é de index.lock, mesmo com o arquivo presente', async () => {
    const { repo, admin } = fakeRepo();
    writeFileSync(join(admin, 'index.lock'), '');
    // A recusa tardia do `git worktree remove`: o trabalho não salvo chegou depois do status.
    const erro = new GitError(
      'UNKNOWN',
      'O comando "git worktree" terminou com erro (código 128).',
      {
        exitCode: 128,
        stderr: "fatal: 'x' contains modified or untracked files, use --force to delete it\n",
      },
    );
    const sleep = vi.fn(async (_ms: number) => {});
    const run = vi.fn(async () => {
      throw erro;
    });

    await expect(withLockAwareness({ repo }, run, { sleep })).rejects.toBe(erro);

    expect(sleep).not.toHaveBeenCalled();
    expect(run).toHaveBeenCalledTimes(1);
  });

  it('relança o erro original quando o erro que não é GitError chega com index.lock presente', async () => {
    const { repo, admin } = fakeRepo();
    writeFileSync(join(admin, 'index.lock'), '');
    const erro = new Error('index.lock');
    const sleep = vi.fn(async (_ms: number) => {});

    await expect(
      withLockAwareness({ repo }, vi.fn().mockRejectedValue(erro), { sleep }),
    ).rejects.toBe(erro);

    expect(sleep).not.toHaveBeenCalled();
  });

  it('relança o erro original, sem esperar, quando não há trava', async () => {
    const { repo } = fakeRepo();
    const { worktree } = fakeWorktree();
    const erro = new GitError('WORKTREE_HAS_UNSAVED_CHANGES', 'x');
    const sleep = vi.fn(async (_ms: number) => {});
    const run = vi.fn(async () => {
      throw erro;
    });

    await expect(withLockAwareness({ repo, worktree }, run, { sleep })).rejects.toBe(erro);

    expect(sleep).not.toHaveBeenCalled();
    expect(run).toHaveBeenCalledTimes(1);
  });
});
