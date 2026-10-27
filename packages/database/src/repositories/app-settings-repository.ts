import { eq } from 'drizzle-orm';
import type { AppDatabase } from '../client';
import { appSettings } from '../schema';

/** Configurações do app por chave. O valor é texto; quem interpreta é a camada de aplicação. */
export interface AppSettingsRepository {
  get(key: string): string | undefined;
  /** Grava o valor, substituindo o que a chave tinha. */
  set(key: string, value: string, updatedAt: string): void;
  remove(key: string): void;
}

export function createAppSettingsRepository(db: AppDatabase): AppSettingsRepository {
  return {
    get(key) {
      return db.select().from(appSettings).where(eq(appSettings.key, key)).get()?.value;
    },

    set(key, value, updatedAt) {
      db.insert(appSettings)
        .values({ key, value, updatedAt })
        .onConflictDoUpdate({ target: appSettings.key, set: { value, updatedAt } })
        .run();
    },

    remove(key) {
      db.delete(appSettings).where(eq(appSettings.key, key)).run();
    },
  };
}
