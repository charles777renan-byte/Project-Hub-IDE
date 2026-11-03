import { realpath, stat } from 'node:fs/promises';
import { basename, dirname, isAbsolute, join, resolve } from 'node:path';
import { isStrictlyInside } from '@project-hub/git-adapter';

/** Consulta de metadados de um caminho, como `fs.promises.stat`. Injetável para testar os erros. */
export type StatPath = (path: string) => Promise<{ isDirectory(): boolean }>;

/** Códigos que querem dizer "a pasta não está lá". Só esses viram `false`. */
const MISSING_CODES = new Set(['ENOENT', 'ENOTDIR']);

function isMissing(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    typeof error.code === 'string' &&
    MISSING_CODES.has(error.code)
  );
}

/**
 * Diz se `path` é um diretório. Caminho ausente (ENOENT) ou que passa por um arquivo (ENOTDIR) dá
 * `false`. Qualquer outro erro, como permissão negada, é registrado com console.error e propagado: não
 * vira "não existe", e a operação que chamou decide o que fazer.
 */
export function createIsDirectory(statPath: StatPath = stat): (path: string) => Promise<boolean> {
  return async (path) => {
    try {
      return (await statPath(path)).isDirectory();
    } catch (error) {
      if (isMissing(error)) return false;
      console.error(`Falha ao consultar a pasta ${path}:`, error);
      throw error;
    }
  };
}

/** Resolve links simbólicos, como `fs.promises.realpath`. Injetável para testar os erros. */
export type RealPath = (path: string) => Promise<string>;

/**
 * Resolve `path` pelo ancestral existente mais próximo: o que existe passa por `realpath`, e os nomes que
 * ainda não existem (um arquivo apagado, por exemplo) voltam no fim, sem links para seguir. Erro que não
 * seja "não existe" propaga.
 */
async function realpathOfNearest(path: string, realPath: RealPath): Promise<string> {
  const missing: string[] = [];
  let current = path;
  for (;;) {
    try {
      return join(await realPath(current), ...[...missing].reverse());
    } catch (error) {
      if (!isMissing(error)) throw error;
      const parent = dirname(current);
      if (parent === current) throw error;
      missing.push(basename(current));
      current = parent;
    }
  }
}

/**
 * Diz se `relativePath` fica dentro da pasta do projeto depois de resolver os links simbólicos (`realpath` dos
 * dois lados, com `isStrictlyInside`). Caminho que ainda não existe vale pelo ancestral existente mais próximo.
 * Na dúvida a resposta é `false`: caminho absoluto, falha ao resolver ou o próprio projeto contam como fora.
 */
export function createIsInsideProject(
  realPath: RealPath = realpath,
): (projectPath: string, relativePath: string) => Promise<boolean> {
  return async (projectPath, relativePath) => {
    if (isAbsolute(relativePath)) return false;
    try {
      const root = await realPath(projectPath);
      const target = await realpathOfNearest(resolve(projectPath, relativePath), realPath);
      return isStrictlyInside(root, target);
    } catch (error) {
      if (!isMissing(error)) {
        console.error(`Falha ao resolver o caminho ${relativePath} em ${projectPath}:`, error);
      }
      return false;
    }
  };
}
