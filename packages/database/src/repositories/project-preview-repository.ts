import { eq } from 'drizzle-orm';
import type { AppDatabase } from '../client';
import { projectPreviews } from '../schema';

/**
 * O preview de um projeto, como fica guardado. `kind` diz o que a pessoa aprovou: `script` (gerenciador, nome e
 * texto do script, como ela viu), `address` (um endereço local fixo) ou `none` (nada aprovado; a linha existe só
 * para guardar o último endereço, o terminal do servidor e a porta do site estático).
 */
export type ProjectPreviewRecord = {
  projectId: string;
  kind: 'script' | 'address' | 'none';
  packageManager: string | null;
  script: string | null;
  /** O texto inteiro do script no momento da aprovação. Se o do `package.json` ficar diferente, a aprovação cai. */
  scriptBody: string | null;
  fixedUrl: string | null;
  /** O último endereço em que o preview respondeu. */
  lastUrl: string | null;
  /** O terminal em que o servidor subiu. */
  terminalId: string | null;
  /** A porta do servidor de site estático, para as abas guardadas continuarem valendo ao reabrir o app. */
  staticPort: number | null;
  updatedAt: string;
};

export interface ProjectPreviewRepository {
  get(projectId: string): ProjectPreviewRecord | undefined;
  /** Insere ou troca a linha inteira do projeto. */
  save(record: ProjectPreviewRecord): void;
  delete(projectId: string): void;
}

const KINDS: readonly string[] = ['script', 'address', 'none'];

export function createProjectPreviewRepository(db: AppDatabase): ProjectPreviewRepository {
  return {
    get(projectId) {
      const row = db
        .select()
        .from(projectPreviews)
        .where(eq(projectPreviews.projectId, projectId))
        .get();
      if (row === undefined) return undefined;
      // Um valor que este código não conhece (banco de uma versão mais nova) conta como nada aprovado.
      const kind = KINDS.includes(row.kind) ? (row.kind as ProjectPreviewRecord['kind']) : 'none';
      return { ...row, kind };
    },

    save(record) {
      // No conflito a chave é a mesma: trocar a linha inteira pelo registro é o que se quer.
      db.insert(projectPreviews)
        .values(record)
        .onConflictDoUpdate({ target: projectPreviews.projectId, set: record })
        .run();
    },

    delete(projectId) {
      db.delete(projectPreviews).where(eq(projectPreviews.projectId, projectId)).run();
    },
  };
}
