import { execFile } from 'node:child_process';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { hasIgnoredFiles } from '../src/status';

// Unitário: o `execFile` é imitado e devolve a saída de `status --porcelain=v2 --ignored -z` que cada
// teste monta. O Git de verdade fica em worktree.integration.test.ts.
vi.mock('node:child_process', () => ({ execFile: vi.fn() }));

type Callback = (error: Error | null, stdout: string, stderr: string) => void;

const execFileMock = vi.mocked(execFile);
const cwd = import.meta.dirname;
const SHA = '0123456789abcdef0123456789abcdef01234567';

function respondWith(stdout: string): void {
  execFileMock.mockImplementation(((
    _file: string,
    _args: string[],
    _options: object,
    done: Callback,
  ) => {
    done(null, stdout, '');
  }) as unknown as typeof execFile);
}

afterEach(() => {
  execFileMock.mockReset();
});

describe('hasIgnoredFiles', () => {
  it('lê o status com --ignored, na pasta dada, numa chamada só', async () => {
    respondWith('');

    await hasIgnoredFiles(cwd);

    expect(execFileMock).toHaveBeenCalledTimes(1);
    const [, args, options] = execFileMock.mock.calls[0] as unknown as [
      string,
      string[],
      { cwd: string },
    ];
    // `--untracked-files=normal` é explícito: com `status.showUntrackedFiles=no` na configuração do
    // repositório, o `--ignored` sozinho não lista nada.
    expect(args.slice(2)).toEqual([
      'status',
      '--porcelain=v2',
      '--ignored',
      '--untracked-files=normal',
      '-z',
    ]);
    expect(options.cwd).toBe(cwd);
  });

  it('sem nenhum registro, não há arquivo ignorado', async () => {
    respondWith('');

    expect(await hasIgnoredFiles(cwd)).toBe(false);
  });

  it.each([
    ['um arquivo', '! .env\0'],
    ['uma pasta inteira', '! node_modules/\0'],
    ['um arquivo dentro de uma pasta', '! build/saida.js\0'],
    ['um nome com espaço e acento', '! Ação nova.txt\0'],
    [
      'ignorado depois de um arquivo alterado',
      `1 .M N... 100644 100644 100644 ${SHA} ${SHA} a.txt\0! .env\0`,
    ],
    ['ignorado depois de um arquivo novo', '? novo.txt\0! .env\0'],
  ])('com %s ignorado, diz que há', async (_case, output) => {
    respondWith(output);

    expect(await hasIgnoredFiles(cwd)).toBe(true);
  });

  it.each([
    ['arquivo alterado', `1 .M N... 100644 100644 100644 ${SHA} ${SHA} a.txt\0`],
    ['arquivo novo', '? novo.txt\0'],
    // O nome do arquivo é que começa com "!": o registro continua sendo `? `.
    ['arquivo novo cujo nome começa com !', '? !novo.txt\0'],
    ['arquivo novo cujo nome começa com "! "', '? ! novo.txt\0'],
    ['cabeçalho de branch', `# branch.oid ${SHA}\0# branch.head main\0`],
    ['arquivo em conflito', `u UU N... 100644 100644 100644 100644 ${SHA} ${SHA} ${SHA} a.txt\0`],
  ])('com %s e nenhum ignorado, diz que não há', async (_case, output) => {
    respondWith(output);

    expect(await hasIgnoredFiles(cwd)).toBe(false);
  });

  // Em `-z`, o registro de um renomeado traz o caminho antigo como um campo à parte, que não é um
  // registro: se o nome antigo começa com "! ", ele não pode contar como arquivo ignorado. O nome da
  // fixture tem o espaço depois do "!", o mesmo prefixo de um registro de ignorado: sem o pulo do
  // campo, o parser leria o caminho antigo como `! <caminho>`.
  it('o caminho antigo de um renomeado que começa com "! " não é um registro de ignorado', async () => {
    respondWith(`2 R. N... 100644 100644 100644 ${SHA} ${SHA} R100 novo.txt\0! antigo.txt\0`);

    expect(await hasIgnoredFiles(cwd)).toBe(false);
  });

  it('um ignorado depois de um renomeado com caminho antigo "! " ainda é visto', async () => {
    respondWith(
      `2 R. N... 100644 100644 100644 ${SHA} ${SHA} R100 novo.txt\0! antigo.txt\0! .env\0`,
    );

    expect(await hasIgnoredFiles(cwd)).toBe(true);
  });

  it('rejeita quando o Git falha, em vez de dizer que não há', async () => {
    execFileMock.mockImplementation(((
      _file: string,
      _args: string[],
      _options: object,
      done: Callback,
    ) => {
      done(Object.assign(new Error('Command failed'), { code: 128 }), '', 'fatal: algo\n');
    }) as unknown as typeof execFile);

    await expect(hasIgnoredFiles(cwd)).rejects.toMatchObject({ code: 'UNKNOWN', exitCode: 128 });
  });
});
