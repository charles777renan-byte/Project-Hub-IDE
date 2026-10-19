import { posix, win32, type PlatformPath } from 'node:path';

/** Plataformas em que o Project Hub roda. */
export type Platform = 'win32' | 'darwin' | 'linux';

/** Regras de caminho da plataforma: no Windows, barra invertida. */
export function platformPaths(platform: Platform): PlatformPath {
  return platform === 'win32' ? win32 : posix;
}

/** Caminho absoluto e sem barra final, com a caixa e os espaços como o usuário os escreveu. */
export function resolveProjectPath(input: string, platform: Platform): string {
  return platformPaths(platform).resolve(input);
}

/**
 * Chave que identifica a pasta. Resolve o caminho e tira a barra final. Só no Windows deixa tudo em
 * minúsculas, porque o sistema não diferencia caixa. Espaços e acentos ficam como estão.
 */
export function normalizePath(input: string, platform: Platform): string {
  const resolved = resolveProjectPath(input, platform);
  return platform === 'win32' ? resolved.toLowerCase() : resolved;
}
