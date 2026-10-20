import { posix, win32, type PlatformPath } from 'node:path';

/** Plataformas em que o Project Hub roda. */
export type Platform = 'win32' | 'darwin' | 'linux';

/** Regras de caminho da plataforma: no Windows, barra invertida. */
export function platformPaths(platform: Platform): PlatformPath {
  return platform === 'win32' ? win32 : posix;
}

/** Raiz de Windows que conta como absoluta: letra de unidade (`C:\`) ou compartilhamento UNC (`\\servidor\pasta\`). */
const WINDOWS_ABSOLUTE_ROOT = /^(?:[A-Za-z]:[\\/]|[\\/]{2}[^\\/]+[\\/]+[^\\/]+[\\/])$/;

/**
 * Diz se `input` é absoluto para a plataforma. No Windows, `\app` tem raiz mas não é absoluto: falta
 * a unidade ou o compartilhamento (R73). No Linux e no macOS vale a regra do POSIX.
 */
export function isAbsoluteProjectPath(input: string, platform: Platform): boolean {
  if (platform !== 'win32') return posix.isAbsolute(input);
  return WINDOWS_ABSOLUTE_ROOT.test(win32.parse(input).root);
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
