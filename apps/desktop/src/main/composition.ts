import { randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import type { AddProjectDeps, Platform } from '@project-hub/application';
import { createProjectRepository, migrateDatabase, openDatabase } from '@project-hub/database';
import { createIsDirectory } from './filesystem';

/** Serviços de projetos, com `close` para fechar o banco ao sair do aplicativo. */
export type ProjectServices = AddProjectDeps & { close(): void };

/** Plataforma do Node para o tipo que os casos de uso usam. Plataforma fora da lista conta como Linux. */
export function platformOf(value: NodeJS.Platform): Platform {
  return value === 'win32' || value === 'darwin' ? value : 'linux';
}

/**
 * Liga as portas dos casos de uso às implementações reais (composição do processo principal). Abre
 * o banco e aplica as migrações antes de devolver os serviços. Se a migração falha, o banco é
 * fechado antes do erro subir: no Windows, o arquivo aberto não pode ser apagado nem trocado. A
 * detecção de Git é um stub até a Tarefa 7 (R3): nenhuma pasta é reconhecida como repositório.
 */
export function createProjectServices(options: {
  dbFile: string;
  platform: Platform;
}): ProjectServices {
  mkdirSync(dirname(options.dbFile), { recursive: true });
  const db = openDatabase(options.dbFile);
  try {
    migrateDatabase(db, { filePath: options.dbFile });
  } catch (error) {
    db.$client.close();
    throw error;
  }

  return {
    repo: createProjectRepository(db),
    git: { detect: () => Promise.resolve({ kind: 'none' as const }) },
    fs: { isDirectory: createIsDirectory() },
    platform: options.platform,
    now: () => new Date().toISOString(),
    newId: () => randomUUID(),
    close: () => {
      db.$client.close();
    },
  };
}
