import { describe, expect, it } from 'vitest';
import {
  CHANNELS,
  ERROR_CODES,
  FILE_SIZE_LIMIT_BYTES,
  fileContentSchema,
  filesListInputSchema,
  filesPathInputSchema,
  filesSearchContentInputSchema,
  filesSearchNamesInputSchema,
  filesWriteInputSchema,
  responseSchemas,
} from '../src/index';

const version = { size: 10, mtimeMs: 1_700_000_000_000, hash: 'a'.repeat(64) };

describe('filesWriteInputSchema', () => {
  const base = { projectId: 'p1', path: 'src/a.ts', text: 'x', eol: 'lf', bom: false };

  it('aceita expected nulo, que cria um arquivo novo', () => {
    expect(filesWriteInputSchema.safeParse({ ...base, expected: null }).success).toBe(true);
  });

  it('aceita a versão lida como expected', () => {
    expect(filesWriteInputSchema.safeParse({ ...base, expected: version }).success).toBe(true);
  });

  it('recusa eol misto: quem grava escolhe lf ou crlf', () => {
    expect(filesWriteInputSchema.safeParse({ ...base, eol: 'mixed', expected: null }).success).toBe(
      false,
    );
  });

  it('exige a chave expected, mesmo que seja nula', () => {
    expect(filesWriteInputSchema.safeParse(base).success).toBe(false);
  });
});

describe('filesPathInputSchema', () => {
  it('recusa caminho vazio e caminho com mais de 1024 caracteres', () => {
    expect(filesPathInputSchema.safeParse({ projectId: 'p1', path: '' }).success).toBe(false);
    expect(
      filesPathInputSchema.safeParse({ projectId: 'p1', path: 'a'.repeat(1025) }).success,
    ).toBe(false);
    expect(
      filesPathInputSchema.safeParse({ projectId: 'p1', path: 'a'.repeat(1024) }).success,
    ).toBe(true);
  });
});

describe('filesListInputSchema', () => {
  it('aceita dir vazio, que é a raiz do projeto', () => {
    expect(filesListInputSchema.safeParse({ projectId: 'p1', dir: '' }).success).toBe(true);
  });
});

describe('consultas de busca', () => {
  it('limitam a consulta a 200 caracteres', () => {
    expect(
      filesSearchNamesInputSchema.safeParse({ projectId: 'p1', query: 'a'.repeat(201) }).success,
    ).toBe(false);
    expect(
      filesSearchContentInputSchema.safeParse({
        projectId: 'p1',
        query: 'a'.repeat(200),
        regex: true,
      }).success,
    ).toBe(true);
  });
});

describe('fileContentSchema', () => {
  const content = { text: 'a\nb', eol: 'lf', bom: false, version };

  it('aceita lf, crlf e mixed', () => {
    for (const eol of ['lf', 'crlf', 'mixed']) {
      expect(fileContentSchema.safeParse({ ...content, eol }).success).toBe(true);
    }
  });

  it('recusa eol cr', () => {
    expect(fileContentSchema.safeParse({ ...content, eol: 'cr' }).success).toBe(false);
  });
});

describe('contrato de arquivos', () => {
  it('fixa o limite de arquivo editável em 2 MiB', () => {
    expect(FILE_SIZE_LIMIT_BYTES).toBe(2 * 1024 * 1024);
  });

  it('ERROR_CODES contém os quatro códigos de arquivo', () => {
    expect(ERROR_CODES).toEqual(
      expect.arrayContaining([
        'FILE_NOT_FOUND',
        'FILE_TOO_LARGE',
        'FILE_NOT_TEXT',
        'FILE_CHANGED_ON_DISK',
      ]),
    );
  });

  it('versiona os canais e dá a cada um um schema de resposta', () => {
    expect(CHANNELS.filesWrite).toBe('files:write:v1');
    const channels = [
      CHANNELS.filesList,
      CHANNELS.filesStat,
      CHANNELS.filesRead,
      CHANNELS.filesWrite,
      CHANNELS.filesSearchNames,
      CHANNELS.filesSearchContent,
      CHANNELS.filesOpenDefault,
    ];
    for (const channel of channels) {
      expect(channel).toMatch(/^files:[a-z-]+:v1$/);
      expect(responseSchemas).toHaveProperty([channel]);
    }
  });

  it('o schema de files:stat aceita arquivo ausente e arquivo com versão', () => {
    const schema = responseSchemas[CHANNELS.filesStat];
    expect(schema.safeParse({ ok: true, data: { exists: false } }).success).toBe(true);
    expect(schema.safeParse({ ok: true, data: { exists: true, version } }).success).toBe(true);
    expect(schema.safeParse({ ok: true, data: { exists: true } }).success).toBe(false);
  });
});
