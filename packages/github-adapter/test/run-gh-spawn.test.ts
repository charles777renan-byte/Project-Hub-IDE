import { execFile } from 'node:child_process';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  MAX_COMMAND_LINE_CHARS,
  GhError,
  estimateCommandLineLength,
  runGh,
  toSpawnThrowError,
} from '../src/run-gh';

// Unitário: o `execFile` é imitado para lançar de forma síncrona, como o de verdade faz com uma linha de
// comando longa demais (`ENAMETOOLONG`) ou com um NUL (`ERR_INVALID_ARG_VALUE`).
vi.mock('node:child_process', async (importOriginal) => ({
  ...(await importOriginal<typeof import('node:child_process')>()),
  execFile: vi.fn(),
}));

const COMMENT = ['pr', 'comment', '12', '--body=oi'];

function throwing(code: string) {
  vi.mocked(execFile).mockImplementation(() => {
    throw Object.assign(new Error(`erro cru do Node com ${code} e C:\\caminho\\secreto`), { code });
  });
}

describe('throw síncrono do execFile', () => {
  beforeEach(() => {
    vi.mocked(execFile).mockReset();
  });

  it.each(['ENAMETOOLONG', 'E2BIG'])(
    '%s vira GhError VALIDATION_FAILED, com mensagem em português e sem o texto do Node',
    async (code) => {
      throwing(code);

      const error = await runGh(COMMENT, { cwd: process.cwd() }).catch((e: unknown) => e);

      expect(error).toBeInstanceOf(GhError);
      expect(error).toMatchObject({ code: 'VALIDATION_FAILED' });
      expect((error as GhError).message).toContain('grande demais');
      expect((error as GhError).message).not.toContain('secreto');
    },
  );

  it.each(['ERR_INVALID_ARG_VALUE', 'ERR_INVALID_ARG_TYPE'])(
    '%s vira GhError VALIDATION_FAILED',
    async (code) => {
      throwing(code);

      const error = await runGh(COMMENT, { cwd: process.cwd() }).catch((e: unknown) => e);

      expect(error).toBeInstanceOf(GhError);
      expect(error).toMatchObject({ code: 'VALIDATION_FAILED' });
      expect((error as GhError).message).not.toContain('secreto');
    },
  );

  it('qualquer outro throw vira GhError UNKNOWN com mensagem fixa', async () => {
    vi.mocked(execFile).mockImplementation(() => {
      throw new Error('algo que ninguém previu C:\\caminho\\secreto');
    });

    const error = await runGh(COMMENT, { cwd: process.cwd() }).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(GhError);
    expect(error).toMatchObject({
      code: 'UNKNOWN',
      message: 'Não foi possível executar o GitHub CLI.',
    });
  });

  it('também vale para algo lançado que nem é um Error', () => {
    expect(toSpawnThrowError('texto solto')).toMatchObject({ code: 'UNKNOWN' });
    expect(toSpawnThrowError(null)).toMatchObject({ code: 'UNKNOWN' });
  });

  it('o gh nunca é chamado quando a linha de comando já passa do limite', async () => {
    const error = await runGh(['pr', 'comment', '12', `--body=${'a'.repeat(40_000)}`], {
      cwd: process.cwd(),
    }).catch((e: unknown) => e);

    expect(error).toMatchObject({ code: 'VALIDATION_FAILED' });
    expect(execFile).not.toHaveBeenCalled();
  });
});

describe('estimativa da linha de comando', () => {
  it('conta cada argumento com 3 de acréscimo (aspas e espaço) e dobra aspas e barras invertidas', () => {
    expect(estimateCommandLineLength([])).toBe(0);
    expect(estimateCommandLineLength(['abc'])).toBe(6);
    expect(estimateCommandLineLength(['a"b'])).toBe(7);
    expect(estimateCommandLineLength(['a\\b'])).toBe(7);
    expect(estimateCommandLineLength(['pr', 'merge'])).toBe(5 + 8);
  });

  it('o limite deixa folga para o executável e as formas fixas sob os 32 767 do Windows', () => {
    expect(MAX_COMMAND_LINE_CHARS).toBeLessThanOrEqual(32_767 - 2_000);
  });
});
