import { stat } from 'node:fs/promises';

/** Consulta de metadados de um caminho, como `fs.promises.stat`. Injetável para testar os erros. */
export type StatPath = (path: string) => Promise<{ isDirectory(): boolean }>;

/** Códigos que querem dizer "a pasta não está lá". Só esses viram `false` (R73). */
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
