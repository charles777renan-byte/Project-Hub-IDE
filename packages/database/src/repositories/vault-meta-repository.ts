import { eq } from 'drizzle-orm';
import type { AppDatabase } from '../client';
import { vaultMeta } from '../schema';

/** O sal e o verificador da senha do cofre. Uma linha só (`id = 1`). */
export interface VaultMetaRepository {
  get(): { salt: Buffer; verifier: Buffer } | undefined;
  /** Grava ou substitui a linha do cofre. */
  set(salt: Buffer, verifier: Buffer, at: string): void;
  clear(): void;
}

const ONLY_ROW = 1;

export function createVaultMetaRepository(db: AppDatabase): VaultMetaRepository {
  return {
    get() {
      const row = db.select().from(vaultMeta).where(eq(vaultMeta.id, ONLY_ROW)).get();
      return row === undefined ? undefined : { salt: row.salt, verifier: row.verifier };
    },

    set(salt, verifier, at) {
      db.insert(vaultMeta)
        .values({ id: ONLY_ROW, salt, verifier, createdAt: at })
        .onConflictDoUpdate({ target: vaultMeta.id, set: { salt, verifier, createdAt: at } })
        .run();
    },

    clear() {
      db.delete(vaultMeta).run();
    },
  };
}
