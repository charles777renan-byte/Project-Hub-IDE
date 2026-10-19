import { randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { stat } from 'node:fs/promises';
import { dirname } from 'node:path';
import type { AddProjectDeps, Platform } from '@project-hub/application';
import { createProjectRepository, migrateDatabase, openDatabase } from '@project-hub/database';

/** Serviços de projetos, com `close` para fechar o banco ao sair do aplicativo. */
export type ProjectServices = AddProjectDeps & { close(): void };

/** Plataforma do Node para o tipo que os casos de uso usam. Plataforma fora da lista conta como Linux. */
export function platformOf(value: NodeJS.Platform): Platform {
  return value === 'win32' || value === 'darwin' ? value : 'linux';
}

/**
 * Pasta que existe e é diretório. Qualquer falha ao consultar a pasta (sumiu, sem permissão) conta
 * como indisponível: a listagem não pode parar por causa de um projeto.
 */
async function isDirectory(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isDirectory();
  } catch {
    return false;
  }
}

/**
 * Liga as portas dos casos de uso às implementações reais (composição do processo principal). Abre
 * o banco e aplica as migrações antes de devolver os serviços. A detecção de Git é um stub até a
 * Tarefa 7 (R3): nenhuma pasta é reconhecida como repositório.
 */
export function createProjectServices(options: {
  dbFile: string;
  platform: Platform;
}): ProjectServices {
  mkdirSync(dirname(options.dbFile), { recursive: true });
  const db = openDatabase(options.dbFile);
  migrateDatabase(db, { filePath: options.dbFile });

  return {
    repo: createProjectRepository(db),
    git: { detect: () => Promise.resolve({ kind: 'none' as const }) },
    fs: { isDirectory },
    platform: options.platform,
    now: () => new Date().toISOString(),
    newId: () => randomUUID(),
    close: () => {
      db.$client.close();
    },
  };
}
