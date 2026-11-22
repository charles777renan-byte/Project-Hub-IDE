import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
  scrypt,
  type ScryptOptions,
} from 'node:crypto';
import { failure } from '@project-hub/application';
import type { AppResult, KeyState, VaultState } from '@project-hub/contracts';
import type { AccountSecretRepository, VaultMetaRepository } from '@project-hub/database';

export const VAULT_LOCKED = 'Destranque o cofre para continuar.';
export const KEY_MISSING = 'A conta não tem uma chave de API guardada.';
export const KEY_UNREADABLE = 'Não foi possível abrir a chave desta conta. Cole a chave de novo.';
export const WRONG_PASSWORD = 'Senha incorreta.';
export const VAULT_PASSWORD_MIN = 12;
export const PASSWORD_TOO_SHORT = `A senha precisa ter pelo menos ${VAULT_PASSWORD_MIN} caracteres.`;
export const VAULT_WAIT = 'Muitas tentativas erradas. Espere alguns segundos e tente de novo.';
export const VAULT_UNAVAILABLE =
  'A proteção de dados do Windows não está disponível. Sem ela, o app não guarda chaves de API.';
export const VAULT_BROKEN =
  'Não foi possível abrir o cofre neste computador. Redefina o cofre e cole as chaves de novo.';
export const VAULT_EXISTS = 'O cofre já tem uma senha.';
export const VAULT_EMPTY = 'O cofre ainda não tem senha.';
const CHANGE_FAILED = 'Não foi possível trocar a senha. Nada foi mudado.';
const SAVE_FAILED = 'Não foi possível guardar a chave. Tente de novo.';

/** Texto fixo cifrado com a chave derivada: abrir ele prova que a senha está certa. */
const VERIFIER_TEXT = 'project-hub-vault-v1';
const SALT_BYTES = 16;
const NONCE_BYTES = 12;
const TAG_BYTES = 16;
const KEY_BYTES = 32;
const FREE_ATTEMPTS = 4;
const FIRST_WAIT_MS = 2000;
const MAX_WAIT_MS = 60_000;
const PRODUCTION_KDF = { N: 2 ** 17, r: 8, p: 1 };

export type AccountVaultDeps = {
  secrets: AccountSecretRepository;
  meta: VaultMetaRepository;
  /** `safeStorage` do Electron, reduzido ao que o cofre usa. */
  wrap: { isAvailable(): boolean; encrypt(data: Buffer): Buffer; decrypt(data: Buffer): Buffer };
  now: () => Date;
  /** Parâmetros do scrypt; os testes passam N menor. Produção: { N: 2 ** 17, r: 8, p: 1 }. */
  kdf?: { N: number; r: number; p: number };
  onChange?: () => void;
};

export type AccountVault = {
  status(): { state: VaultState; available: boolean; retryAt?: string };
  /** Cria a senha do cofre. Só com o cofre vazio; o cofre fica destrancado. */
  create(password: string): Promise<AppResult<undefined>>;
  /** `WRONG_PASSWORD`, ou `VAULT_WAIT` durante a espera depois de erros seguidos. */
  unlock(password: string): Promise<AppResult<undefined>>;
  lock(): void;
  /** Guarda (ou troca) a chave da conta. Exige o cofre destrancado. */
  put(accountId: string, key: string): AppResult<{ last4: string }>;
  check(accountId: string): KeyState;
  /** Os 4 últimos caracteres, gravados à parte: não exige destrancar. */
  last4Of(accountId: string): string | undefined;
  /** A chave em claro, decifrada na hora. Só `account-use.ts` chama. */
  reveal(accountId: string): AppResult<string>;
  remove(accountId: string): void;
  /** Regrava todas as chaves com a senha nova. `lost`: as contas cuja chave não abria e foi apagada. */
  changePassword(current: string, next: string): Promise<AppResult<{ lost: string[] }>>;
  /** Apaga a senha e todas as chaves. */
  reset(): void;
};

function deriveKey(
  password: string,
  salt: Buffer,
  kdf: { N: number; r: number; p: number },
): Promise<Buffer> {
  // O scrypt usa 128·N·r bytes; o teto padrão do Node (32 MB) não cobre N = 2^17.
  const options: ScryptOptions = { ...kdf, maxmem: 256 * kdf.N * kdf.r };
  return new Promise((resolve, reject) => {
    scrypt(password, salt, KEY_BYTES, options, (error, key) => {
      if (error) reject(error);
      else resolve(key);
    });
  });
}

/** `nonce || tag || texto cifrado`, com AES-256-GCM. */
function seal(key: Buffer, plain: Buffer): Buffer {
  const nonce = randomBytes(NONCE_BYTES);
  const cipher = createCipheriv('aes-256-gcm', key, nonce);
  const body = Buffer.concat([cipher.update(plain), cipher.final()]);
  return Buffer.concat([nonce, cipher.getAuthTag(), body]);
}

/** Abre o que `seal` fechou. `undefined` se a chave não for a certa ou os bytes estiverem estragados. */
function open(key: Buffer, sealed: Buffer): Buffer | undefined {
  if (sealed.length < NONCE_BYTES + TAG_BYTES) return undefined;
  try {
    const decipher = createDecipheriv('aes-256-gcm', key, sealed.subarray(0, NONCE_BYTES));
    decipher.setAuthTag(sealed.subarray(NONCE_BYTES, NONCE_BYTES + TAG_BYTES));
    return Buffer.concat([
      decipher.update(sealed.subarray(NONCE_BYTES + TAG_BYTES)),
      decipher.final(),
    ]);
  } catch {
    return undefined;
  }
}

export function createAccountVault(deps: AccountVaultDeps): AccountVault {
  const kdf = deps.kdf ?? PRODUCTION_KDF;
  /** A chave derivada da senha, só na memória deste módulo. `null`: trancado. */
  let derived: Buffer | null = null;
  /** A proteção do Windows não abre o que gravou (perfil trocado, banco de outra máquina). */
  let broken = false;
  let errors = 0;
  let retryAt: Date | undefined;

  const changed = () => deps.onChange?.();

  function forget(): void {
    derived?.fill(0);
    derived = null;
  }

  /** Cifra com a chave derivada e embrulha com a proteção do Windows. Lança se o Windows recusar. */
  function wrapSealed(key: Buffer, plain: Buffer): Buffer {
    return deps.wrap.encrypt(seal(key, plain));
  }

  /** Desembrulha e decifra. `undefined` se não abrir; lança só se a proteção do Windows falhar. */
  function unwrapOpen(key: Buffer, blob: Buffer): Buffer | undefined {
    return open(key, deps.wrap.decrypt(blob));
  }

  function waiting(): boolean {
    return retryAt !== undefined && deps.now().getTime() < retryAt.getTime();
  }

  function countError(): void {
    errors += 1;
    if (errors <= FREE_ATTEMPTS) return;
    const wait = Math.min(FIRST_WAIT_MS * 2 ** (errors - FREE_ATTEMPTS - 1), MAX_WAIT_MS);
    retryAt = new Date(deps.now().getTime() + wait);
  }

  function clearErrors(): void {
    errors = 0;
    retryAt = undefined;
  }

  /**
   * Confere a senha contra o verificador. Devolve a chave derivada, ou a falha. A proteção do Windows que não
   * abre marca o cofre como estragado: as contas ficam com a chave ilegível até a pessoa redefinir o cofre.
   */
  async function verify(password: string): Promise<AppResult<{ key: Buffer; salt: Buffer }>> {
    const meta = deps.meta.get();
    if (meta === undefined) return failure('VALIDATION_FAILED', VAULT_EMPTY);
    if (waiting()) return failure('VALIDATION_FAILED', VAULT_WAIT);
    const key = await deriveKey(password, meta.salt, kdf);
    let plain: Buffer | undefined;
    try {
      plain = unwrapOpen(key, meta.verifier);
    } catch {
      key.fill(0);
      broken = true;
      changed();
      return failure('VALIDATION_FAILED', VAULT_BROKEN);
    }
    if (plain === undefined || plain.toString('utf8') !== VERIFIER_TEXT) {
      key.fill(0);
      countError();
      changed();
      return failure('VALIDATION_FAILED', WRONG_PASSWORD);
    }
    broken = false;
    clearErrors();
    return { ok: true, data: { key, salt: meta.salt } };
  }

  /** A chave de uma linha, ou por que ela não sai. Nunca lança. */
  function readKey(accountId: string): AppResult<string> {
    // Sem a chave guardada, pedir a senha não resolveria nada: a falta da chave vem antes do cofre trancado.
    const row = deps.secrets.get(accountId);
    if (row === undefined) return failure('VALIDATION_FAILED', KEY_MISSING);
    if (derived === null && !broken) return failure('VAULT_LOCKED', VAULT_LOCKED);
    if (derived === null) return failure('VALIDATION_FAILED', KEY_UNREADABLE);
    let plain: Buffer | undefined;
    try {
      plain = unwrapOpen(derived, row.ciphertext);
    } catch {
      plain = undefined;
    }
    if (plain === undefined) return failure('VALIDATION_FAILED', KEY_UNREADABLE);
    const key = plain.toString('utf8');
    plain.fill(0);
    return { ok: true, data: key };
  }

  return {
    status() {
      const state: VaultState =
        deps.meta.get() === undefined ? 'empty' : derived === null ? 'locked' : 'unlocked';
      return {
        state,
        available: deps.wrap.isAvailable(),
        ...(waiting() && retryAt !== undefined ? { retryAt: retryAt.toISOString() } : {}),
      };
    },

    async create(password) {
      if (deps.meta.get() !== undefined) return failure('VALIDATION_FAILED', VAULT_EXISTS);
      if (!deps.wrap.isAvailable()) return failure('VALIDATION_FAILED', VAULT_UNAVAILABLE);
      if (password.length < VAULT_PASSWORD_MIN) {
        return failure('VALIDATION_FAILED', PASSWORD_TOO_SHORT);
      }
      const salt = randomBytes(SALT_BYTES);
      const key = await deriveKey(password, salt, kdf);
      let verifier: Buffer;
      try {
        verifier = wrapSealed(key, Buffer.from(VERIFIER_TEXT, 'utf8'));
      } catch {
        key.fill(0);
        return failure('VALIDATION_FAILED', VAULT_UNAVAILABLE);
      }
      deps.meta.set(salt, verifier, deps.now().toISOString());
      forget();
      derived = key;
      broken = false;
      clearErrors();
      changed();
      return { ok: true, data: undefined };
    },

    async unlock(password) {
      const verified = await verify(password);
      if (!verified.ok) return verified;
      forget();
      derived = verified.data.key;
      changed();
      return { ok: true, data: undefined };
    },

    lock() {
      if (derived === null) return;
      forget();
      changed();
    },

    put(accountId, key) {
      if (derived === null) return failure('VAULT_LOCKED', VAULT_LOCKED);
      if (key.length < 4) return failure('VALIDATION_FAILED', SAVE_FAILED);
      if (!deps.wrap.isAvailable()) return failure('VALIDATION_FAILED', VAULT_UNAVAILABLE);
      const plain = Buffer.from(key, 'utf8');
      try {
        const last4 = key.slice(-4);
        deps.secrets.put(accountId, wrapSealed(derived, plain), last4, deps.now().toISOString());
        return { ok: true, data: { last4 } };
      } catch {
        return failure('VALIDATION_FAILED', SAVE_FAILED);
      } finally {
        plain.fill(0);
      }
    },

    check(accountId) {
      if (deps.secrets.get(accountId) === undefined) return 'missing';
      if (derived === null && !broken) return 'locked';
      return readKey(accountId).ok ? 'stored' : 'unreadable';
    },

    last4Of(accountId) {
      return deps.secrets.get(accountId)?.last4;
    },

    reveal(accountId) {
      return readKey(accountId);
    },

    remove(accountId) {
      deps.secrets.delete(accountId);
    },

    async changePassword(current, next) {
      if (next.length < VAULT_PASSWORD_MIN) return failure('VALIDATION_FAILED', PASSWORD_TOO_SHORT);
      if (!deps.wrap.isAvailable()) return failure('VALIDATION_FAILED', VAULT_UNAVAILABLE);
      const verified = await verify(current);
      if (!verified.ok) return verified;
      const oldKey = verified.data.key;
      const salt = randomBytes(SALT_BYTES);
      const newKey = await deriveKey(next, salt, kdf);
      const lost: string[] = [];
      try {
        deps.secrets.transaction(() => {
          for (const row of deps.secrets.list()) {
            let plain: Buffer | undefined;
            try {
              plain = unwrapOpen(oldKey, row.ciphertext);
            } catch {
              plain = undefined;
            }
            if (plain === undefined) {
              lost.push(row.accountId);
              deps.secrets.delete(row.accountId);
              continue;
            }
            const sealed = wrapSealed(newKey, plain);
            plain.fill(0);
            deps.secrets.put(row.accountId, sealed, row.last4, deps.now().toISOString());
          }
          // Por último: se algo acima lançar, a senha antiga continua valendo.
          deps.meta.set(
            salt,
            wrapSealed(newKey, Buffer.from(VERIFIER_TEXT, 'utf8')),
            deps.now().toISOString(),
          );
        });
      } catch {
        oldKey.fill(0);
        newKey.fill(0);
        return failure('VALIDATION_FAILED', CHANGE_FAILED);
      }
      oldKey.fill(0);
      forget();
      derived = newKey;
      changed();
      return { ok: true, data: { lost } };
    },

    reset() {
      deps.secrets.transaction(() => {
        deps.secrets.deleteAll();
        deps.meta.clear();
      });
      forget();
      broken = false;
      clearErrors();
      changed();
    },
  };
}
