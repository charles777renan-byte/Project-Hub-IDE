import { readdir, readFile, stat } from 'node:fs/promises';
import { resolveInProject } from '../files/resolve-in-project';
import type { ProjectFacts } from './discovery';

/** Maior `package.json` que o preview lê. Acima disso, o projeto conta como sem `package.json`. */
export const PACKAGE_JSON_MAX = 1024 * 1024;

/**
 * O que o preview precisa saber da pasta do projeto: os nomes dos arquivos da raiz (para o gerenciador de pacotes
 * e o `index.html`) e o texto do `package.json`. Nunca lança: pasta que sumiu ou arquivo que não dá para ler
 * conta como nada achado.
 */
export async function readProjectFacts(root: string): Promise<ProjectFacts> {
  const rootFiles = new Set<string>();
  try {
    for (const entry of await readdir(root, { withFileTypes: true })) {
      if (entry.isFile()) rootFiles.add(entry.name);
    }
  } catch {
    return { packageJson: null, rootFiles };
  }
  if (!rootFiles.has('package.json')) return { packageJson: null, rootFiles };
  try {
    const path = await resolveInProject(root, 'package.json');
    const info = await stat(path);
    if (!info.isFile() || info.size > PACKAGE_JSON_MAX) return { packageJson: null, rootFiles };
    return { packageJson: await readFile(path, 'utf8'), rootFiles };
  } catch {
    return { packageJson: null, rootFiles };
  }
}
