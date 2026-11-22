import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { openDatabase, type AppDatabase } from '../src/client';
import { migrateDatabase } from '../src/migrate';
import {
  createAccountRepository,
  type AccountRepository,
} from '../src/repositories/account-repository';
import {
  createAccountSecretRepository,
  type AccountSecretRepository,
} from '../src/repositories/account-secret-repository';
import {
  createVaultMetaRepository,
  type VaultMetaRepository,
} from '../src/repositories/vault-meta-repository';

let dir: string;
let dbFile: string;
let db: AppDatabase;
let accounts: AccountRepository;
let secrets: AccountSecretRepository;
let vault: VaultMetaRepository;

const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';
const T0 = '2026-11-21T10:00:00.000Z';
const T1 = '2026-11-21T10:05:00.000Z';

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'project-hub-cofre-'));
  dbFile = join(dir, 'project-hub.sqlite');
  db = openDatabase(dbFile);
  migrateDatabase(db, { filePath: dbFile });
  accounts = createAccountRepository(db);
  secrets = createAccountSecretRepository(db);
  vault = createVaultMetaRepository(db);
  accounts.insert({ id: A, provider: 'claude', name: 'API', createdAt: T0, kind: 'api' });
  accounts.insert({ id: B, provider: 'claude', name: 'API 2', createdAt: T0, kind: 'api' });
});

afterEach(() => {
  db.$client.close();
  rmSync(dir, { recursive: true, force: true });
});

describe('account_secrets', () => {
  it('put substitui a chave da conta e delete a remove', () => {
    secrets.put(A, Buffer.from('cifra-1'), 'ab12', T0);
    secrets.put(A, Buffer.from('cifra-2'), 'cd34', T1);

    expect(secrets.get(A)).toEqual({
      ciphertext: Buffer.from('cifra-2'),
      last4: 'cd34',
      updatedAt: T1,
    });
    expect(secrets.list()).toEqual([
      { accountId: A, ciphertext: Buffer.from('cifra-2'), last4: 'cd34' },
    ]);

    secrets.delete(A);

    expect(secrets.get(A)).toBeUndefined();
    expect(secrets.list()).toEqual([]);
  });

  it('deleteAll apaga todas as linhas do cofre', () => {
    secrets.put(A, Buffer.from('cifra-a'), 'aaaa', T0);
    secrets.put(B, Buffer.from('cifra-b'), 'bbbb', T0);

    secrets.deleteAll();

    expect(secrets.list()).toEqual([]);
  });

  it('a chave só existe para uma conta que existe', () => {
    expect(() =>
      secrets.put('99999999-9999-4999-8999-999999999999', Buffer.from('x'), 'abcd', T0),
    ).toThrow();
  });

  it('transaction desfaz tudo se o trabalho falhar no meio', () => {
    secrets.put(A, Buffer.from('antiga'), 'aaaa', T0);

    expect(() =>
      secrets.transaction(() => {
        secrets.put(A, Buffer.from('nova'), 'bbbb', T1);
        throw new Error('falhou no meio');
      }),
    ).toThrow('falhou no meio');

    expect(secrets.get(A)?.ciphertext).toEqual(Buffer.from('antiga'));
  });
});

describe('vault_meta', () => {
  it('vault_meta aceita uma linha só', () => {
    expect(vault.get()).toBeUndefined();

    vault.set(Buffer.alloc(16, 1), Buffer.from('verificador-1'), T0);
    vault.set(Buffer.alloc(16, 2), Buffer.from('verificador-2'), T1);

    expect(vault.get()).toEqual({
      salt: Buffer.alloc(16, 2),
      verifier: Buffer.from('verificador-2'),
    });
    expect(db.$client.prepare('SELECT count(*) AS n FROM vault_meta').get()).toEqual({ n: 1 });
    expect(() =>
      db.$client
        .prepare('INSERT INTO vault_meta (id, salt, verifier, created_at) VALUES (2, ?, ?, ?)')
        .run(Buffer.alloc(16), Buffer.from('x'), T0),
    ).toThrow();

    vault.clear();

    expect(vault.get()).toBeUndefined();
  });
});

describe('apagamento seguro', () => {
  it('secure_delete está ligado', () => {
    expect(db.$client.pragma('secure_delete', { simple: true })).toBe(1);
  });

  it('depois de apagar a linha, o texto cifrado não sobra no arquivo do banco', () => {
    const marker = Buffer.from('MARCADOR-DO-COFRE-0123456789-XYZ');
    expect(marker.length).toBe(32);
    secrets.put(A, marker, 'mark', T0);
    db.$client.pragma('wal_checkpoint(TRUNCATE)');
    // O marcador estava no arquivo: sem isso, o teste não provaria nada.
    expect(readFileSync(dbFile).includes(marker)).toBe(true);

    secrets.delete(A);
    db.$client.pragma('wal_checkpoint(TRUNCATE)');

    expect(readFileSync(dbFile).includes(marker)).toBe(false);
    const wal = `${dbFile}-wal`;
    if (existsSync(wal)) expect(readFileSync(wal).includes(marker)).toBe(false);
  });
});
