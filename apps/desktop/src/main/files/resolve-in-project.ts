import { lstat, realpath } from 'node:fs/promises';
import { basename, dirname, join, relative, sep } from 'node:path';
import { isStrictlyInside } from '@project-hub/git-adapter';
import { FilesError } from './files-error';

const OUTSIDE_MESSAGE = 'O caminho está fora da pasta do projeto.';

/** Códigos de "não existe": o caminho ainda não está no disco (arquivo novo) ou passa por um arquivo. */
const MISSING_CODES = new Set(['ENOENT', 'ENOTDIR']);

function outside(): FilesError {
  return new FilesError('PATH_OUTSIDE_ALLOWED_SCOPE', OUTSIDE_MESSAGE);
}

function errorCode(error: unknown): unknown {
  return typeof error === 'object' && error !== null && 'code' in error ? error.code : undefined;
}

/**
 * O Windows ignora pontos e espaços no fim do nome: `.git.` abre a pasta `.git`. A comparação tira
 * esses caracteres antes de olhar o nome.
 */
function isGitSegment(segment: string): boolean {
  return segment.replace(/[. ]+$/, '').toLowerCase() === '.git';
}

/**
 * Confere o texto do caminho sem tocar no disco e devolve os segmentos. O renderer manda um caminho
 * relativo em POSIX; qualquer outra forma é recusada: `\` e `:` (unidade, UNC, fluxo alternativo do
 * NTFS), caminho absoluto, `..` e `.git` (a pasta de metadados não é editável por aqui).
 */
function textualSegments(relativePath: string, allowRoot: boolean): string[] {
  if (relativePath.includes('\0') || relativePath.includes('\\') || relativePath.includes(':')) {
    throw outside();
  }
  if (relativePath.startsWith('/')) throw outside();
  const segments = relativePath.split('/').filter((segment) => segment !== '' && segment !== '.');
  if (segments.some((segment) => segment === '..' || isGitSegment(segment))) throw outside();
  if (segments.length === 0 && !allowRoot) throw outside();
  return segments;
}

/**
 * Resolve o caminho real do alvo. Se ele não existe, sobe até o ancestral existente mais próximo,
 * resolve esse e recoloca os segmentos que faltam. Um link pendurado (existe, mas o alvo não) não
 * pode ser tratado como "ausente": criar um arquivo através dele escreveria no destino do link.
 */
async function realpathOfExistingAncestor(absolute: string): Promise<string> {
  const missing: string[] = [];
  let current = absolute;
  for (;;) {
    try {
      return missing.length === 0 ? await realpath(current) : join(await realpath(current), ...missing);
    } catch (error) {
      if (!MISSING_CODES.has(errorCode(error) as string)) throw error;
    }
    if (await lstat(current).then(() => true, () => false)) throw outside();
    const parent = dirname(current);
    if (parent === current) throw outside();
    missing.unshift(basename(current));
    current = parent;
  }
}

/**
 * Resolve `relativePath` (relativo e em POSIX) dentro de `root` e devolve o caminho absoluto real,
 * depois de seguir links simbólicos e junções. Lança `PATH_OUTSIDE_ALLOWED_SCOPE` se o resultado
 * sair da raiz. Com `allowRoot`, o próprio `root` (caminho vazio) é aceito.
 */
export async function resolveInProject(
  root: string,
  relativePath: string,
  options: { allowRoot?: boolean } = {},
): Promise<string> {
  const allowRoot = options.allowRoot === true;
  const segments = textualSegments(relativePath, allowRoot);
  const realRoot = await realpath(root);
  const target = await realpathOfExistingAncestor(join(realRoot, ...segments));
  const inside = isStrictlyInside(realRoot, target) || (allowRoot && target === realRoot);
  if (!inside) throw outside();
  // Um link para dentro de `.git` passa pela checagem textual, mas o destino real é a pasta vedada.
  if (relative(realRoot, target).split(sep).some(isGitSegment)) throw outside();
  return target;
}

/** Caminho relativo à raiz, com `/` como separador: a forma que trafega no IPC. */
export function toPosixRelative(root: string, absolute: string): string {
  return relative(root, absolute).split(sep).join('/');
}
