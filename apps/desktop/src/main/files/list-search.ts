import { open, readdir, realpath, stat } from 'node:fs/promises';
import { join } from 'node:path';
import type { ContentMatchDto, ContentSearchDto, FileEntryDto, NameSearchDto } from '@project-hub/contracts';
import { BINARY_SCAN_BYTES, toFilesError } from './file-io';
import { FilesError } from './files-error';
import { resolveInProject } from './resolve-in-project';

/** Pastas que a listagem marca como ignoradas e que as buscas não percorrem, em qualquer profundidade. */
const IGNORED_DIRECTORIES = new Set(['node_modules', 'out', 'dist', 'coverage']);

/** Entradas (arquivos e pastas) que a busca por nome percorre antes de avisar "índice parcial". */
const NAME_SEARCH_ENTRY_LIMIT = 20_000;
/** Quantos caminhos a busca por nome devolve. */
const NAME_SEARCH_RESULT_LIMIT = 100;

/** Maior arquivo que a busca por conteúdo abre: 1 MiB. */
const CONTENT_FILE_LIMIT_BYTES = 1024 * 1024;
const CONTENT_RESULT_LIMIT = 200;
const CONTENT_TIMEOUT_MS = 5_000;
/** Largura máxima do trecho devolvido de cada linha que casou. */
const MATCH_TEXT_LIMIT = 200;

/** De quantas em quantas entradas a busca cede a vez ao laço de eventos. */
const YIELD_EVERY = 50;

const decoder = new TextDecoder('utf-8', { fatal: true });

function isGitName(name: string): boolean {
  return name.toLowerCase() === '.git';
}

function isIgnoredDirectory(name: string): boolean {
  return IGNORED_DIRECTORIES.has(name.toLowerCase());
}

function yieldToEventLoop(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

/** Os segmentos de um caminho relativo, sem os vazios nem o `.`. A validação é de `resolveInProject`. */
function segmentsOf(relativePath: string): string[] {
  return relativePath.split('/').filter((segment) => segment !== '' && segment !== '.');
}

/**
 * Lista uma pasta do projeto: pastas antes de arquivos, cada grupo em ordem alfabética sem diferenciar
 * maiúsculas. `.git` nunca aparece. `node_modules`, `out`, `dist` e `coverage` aparecem com
 * `ignored: true`. Link simbólico (ou junção) só aparece se o destino ficar dentro do projeto.
 */
export async function listDirectory(root: string, dir: string): Promise<FileEntryDto[]> {
  const absolute = await resolveInProject(root, dir, { allowRoot: true });
  const prefix = segmentsOf(dir);

  let dirents;
  try {
    dirents = await readdir(absolute, { withFileTypes: true });
  } catch (error) {
    throw toFilesError(error);
  }

  const entries: FileEntryDto[] = [];
  for (const dirent of dirents) {
    if (isGitName(dirent.name)) continue;
    const path = [...prefix, dirent.name].join('/');

    let kind: FileEntryDto['kind'];
    if (dirent.isSymbolicLink()) {
      // O destino real precisa ficar dentro do projeto e fora de `.git`; link pendurado ou para fora some.
      try {
        const info = await stat(await resolveInProject(root, path));
        if (info.isDirectory()) kind = 'directory';
        else if (info.isFile()) kind = 'file';
        else continue;
      } catch {
        continue;
      }
    } else if (dirent.isDirectory()) {
      kind = 'directory';
    } else if (dirent.isFile()) {
      kind = 'file';
    } else {
      continue;
    }

    entries.push({
      name: dirent.name,
      path,
      kind,
      ignored: kind === 'directory' && isIgnoredDirectory(dirent.name),
    });
  }

  return entries.sort((a, b) => {
    if (a.kind !== b.kind) return a.kind === 'directory' ? -1 : 1;
    return a.name.localeCompare(b.name, 'pt-BR', { sensitivity: 'base' });
  });
}

interface WalkEntry {
  /** Caminho relativo à raiz, em POSIX. */
  path: string;
  kind: 'file' | 'directory';
}

/**
 * Percorre o projeto em largura, com uma fila de pastas. Pula `.git`, as pastas ignoradas e todo link
 * simbólico: seguir link abriria a porta para sair da raiz e para ciclos. Cede a vez ao laço de eventos
 * a cada 50 entradas e termina quando o sinal é abortado. Pasta que não abre (permissão) é pulada.
 */
async function* walkProject(realRoot: string, signal: AbortSignal | undefined): AsyncGenerator<WalkEntry> {
  const queue: string[] = [''];
  let sinceYield = 0;
  for (let next = 0; next < queue.length; next += 1) {
    if (signal?.aborted) return;
    const directory = queue[next] as string;

    let dirents;
    try {
      dirents = await readdir(join(realRoot, ...segmentsOf(directory)), { withFileTypes: true });
    } catch {
      continue;
    }
    // Ordem fixa: o corte por limite sempre deixa de fora as mesmas entradas.
    dirents.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));

    for (const dirent of dirents) {
      if (isGitName(dirent.name) || dirent.isSymbolicLink()) continue;
      const path = directory === '' ? dirent.name : `${directory}/${dirent.name}`;
      let kind: WalkEntry['kind'];
      if (dirent.isDirectory()) {
        if (isIgnoredDirectory(dirent.name)) continue;
        queue.push(path);
        kind = 'directory';
      } else if (dirent.isFile()) {
        kind = 'file';
      } else {
        continue;
      }

      yield { path, kind };

      sinceYield += 1;
      if (sinceYield >= YIELD_EVERY) {
        sinceYield = 0;
        await yieldToEventLoop();
        if (signal?.aborted) return;
      }
    }
  }
}

/** Os caracteres de `needle` aparecem em `text`, na ordem, não necessariamente colados. */
function isSubsequence(needle: string, text: string): boolean {
  let at = 0;
  for (const char of text) {
    if (char === needle[at]) at += 1;
    if (at === needle.length) return true;
  }
  return needle.length === 0;
}

/**
 * Busca arquivos pelo caminho: a consulta casa se seus caracteres aparecem no caminho, na ordem e sem
 * diferenciar maiúsculas. Devolve até 100 caminhos, os mais curtos primeiro. Olha no máximo 20 000
 * entradas; passando disso, `truncated` fica verdadeiro. Abortada, devolve o que achou, também truncada.
 */
export async function searchNames(
  root: string,
  query: string,
  options: { signal?: AbortSignal } = {},
): Promise<NameSearchDto> {
  const { signal } = options;
  const realRoot = await realpath(root);
  const needle = query.toLowerCase();

  const found: string[] = [];
  let seen = 0;
  let truncated = false;
  for await (const entry of walkProject(realRoot, signal)) {
    if (seen >= NAME_SEARCH_ENTRY_LIMIT) {
      truncated = true;
      break;
    }
    seen += 1;
    if (entry.kind === 'file' && isSubsequence(needle, entry.path.toLowerCase())) found.push(entry.path);
  }
  if (signal?.aborted) truncated = true;

  found.sort((a, b) => a.length - b.length || (a < b ? -1 : a > b ? 1 : 0));
  return { paths: found.slice(0, NAME_SEARCH_RESULT_LIMIT), truncated };
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Corta a linha em 200 caracteres sem deixar meio par substituto no fim. */
function clip(line: string): string {
  if (line.length <= MATCH_TEXT_LIMIT) return line;
  const last = line.charCodeAt(MATCH_TEXT_LIMIT - 1);
  const cut = last >= 0xd800 && last <= 0xdbff ? MATCH_TEXT_LIMIT - 1 : MATCH_TEXT_LIMIT;
  return line.slice(0, cut);
}

/**
 * Lê no máximo 1 MiB do arquivo e devolve o texto, ou `null` se ele não serve para a busca: maior que o
 * limite, binário (NUL no começo) ou que não é UTF-8. A leitura nunca passa do limite, mesmo que o
 * arquivo cresça depois do `stat`.
 */
async function readSearchableText(absolute: string): Promise<string | null> {
  let handle;
  try {
    handle = await open(absolute, 'r');
  } catch {
    return null;
  }
  try {
    const { size } = await handle.stat();
    if (size > CONTENT_FILE_LIMIT_BYTES) return null;
    // Um byte a mais que o limite revela o arquivo que cresceu.
    const buffer = Buffer.allocUnsafe(Math.min(size, CONTENT_FILE_LIMIT_BYTES) + 1);
    let filled = 0;
    while (filled < buffer.length) {
      const { bytesRead } = await handle.read(buffer, filled, buffer.length - filled, filled);
      if (bytesRead === 0) break;
      filled += bytesRead;
    }
    if (filled > CONTENT_FILE_LIMIT_BYTES) return null;
    const bytes = buffer.subarray(0, filled);
    if (bytes.subarray(0, BINARY_SCAN_BYTES).includes(0)) return null;
    // O decodificador tira o BOM sozinho.
    return decoder.decode(bytes);
  } catch {
    return null;
  } finally {
    await handle.close().catch(() => undefined);
  }
}

/**
 * Busca texto dentro dos arquivos do projeto, linha a linha, sem diferenciar maiúsculas. Com `regex`
 * falso a consulta é literal; regex inválida lança `VALIDATION_FAILED`. Só abre arquivos de texto de até
 * 1 MiB. Para em 200 resultados ou em 5 s, e então `truncated` fica verdadeiro, como ao ser abortada. O limite de
 * tempo (`timeoutMs`) só muda em teste: a produção usa sempre o padrão.
 */
export async function searchContent(
  root: string,
  query: string,
  regex: boolean,
  options: { signal?: AbortSignal; timeoutMs?: number } = {},
): Promise<ContentSearchDto> {
  const { signal, timeoutMs = CONTENT_TIMEOUT_MS } = options;
  let pattern: RegExp;
  try {
    // Sem a flag `g`: `test` não guarda estado entre as linhas.
    pattern = new RegExp(regex ? query : escapeRegExp(query), 'i');
  } catch {
    throw new FilesError('VALIDATION_FAILED', 'A expressão regular é inválida.');
  }

  const realRoot = await realpath(root);
  const deadline = Date.now() + timeoutMs;
  const matches: ContentMatchDto[] = [];
  let truncated = false;

  search: for await (const entry of walkProject(realRoot, signal)) {
    if (entry.kind !== 'file') continue;
    if (Date.now() > deadline) {
      truncated = true;
      break;
    }
    const text = await readSearchableText(join(realRoot, ...segmentsOf(entry.path)));
    if (text === null) continue;

    const lines = text.split(/\r\n|\n|\r/);
    for (let index = 0; index < lines.length; index += 1) {
      const line = lines[index] as string;
      if (!pattern.test(line)) continue;
      // O 201º resultado só prova que havia mais; ele não é devolvido.
      if (matches.length >= CONTENT_RESULT_LIMIT) {
        truncated = true;
        break search;
      }
      matches.push({ path: entry.path, line: index + 1, text: clip(line) });
    }
  }
  if (signal?.aborted) truncated = true;

  return { matches, truncated };
}
