import { execFile } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { initRepository } from '../src/init-repository';

// Unitário: o `execFile` é imitado, então nenhum Git roda aqui. O primeiro commit de verdade fica em
// init-repository.integration.test.ts. Aqui o que importa é o desfazer quando um passo falha (ADR 0009).
vi.mock('node:child_process', () => ({ execFile: vi.fn() }));

type Callback = (error: Error | null, stdout: string, stderr: string) => void;

const execFileMock = vi.mocked(execFile);

/**
 * Responde como o Git faria a cada passo: a identidade existe, `init` cria a pasta `.git`, `add` passa, e o
 * `commit` falha quando `failCommit` é verdadeiro. Os argumentos chegam depois do `-c core.fsmonitor=false`.
 */
function fakeGit(failCommit: boolean): void {
  execFileMock.mockImplementation(((
    _file: string,
    args: string[],
    options: { cwd: string },
    callback: Callback,
  ) => {
    const [, , subcommand] = args;
    if (subcommand === 'config') return callback(null, 'Teste\n', '');
    if (subcommand === 'init') {
      mkdirSync(join(options.cwd, '.git'));
      return callback(null, '', '');
    }
    if (subcommand === 'add') return callback(null, '', '');
    if (subcommand === 'commit' && failCommit) {
      return callback(Object.assign(new Error('falhou'), { code: 1 }), '', 'erro do commit');
    }
    return callback(null, '', '');
  }) as never);
}

describe('initRepository: desfazer em falha', () => {
  let folder: string;

  beforeEach(() => {
    folder = mkdtempSync(join(tmpdir(), 'project-hub-desfazer-'));
  });

  afterEach(() => {
    rmSync(folder, { recursive: true, force: true, maxRetries: 3 });
    execFileMock.mockReset();
  });

  it('um commit que falha remove o .git e o .gitignore criados, e a pasta volta como estava', async () => {
    fakeGit(true);

    await expect(initRepository({ path: folder })).rejects.toMatchObject({ code: 'UNKNOWN' });
    expect(existsSync(join(folder, '.git'))).toBe(false);
    expect(existsSync(join(folder, '.gitignore'))).toBe(false);
  });

  it('com o commit feito, nada é desfeito', async () => {
    fakeGit(false);

    await initRepository({ path: folder });
    expect(existsSync(join(folder, '.git'))).toBe(true);
    expect(existsSync(join(folder, '.gitignore'))).toBe(true);
  });

  it('os passos de escrita passam pela lista fixa: init, add e commit sem hooks', async () => {
    fakeGit(false);

    await initRepository({ path: folder });

    const subcommands = execFileMock.mock.calls.map((call) => (call[1] as string[]).slice(2));
    expect(subcommands).toEqual([
      ['config', '--get', 'user.name'],
      ['config', '--get', 'user.email'],
      ['init', '--initial-branch=main'],
      ['add', '--all'],
      ['commit', '--no-verify', '--allow-empty', '-m', 'Estado inicial do projeto'],
    ]);
  });
});
