import { asc, eq } from 'drizzle-orm';
import type { AppDatabase } from '../client';
import { accountSecrets } from '../schema';

/** A chave cifrada de uma conta API. O banco nunca guarda a chave em texto puro. */
export type AccountSecretRecord = { ciphertext: Buffer; last4: string; updatedAt: string };

export interface AccountSecretRepository {
  get(accountId: string): AccountSecretRecord | undefined;
  list(): { accountId: string; ciphertext: Buffer; last4: string }[];
  /** Grava ou substitui a chave cifrada da conta. */
  put(accountId: string, ciphertext: Buffer, last4: string, at: string): void;
  delete(accountId: string): void;
  deleteAll(): void;
  /** Roda tudo numa transação: se `run` lançar, nada do que ela gravou fica. */
  transaction<T>(run: () => T): T;
}

export function createAccountSecretRepository(db: AppDatabase): AccountSecretRepository {
  return {
    get(accountId) {
      const row = db
        .select()
        .from(accountSecrets)
        .where(eq(accountSecrets.accountId, accountId))
        .get();
      return row === undefined
        ? undefined
        : { ciphertext: row.ciphertext, last4: row.last4, updatedAt: row.updatedAt };
    },

    list() {
      return db
        .select()
        .from(accountSecrets)
        .orderBy(asc(accountSecrets.accountId))
        .all()
        .map((row) => ({ accountId: row.accountId, ciphertext: row.ciphertext, last4: row.last4 }));
    },

    put(accountId, ciphertext, last4, at) {
      db.insert(accountSecrets)
        .values({ accountId, ciphertext, last4, updatedAt: at })
        .onConflictDoUpdate({
          target: accountSecrets.accountId,
          set: { ciphertext, last4, updatedAt: at },
        })
        .run();
    },

    delete(accountId) {
      db.delete(accountSecrets).where(eq(accountSecrets.accountId, accountId)).run();
    },

    deleteAll() {
      db.delete(accountSecrets).run();
    },

    transaction(run) {
      return db.$client.transaction(run)();
    },
  };
}
