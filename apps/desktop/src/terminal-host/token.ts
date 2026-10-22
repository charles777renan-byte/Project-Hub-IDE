import { randomBytes } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

/** Token de 256 bits, em hexadecimal. Autentica o app no processo de terminais. */
export function createHostToken(): string {
  return randomBytes(32).toString('hex');
}

/**
 * Grava o token na pasta de dados do app. Fora do Windows, o modo 0600 restringe o arquivo ao usuário.
 * No Windows, a pasta de dados já é privada do usuário pelo padrão do sistema.
 */
export function writeHostToken(file: string, token: string): void {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, token, { mode: 0o600 });
}

/** Lê o token gravado. Devolve undefined se o arquivo não existe ou está vazio. */
export function readHostToken(file: string): string | undefined {
  try {
    const token = readFileSync(file, 'utf8').trim();
    return token === '' ? undefined : token;
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return undefined;
    throw error;
  }
}
