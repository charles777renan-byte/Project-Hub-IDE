import { existsSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createTempRepo, type TempRepo } from '@project-hub/test-utils';
import { afterEach, describe, expect, it } from 'vitest';
import { GitError, runGit } from '../src/run-git';

// Git real: confere que os erros do Node têm o formato que o `runGit` espera. Os casos com o
// `execFile` imitado ficam em run-git.test.ts.

const repos: TempRepo[] = [];
const folders: string[] = [];

function repo(): TempRepo {
  const made = createTempRepo();
  repos.push(made);
  return made;
}

/** Pasta comum na pasta temporária do sistema, fora de qualquer repositório. */
function plainFolder(): string {
  const folder = mkdtempSync(join(tmpdir(), 'project-hub-run-git-'));
  folders.push(folder);
  return folder;
}

afterEach(() => {
  for (const made of repos.splice(0)) made.cleanup();
  for (const folder of folders.splice(0)) rmSync(folder, { recursive: true, force: true });
});

describe('runGit com o Git do sistema', () => {
  it('devolve a saída do comando', async () => {
    const { path } = repo();

    expect(await runGit(['rev-parse', '--is-inside-work-tree'], { cwd: path })).toEqual({
      stdout: 'true\n',
    });
  });

  it('comando que termina com erro vira GitError com exitCode e stderr, fora da mensagem', async () => {
    const error = await runGit(['rev-parse', 'HEAD'], { cwd: plainFolder() }).catch(
      (caught: unknown) => caught,
    );

    expect(error).toBeInstanceOf(GitError);
    expect(error).toMatchObject({ code: 'UNKNOWN', exitCode: 128 });
    expect((error as GitError).stderr).toContain('not a git repository');
    expect((error as GitError).message).not.toContain('not a git repository');
  });

  it('estouro do tempo limite mata o Git e vira GitError', async () => {
    // 1 ms: o Git não chega a terminar, e o Node o interrompe.
    await expect(runGit(['status'], { cwd: plainFolder(), timeoutMs: 1 })).rejects.toMatchObject({
      code: 'UNKNOWN',
      message: expect.stringContaining('interrompido'),
    });
  });

  // Sem shell, o texto de um argumento é só um argumento: `&` e `>` não viram comando nem redirecionamento.
  it('argumento com caracteres de shell não executa nada', async () => {
    const { path } = repo();

    await expect(
      runGit(['rev-parse', 'HEAD & echo invadido > marcador.txt'], { cwd: path }),
    ).rejects.toMatchObject({ exitCode: 128 });

    expect(existsSync(join(path, 'marcador.txt'))).toBe(false);
  });

  it('pasta com espaço, acento e caracteres de shell no nome funciona', async () => {
    const { path } = repo();
    const named = join(path, 'Ação & Hub; (1)');
    mkdirSync(named);

    expect(await runGit(['rev-parse', '--is-inside-work-tree'], { cwd: named })).toEqual({
      stdout: 'true\n',
    });
  });
});
