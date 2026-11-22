import { and, asc, eq, isNull } from 'drizzle-orm';
import type { AppDatabase } from '../client';
import { accounts, type ACCOUNT_KINDS, type ACCOUNT_PROVIDERS } from '../schema';

export type AccountProvider = (typeof ACCOUNT_PROVIDERS)[number];
export type AccountKind = (typeof ACCOUNT_KINDS)[number];

/** Uma conta extra. `removedAt` só vem na conta removida. */
export type AccountRecord = {
  id: string;
  provider: AccountProvider;
  name: string;
  createdAt: string;
  removedAt?: string;
  kind: AccountKind;
};

/** Contas extras dos programas. A Principal não tem linha. */
export interface AccountRepository {
  /** Sem tipo, a conta é de assinatura. */
  insert(record: Omit<AccountRecord, 'kind'> & { kind?: AccountKind }): void;
  /** Devolve também a conta removida: quem chama decide o que fazer com ela. */
  get(id: string): AccountRecord | undefined;
  /** As contas do programa que não foram removidas, da mais antiga para a mais nova. */
  list(provider: AccountProvider): AccountRecord[];
  rename(id: string, name: string): void;
  markRemoved(id: string, at: string): void;
}

type Row = typeof accounts.$inferSelect;

function toRecord(row: Row): AccountRecord {
  return {
    id: row.id,
    provider: row.provider,
    name: row.name,
    createdAt: row.createdAt,
    ...(row.removedAt === null ? {} : { removedAt: row.removedAt }),
    kind: row.kind,
  };
}

export function createAccountRepository(db: AppDatabase): AccountRepository {
  return {
    insert(record) {
      db.insert(accounts)
        .values({
          id: record.id,
          provider: record.provider,
          name: record.name,
          createdAt: record.createdAt,
          removedAt: record.removedAt ?? null,
          kind: record.kind ?? 'subscription',
        })
        .run();
    },

    get(id) {
      const row = db.select().from(accounts).where(eq(accounts.id, id)).get();
      return row === undefined ? undefined : toRecord(row);
    },

    list(provider) {
      return db
        .select()
        .from(accounts)
        .where(and(eq(accounts.provider, provider), isNull(accounts.removedAt)))
        .orderBy(asc(accounts.createdAt), asc(accounts.id))
        .all()
        .map(toRecord);
    },

    rename(id, name) {
      db.update(accounts).set({ name }).where(eq(accounts.id, id)).run();
    },

    markRemoved(id, at) {
      db.update(accounts).set({ removedAt: at }).where(eq(accounts.id, id)).run();
    },
  };
}
