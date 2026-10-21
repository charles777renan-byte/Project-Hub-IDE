import { isAbsolute, relative, sep } from 'node:path';

/**
 * Diz se `target` está dentro de `root`, e não é o próprio `root`. A conta é feita com `relative`:
 * um teste de prefixo aceitaria `C:\raiz-outra` como filho de `C:\raiz`. Em outra unidade do
 * Windows, `relative` devolve um caminho absoluto.
 */
export function isStrictlyInside(root: string, target: string): boolean {
  const path = relative(root, target);
  return path !== '' && path !== '..' && !path.startsWith(`..${sep}`) && !isAbsolute(path);
}
