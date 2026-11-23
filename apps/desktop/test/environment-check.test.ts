import { describe, expect, it, vi } from 'vitest';
import { createEnvironmentCheck } from '../src/main/environment-check';

// A conferência do ambiente da tela de boas-vindas: o Git (por `git --version`) e a pasta das cópias de trabalho.

const ROOT = 'C:\\dados\\worktrees';

describe('createEnvironmentCheck', () => {
  it('com o Git respondendo, diz que está instalado e devolve a primeira linha da saída', async () => {
    const check = createEnvironmentCheck({
      worktreesRoot: ROOT,
      runGitVersion: () => Promise.resolve('git version 2.47.0.windows.1\r\nsegunda linha\r\n'),
    });

    expect(await check()).toEqual({
      git: { installed: true, version: 'git version 2.47.0.windows.1' },
      worktreesRoot: ROOT,
    });
  });

  it('sem o Git (o programa não roda), diz que não está instalado, sem versão', async () => {
    const check = createEnvironmentCheck({
      worktreesRoot: ROOT,
      runGitVersion: () => Promise.reject(new Error('spawn git ENOENT em C:\\Users\\alguem')),
    });

    expect(await check()).toEqual({ git: { installed: false }, worktreesRoot: ROOT });
  });

  it('saída vazia conta como instalado, sem versão a mostrar', async () => {
    const check = createEnvironmentCheck({
      worktreesRoot: ROOT,
      runGitVersion: () => Promise.resolve('  \n'),
    });

    expect(await check()).toEqual({ git: { installed: true }, worktreesRoot: ROOT });
  });

  it('corta a versão em 80 caracteres e tira os códigos do terminal', async () => {
    const check = createEnvironmentCheck({
      worktreesRoot: ROOT,
      runGitVersion: () => Promise.resolve(`\u001b[32mgit version ${'9'.repeat(200)}\u001b[0m\n`),
    });

    const { git } = await check();

    expect(git.version).toBe(`git version ${'9'.repeat(80)}`.slice(0, 80));
  });

  it('dois pedidos ao mesmo tempo rodam o Git uma vez só', async () => {
    let release: (output: string) => void = () => {};
    const runGitVersion = vi.fn(
      () =>
        new Promise<string>((resolve) => {
          release = resolve;
        }),
    );
    const check = createEnvironmentCheck({ worktreesRoot: ROOT, runGitVersion });

    const first = check();
    const second = check();
    release('git version 2.47.0\n');

    expect((await first).git.installed).toBe(true);
    expect((await second).git.installed).toBe(true);
    expect(runGitVersion).toHaveBeenCalledTimes(1);
  });

  it('cada conferência nova roda o Git de novo (a pessoa pode ter acabado de instalar)', async () => {
    const runGitVersion = vi
      .fn<() => Promise<string>>()
      .mockRejectedValueOnce(new Error('ENOENT'))
      .mockResolvedValue('git version 2.47.0\n');
    const check = createEnvironmentCheck({ worktreesRoot: ROOT, runGitVersion });

    expect((await check()).git.installed).toBe(false);
    expect((await check()).git).toEqual({ installed: true, version: 'git version 2.47.0' });
  });
});
