import { asc, eq } from 'drizzle-orm';
import type { AppDatabase } from '../client';
import { browserTabs } from '../schema';

/** Uma aba de página do navegador de um projeto, como fica guardada: o endereço, o título e a ordem. */
export type BrowserTabRecord = {
  id: string;
  projectId: string;
  /** Vazio na aba nova, sem endereço. */
  url: string;
  title: string;
  position: number;
  isActive: boolean;
  updatedAt: string;
};

export interface BrowserTabRepository {
  /** As abas do projeto, por `position`. */
  listByProject(projectId: string): BrowserTabRecord[];
  /** Troca todas as abas do projeto pelas dadas, numa transação: se uma falha, a lista antiga fica. */
  replaceProject(projectId: string, records: readonly BrowserTabRecord[]): void;
  deleteByProject(projectId: string): void;
}

export function createBrowserTabRepository(db: AppDatabase): BrowserTabRepository {
  return {
    listByProject(projectId) {
      return db
        .select()
        .from(browserTabs)
        .where(eq(browserTabs.projectId, projectId))
        .orderBy(asc(browserTabs.position))
        .all();
    },

    replaceProject(projectId, records) {
      db.transaction((tx) => {
        tx.delete(browserTabs).where(eq(browserTabs.projectId, projectId)).run();
        for (const record of records) {
          tx.insert(browserTabs)
            .values({ ...record, projectId })
            .run();
        }
      });
    },

    deleteByProject(projectId) {
      db.delete(browserTabs).where(eq(browserTabs.projectId, projectId)).run();
    },
  };
}
