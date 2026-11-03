import { chmod, mkdir, mkdtemp, readdir, readFile, rm, utimes, writeFile } from 'node:fs/promises';
import type * as FsPromises from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FILE_SIZE_LIMIT_BYTES } from '@project-hub/contracts';
import { FilesError } from '../src/main/files/files-error';
import {
  applyEol,
  detectEol,
  readProjectFile,
  statProjectFile,
  writeProjectFile,
} from '../src/main/files/file-io';

/** Falhas injetadas em `rename`: com `failures` acima de zero, a troca recusa com o código `code` (EPERM por padrão). */
const renameBlock = vi.hoisted(() => ({ failures: 0, calls: 0, code: 'EPERM' }));

vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof FsPromises>();
  return {
    ...actual,
    rename: async (from: string, to: string) => {
      renameBlock.calls += 1;
      if (renameBlock.failures > 0) {
        renameBlock.failures -= 1;
        throw Object.assign(new Error(`${renameBlock.code}: operação recusada`), { code: renameBlock.code });
      }
      return actual.rename(from, to);
    },
  };
});

/** Um instante redondo, em segundos: sem fração, o mtime volta idêntico depois de um `utimes`. */
const FIXED_MTIME_S = 1_700_000_000;

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'Pasta com espaço e acentuação-'));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

async function expectFilesError(promise: Promise<unknown>, code: string): Promise<FilesError> {
  const error = await promise.then(
    () => undefined,
    (caught: unknown) => caught,
  );
  expect(error).toBeInstanceOf(FilesError);
  expect((error as FilesError).code).toBe(code);
  return error as FilesError;
}

describe('detectEol e applyEol', () => {
  it('detectEol: lf sem quebra, lf com quebras, crlf e misto', () => {
    expect(detectEol('')).toBe('lf');
    expect(detectEol('uma linha')).toBe('lf');
    expect(detectEol('a\nb\n')).toBe('lf');
    expect(detectEol('a\r\nb\r\n')).toBe('crlf');
    expect(detectEol('a\r\nb\n')).toBe('mixed');
    expect(detectEol('a\nb\r\n')).toBe('mixed');
  });

  it('detectEol: um CR solto (sem LF depois) é misto, porque o editor o reescreveria', () => {
    expect(detectEol('a\rb\n')).toBe('mixed');
    expect(detectEol('x\r\ny\rz\r\n')).toBe('mixed');
    expect(detectEol('a\rb')).toBe('mixed');
    expect(detectEol('a\r\n\r')).toBe('mixed');
    expect(detectEol('a\r\r\nb')).toBe('mixed');
  });

  it('applyEol: converte \\n para o fim de linha pedido sem duplicar o \\r', () => {
    expect(applyEol('a\nb\n', 'lf')).toBe('a\nb\n');
    expect(applyEol('a\nb\n', 'crlf')).toBe('a\r\nb\r\n');
    expect(applyEol('a\r\nb\n', 'crlf')).toBe('a\r\nb\r\n');
    expect(applyEol('a\r\nb\n', 'lf')).toBe('a\nb\n');
  });
});

describe('readProjectFile', () => {
  it('tira o BOM, detecta CRLF e devolve o texto com \\n', async () => {
    const file = join(dir, 'a.txt');
    await writeFile(file, '﻿a\r\nb\r\n');
    const content = await readProjectFile(file);
    expect(content.text).toBe('a\nb\n');
    expect(content.eol).toBe('crlf');
    expect(content.bom).toBe(true);
    expect(content.version.size).toBe(Buffer.byteLength('﻿a\r\nb\r\n'));
    expect(content.version.hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('arquivo sem BOM e só com LF', async () => {
    const file = join(dir, 'a.txt');
    await writeFile(file, 'a\nb\n');
    const content = await readProjectFile(file);
    expect(content).toMatchObject({ text: 'a\nb\n', eol: 'lf', bom: false });
  });

  it('fim de linha misto vira eol mixed, com o texto normalizado para \\n', async () => {
    const file = join(dir, 'a.txt');
    await writeFile(file, 'a\r\nb\n');
    const content = await readProjectFile(file);
    expect(content.eol).toBe('mixed');
    expect(content.text).toBe('a\nb\n');
  });

  it('um CR solto no arquivo vira eol mixed, e o texto mantém o CR para o editor abrir só leitura', async () => {
    const file = join(dir, 'a.txt');
    await writeFile(file, 'x\r\ny\rz\r\n');
    const content = await readProjectFile(file);
    expect(content.eol).toBe('mixed');
    expect(content.text).toBe('x\ny\rz\n');
  });

  it('recusa FILE_NOT_TEXT para bytes ff fe 00 (UTF-16)', async () => {
    const file = join(dir, 'utf16.txt');
    await writeFile(file, Buffer.from([0xff, 0xfe, 0x00]));
    await expectFilesError(readProjectFile(file), 'FILE_NOT_TEXT');
  });

  it('recusa FILE_NOT_TEXT para byte NUL nos primeiros 8 KiB', async () => {
    const file = join(dir, 'bin.dat');
    await writeFile(file, 'texto\0texto');
    await expectFilesError(readProjectFile(file), 'FILE_NOT_TEXT');
  });

  it('recusa FILE_NOT_TEXT para UTF-8 inválido', async () => {
    const file = join(dir, 'latin1.txt');
    await writeFile(file, Buffer.from([0x61, 0xe9, 0x62]));
    await expectFilesError(readProjectFile(file), 'FILE_NOT_TEXT');
  });

  it('recusa FILE_NOT_TEXT para uma pasta', async () => {
    await mkdir(join(dir, 'pasta'));
    await expectFilesError(readProjectFile(join(dir, 'pasta')), 'FILE_NOT_TEXT');
  });

  it('aceita exatamente 2 MiB e recusa FILE_TOO_LARGE com 1 byte a mais', async () => {
    const ok = join(dir, 'ok.txt');
    const big = join(dir, 'big.txt');
    await writeFile(ok, 'a'.repeat(FILE_SIZE_LIMIT_BYTES));
    await writeFile(big, 'a'.repeat(FILE_SIZE_LIMIT_BYTES + 1));
    expect((await readProjectFile(ok)).version.size).toBe(FILE_SIZE_LIMIT_BYTES);
    await expectFilesError(readProjectFile(big), 'FILE_TOO_LARGE');
  });

  it('arquivo ausente é FILE_NOT_FOUND, sem caminho na mensagem', async () => {
    const error = await expectFilesError(readProjectFile(join(dir, 'nao-existe.txt')), 'FILE_NOT_FOUND');
    expect(error.message).not.toContain(dir);
  });
});

describe('writeProjectFile', () => {
  it('gravar o que foi lido, sem mudar nada, reproduz os mesmos bytes (CRLF e BOM)', async () => {
    const file = join(dir, 'a.txt');
    const original = Buffer.from('﻿a\r\nb\r\nação\r\n', 'utf8');
    await writeFile(file, original);
    const content = await readProjectFile(file);
    if (content.eol === 'mixed') throw new Error('esperava eol uniforme');
    const version = await writeProjectFile(file, {
      text: content.text,
      eol: content.eol,
      bom: content.bom,
      expected: content.version,
    });
    expect((await readFile(file)).equals(original)).toBe(true);
    expect(version.hash).toBe(content.version.hash);
    expect(version.size).toBe(original.length);
  });

  it('grava texto novo com o fim de linha e o BOM pedidos, e devolve a versão do disco', async () => {
    const file = join(dir, 'a.txt');
    await writeFile(file, 'velho\n');
    const before = await statProjectFile(file);
    if (!before.exists) throw new Error('esperava o arquivo');
    const version = await writeProjectFile(file, {
      text: 'novo\nlinha\n',
      eol: 'crlf',
      bom: true,
      expected: before.version,
    });
    expect((await readFile(file)).toString('utf8')).toBe('﻿novo\r\nlinha\r\n');
    const after = await statProjectFile(file);
    expect(after).toEqual({ exists: true, version });
  });

  it('versão desatualizada: FILE_CHANGED_ON_DISK e o arquivo não é alterado', async () => {
    const file = join(dir, 'a.txt');
    await writeFile(file, 'versão 1\n');
    const content = await readProjectFile(file);
    await writeFile(file, 'versão 2\n'); // outro processo
    await expectFilesError(
      writeProjectFile(file, { text: 'minha edição\n', eol: 'lf', bom: false, expected: content.version }),
      'FILE_CHANGED_ON_DISK',
    );
    expect(await readFile(file, 'utf8')).toBe('versão 2\n');
    expect((await readdir(dir)).sort()).toEqual(['a.txt']);
  });

  it('conteúdo diferente com o mesmo tamanho e o mesmo mtime também é conflito', async () => {
    const file = join(dir, 'a.txt');
    await writeFile(file, 'aaaa\n');
    await utimes(file, FIXED_MTIME_S, FIXED_MTIME_S);
    const before = await statProjectFile(file);
    if (!before.exists) throw new Error('esperava o arquivo');
    await writeFile(file, 'bbbb\n');
    await utimes(file, FIXED_MTIME_S, FIXED_MTIME_S);
    await expectFilesError(
      writeProjectFile(file, { text: 'x\n', eol: 'lf', bom: false, expected: before.version }),
      'FILE_CHANGED_ON_DISK',
    );
    expect(await readFile(file, 'utf8')).toBe('bbbb\n');
  });

  it('arquivo apagado com expected não nulo: FILE_CHANGED_ON_DISK, sem criar', async () => {
    const file = join(dir, 'a.txt');
    await writeFile(file, 'a\n');
    const content = await readProjectFile(file);
    await rm(file);
    await expectFilesError(
      writeProjectFile(file, { text: 'a\n', eol: 'lf', bom: false, expected: content.version }),
      'FILE_CHANGED_ON_DISK',
    );
    expect(await readdir(dir)).toEqual([]);
  });

  it('expected null cria o arquivo quando ele não existe', async () => {
    const file = join(dir, 'novo.txt');
    const version = await writeProjectFile(file, { text: 'oi\n', eol: 'lf', bom: false, expected: null });
    expect(await readFile(file, 'utf8')).toBe('oi\n');
    expect(version.size).toBe(3);
    expect(await readdir(dir)).toEqual(['novo.txt']);
  });

  it('expected null com o arquivo já existente: FILE_CHANGED_ON_DISK, sem gravar', async () => {
    const file = join(dir, 'a.txt');
    await writeFile(file, 'existe\n');
    await expectFilesError(
      writeProjectFile(file, { text: 'outro\n', eol: 'lf', bom: false, expected: null }),
      'FILE_CHANGED_ON_DISK',
    );
    expect(await readFile(file, 'utf8')).toBe('existe\n');
  });

  it('recusa FILE_TOO_LARGE para texto acima de 2 MiB (em bytes) e não grava', async () => {
    const file = join(dir, 'a.txt');
    await writeFile(file, 'a\n');
    const content = await readProjectFile(file);
    // 'é' ocupa 2 bytes em UTF-8: o texto tem menos de 2 MiB em caracteres e mais em bytes.
    const text = 'é'.repeat(FILE_SIZE_LIMIT_BYTES / 2 + 1);
    expect(text.length).toBeLessThan(FILE_SIZE_LIMIT_BYTES);
    await expectFilesError(
      writeProjectFile(file, { text, eol: 'lf', bom: false, expected: content.version }),
      'FILE_TOO_LARGE',
    );
    expect(await readFile(file, 'utf8')).toBe('a\n');
    expect((await readdir(dir)).sort()).toEqual(['a.txt']);
  });

  it('a conversão para CRLF conta nos bytes: o limite vale para o que vai ao disco', async () => {
    const file = join(dir, 'novo.txt');
    const text = '\n'.repeat(FILE_SIZE_LIMIT_BYTES / 2 + 1);
    await expectFilesError(
      writeProjectFile(file, { text, eol: 'crlf', bom: false, expected: null }),
      'FILE_TOO_LARGE',
    );
    expect(await readdir(dir)).toEqual([]);
  });

  it('arquivo somente leitura: erro com mensagem segura, arquivo intacto e nenhum .tmp na pasta', async () => {
    const file = join(dir, 'a.txt');
    await writeFile(file, 'protegido\n');
    const content = await readProjectFile(file);
    await chmod(file, 0o444);
    try {
      const error = await expectFilesError(
        writeProjectFile(file, { text: 'tentativa\n', eol: 'lf', bom: false, expected: content.version }),
        'PERMISSION_DENIED',
      );
      expect(error.message).not.toContain(dir);
      expect(await readFile(file, 'utf8')).toBe('protegido\n');
      expect(await readdir(dir)).toEqual(['a.txt']);
    } finally {
      await chmod(file, 0o644);
    }
  });

  it('um rename recusado com EPERM uma vez é repetido e a gravação sai certa', async () => {
    const file = join(dir, 'a.txt');
    await writeFile(file, 'antes\n');
    const content = await readProjectFile(file);
    renameBlock.failures = 1;
    renameBlock.calls = 0;
    await writeProjectFile(file, { text: 'depois\n', eol: 'lf', bom: false, expected: content.version });
    expect(renameBlock.calls).toBe(2);
    expect(await readFile(file, 'utf8')).toBe('depois\n');
    expect(await readdir(dir)).toEqual(['a.txt']);
  });

  it('EPERM que não passa: PERMISSION_DENIED depois de 10 tentativas, arquivo intacto e nenhum .tmp', async () => {
    const file = join(dir, 'a.txt');
    await writeFile(file, 'antes\n');
    const content = await readProjectFile(file);
    renameBlock.failures = 1_000;
    renameBlock.calls = 0;
    try {
      const error = await expectFilesError(
        writeProjectFile(file, { text: 'depois\n', eol: 'lf', bom: false, expected: content.version }),
        'PERMISSION_DENIED',
      );
      expect(error.message).not.toContain(dir);
      expect(renameBlock.calls).toBe(10);
      expect(await readFile(file, 'utf8')).toBe('antes\n');
      expect(await readdir(dir)).toEqual(['a.txt']);
    } finally {
      renameBlock.failures = 0;
    }
  });

  it('erro que não é transitório (ENOENT) não é repetido: FILE_NOT_FOUND na primeira tentativa', async () => {
    const file = join(dir, 'a.txt');
    await writeFile(file, 'antes\n');
    const content = await readProjectFile(file);
    renameBlock.failures = 1_000;
    renameBlock.code = 'ENOENT';
    renameBlock.calls = 0;
    try {
      await expectFilesError(
        writeProjectFile(file, { text: 'depois\n', eol: 'lf', bom: false, expected: content.version }),
        'FILE_NOT_FOUND',
      );
      expect(renameBlock.calls).toBe(1);
      expect(await readdir(dir)).toEqual(['a.txt']);
    } finally {
      renameBlock.failures = 0;
      renameBlock.code = 'EPERM';
    }
  });
});

describe('statProjectFile', () => {
  it('arquivo ausente é { exists: false }, não erro', async () => {
    expect(await statProjectFile(join(dir, 'nada.txt'))).toEqual({ exists: false });
  });

  it('arquivo existente traz a versão, igual à da leitura', async () => {
    const file = join(dir, 'a.txt');
    await writeFile(file, 'a\r\n');
    const stated = await statProjectFile(file);
    const read = await readProjectFile(file);
    expect(stated).toEqual({ exists: true, version: read.version });
  });

  it('o hash muda quando o conteúdo muda, mesmo com o mtimeMs igual', async () => {
    const file = join(dir, 'a.txt');
    await writeFile(file, 'aaaa\n');
    await utimes(file, FIXED_MTIME_S, FIXED_MTIME_S);
    const first = await statProjectFile(file);
    if (!first.exists) throw new Error('esperava o arquivo');
    await writeFile(file, 'bbbb\n');
    await utimes(file, FIXED_MTIME_S, FIXED_MTIME_S);
    const second = await statProjectFile(file);
    if (!second.exists) throw new Error('esperava o arquivo');
    expect(second.version.mtimeMs).toBe(first.version.mtimeMs);
    expect(second.version.size).toBe(first.version.size);
    expect(second.version.hash).not.toBe(first.version.hash);
  });

  it('calcula a versão de um arquivo maior que 2 MiB sem recusar', async () => {
    const file = join(dir, 'grande.txt');
    await writeFile(file, 'a'.repeat(FILE_SIZE_LIMIT_BYTES + 10));
    const stated = await statProjectFile(file);
    expect(stated.exists).toBe(true);
  });

  it('uma pasta no caminho é FILE_NOT_TEXT', async () => {
    await mkdir(join(dir, 'pasta'));
    await expectFilesError(statProjectFile(join(dir, 'pasta')), 'FILE_NOT_TEXT');
  });
});
