import { createHash, randomBytes } from 'node:crypto';
import { constants, createReadStream } from 'node:fs';
import { access, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import {
  FILE_ERROR_MESSAGES,
  FILE_SIZE_LIMIT_BYTES,
  type ErrorCode,
  type FileContentDto,
  type FileStatDto,
  type FileVersionDto,
} from '@project-hub/contracts';
import { FilesError } from './files-error';

/** Quantos bytes do começo entram na procura por NUL: o mesmo critério que o Git usa para "binário". */
const BINARY_SCAN_BYTES = 8 * 1024;

const BOM = Buffer.from([0xef, 0xbb, 0xbf]);

const PERMISSION_MESSAGE = 'O sistema não permitiu acessar o arquivo.';
const UNKNOWN_MESSAGE = 'Não foi possível ler ou gravar o arquivo.';

function filesError(code: keyof typeof FILE_ERROR_MESSAGES): FilesError {
  return new FilesError(code, FILE_ERROR_MESSAGES[code]);
}

/**
 * Traduz o erro do sistema de arquivos num `FilesError` de mensagem fixa. A mensagem original traz o
 * caminho absoluto e não sai daqui.
 */
function toFilesError(error: unknown): FilesError {
  if (error instanceof FilesError) return error;
  const code = typeof error === 'object' && error !== null && 'code' in error ? error.code : undefined;
  switch (code) {
    case 'ENOENT':
    case 'ENOTDIR':
      return filesError('FILE_NOT_FOUND');
    case 'EISDIR':
      return filesError('FILE_NOT_TEXT');
    case 'EACCES':
    case 'EPERM':
    case 'EROFS':
      return new FilesError('PERMISSION_DENIED' satisfies ErrorCode, PERMISSION_MESSAGE);
    default:
      return new FilesError('UNKNOWN' satisfies ErrorCode, UNKNOWN_MESSAGE);
  }
}

function sha256(bytes: Buffer): string {
  return createHash('sha256').update(bytes).digest('hex');
}

/** Hash por fluxo: serve para arquivos de qualquer tamanho sem carregá-los inteiros na memória. */
function sha256OfFile(absolute: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = createHash('sha256');
    createReadStream(absolute)
      .on('error', reject)
      .on('data', (chunk) => hash.update(chunk))
      .on('end', () => resolve(hash.digest('hex')));
  });
}

/**
 * Fim de linha de um texto: `crlf` se todo `\n` vem precedido de `\r`, `lf` se nenhum vem (inclusive
 * sem quebra alguma) e `mixed` nos demais casos.
 */
export function detectEol(text: string): 'lf' | 'crlf' | 'mixed' {
  const total = text.match(/\n/g)?.length ?? 0;
  const crlf = text.match(/\r\n/g)?.length ?? 0;
  if (crlf === 0) return 'lf';
  return crlf === total ? 'crlf' : 'mixed';
}

/** Converte as quebras do texto para `eol`, sem duplicar o `\r` de quem já vem em CRLF. */
export function applyEol(text: string, eol: 'lf' | 'crlf'): string {
  const normalized = text.replace(/\r\n/g, '\n');
  return eol === 'crlf' ? normalized.replace(/\n/g, '\r\n') : normalized;
}

async function statRegularFile(absolute: string) {
  let info;
  try {
    info = await stat(absolute);
  } catch (error) {
    throw toFilesError(error);
  }
  // Pasta, dispositivo ou fifo: não é um arquivo que o editor abra.
  if (!info.isFile()) throw filesError('FILE_NOT_TEXT');
  return info;
}

/**
 * Lê um arquivo de texto do projeto. Recusa o que passa de 2 MiB (`FILE_TOO_LARGE`) e o que não é
 * UTF-8 de texto (`FILE_NOT_TEXT`). O texto sai sem BOM e com `\n`; `eol` e `bom` guardam o que havia.
 */
export async function readProjectFile(absolute: string): Promise<FileContentDto> {
  const info = await statRegularFile(absolute);
  // Recusa pelo tamanho antes de ler: um arquivo de gigabytes não deve entrar na memória.
  if (info.size > FILE_SIZE_LIMIT_BYTES) throw filesError('FILE_TOO_LARGE');

  let bytes: Buffer;
  try {
    bytes = await readFile(absolute);
  } catch (error) {
    throw toFilesError(error);
  }
  // O arquivo pode ter crescido entre o stat e a leitura.
  if (bytes.length > FILE_SIZE_LIMIT_BYTES) throw filesError('FILE_TOO_LARGE');
  if (bytes.subarray(0, BINARY_SCAN_BYTES).includes(0)) throw filesError('FILE_NOT_TEXT');

  const bom = bytes.subarray(0, BOM.length).equals(BOM);
  let decoded: string;
  try {
    decoded = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(
      bom ? bytes.subarray(BOM.length) : bytes,
    );
  } catch {
    throw filesError('FILE_NOT_TEXT');
  }

  return {
    text: decoded.replace(/\r\n/g, '\n'),
    eol: detectEol(decoded),
    bom,
    // A versão fica no `stat` da leitura: o `mtimeMs` e o tamanho vêm do mesmo momento dos bytes.
    version: { size: bytes.length, mtimeMs: info.mtimeMs, hash: sha256(bytes) },
  };
}

/** Versão do arquivo no disco. Arquivo que não existe é `{ exists: false }`, não erro. */
export async function statProjectFile(absolute: string): Promise<FileStatDto> {
  let info;
  try {
    info = await stat(absolute);
  } catch (error) {
    const mapped = toFilesError(error);
    if (mapped.code === 'FILE_NOT_FOUND') return { exists: false };
    throw mapped;
  }
  if (!info.isFile()) throw filesError('FILE_NOT_TEXT');
  try {
    const hash = await sha256OfFile(absolute);
    return { exists: true, version: { size: info.size, mtimeMs: info.mtimeMs, hash } };
  } catch (error) {
    const mapped = toFilesError(error);
    // Apagado entre o stat e o hash.
    if (mapped.code === 'FILE_NOT_FOUND') return { exists: false };
    throw mapped;
  }
}

/**
 * Confere que o disco ainda está na versão `expected`. Quem decide é o conteúdo (tamanho e hash): um
 * `mtimeMs` diferente com os mesmos bytes não é conflito. `expected: null` espera o arquivo ausente.
 */
async function assertUnchanged(absolute: string, expected: FileVersionDto | null): Promise<void> {
  const current = await statProjectFile(absolute);
  if (!current.exists) {
    if (expected !== null) throw filesError('FILE_CHANGED_ON_DISK');
    return;
  }
  if (
    expected === null ||
    current.version.size !== expected.size ||
    current.version.hash !== expected.hash
  ) {
    throw filesError('FILE_CHANGED_ON_DISK');
  }
}

/**
 * Grava o arquivo se o disco ainda estiver na versão `expected`; senão lança `FILE_CHANGED_ON_DISK` e não
 * mexe em nada. Reconverte o `\n` para `eol`, repõe o BOM e troca o arquivo de uma vez: grava num
 * temporário na mesma pasta e faz `rename`, de modo que uma falha no meio não deixa o arquivo pela metade.
 */
export async function writeProjectFile(
  absolute: string,
  input: { text: string; eol: 'lf' | 'crlf'; bom: boolean; expected: FileVersionDto | null },
): Promise<FileVersionDto> {
  const body = Buffer.from(applyEol(input.text, input.eol), 'utf8');
  const bytes = input.bom ? Buffer.concat([BOM, body]) : body;
  // O limite vale para o que vai ao disco: o BOM e o CRLF também contam.
  if (bytes.length > FILE_SIZE_LIMIT_BYTES) throw filesError('FILE_TOO_LARGE');

  await assertUnchanged(absolute, input.expected);

  // O `rename` troca um arquivo somente leitura sem reclamar em sistemas POSIX; a gravação não pode.
  // No Windows o `access` enxerga o atributo de somente leitura.
  let mode: number | undefined;
  if (input.expected !== null) {
    try {
      await access(absolute, constants.W_OK);
      mode = (await stat(absolute)).mode & 0o777;
    } catch (error) {
      throw toFilesError(error);
    }
  }

  const temporary = join(dirname(absolute), `.${basename(absolute)}.${randomBytes(6).toString('hex')}.tmp`);
  try {
    // `wx` não sobrescreve; o modo do arquivo original (como o bit de execução) passa para o novo.
    await writeFile(temporary, bytes, { flag: 'wx', mode });
    await rename(temporary, absolute);
  } catch (error) {
    await rm(temporary, { force: true }).catch(() => undefined);
    throw toFilesError(error);
  }

  const info = await stat(absolute).catch((error: unknown) => {
    throw toFilesError(error);
  });
  return { size: bytes.length, mtimeMs: info.mtimeMs, hash: sha256(bytes) };
}
