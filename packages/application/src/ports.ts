import type { NewProject, ProjectRecord } from '@project-hub/domain';

/**
 * Porta do repositório de projetos. O repositório do banco a satisfaz por tipagem estrutural, e a
 * composição do processo principal liga os dois. Este pacote não importa `@project-hub/database`.
 */
export interface ProjectRepository {
  insert(project: NewProject): void;
  get(id: string): ProjectRecord | undefined;
  /** Exclui os projetos removidos. */
  list(): ProjectRecord[];
  /** Inclui os removidos: o caminho continua ocupado enquanto o registro existir. */
  findByNormalizedPath(normalizedPath: string): ProjectRecord | undefined;
  markRemoved(id: string, removedAt: string): void;
  /** Desfaz a remoção: o mesmo registro volta à lista, sem inserir outro. */
  restore(id: string, updatedAt: string): void;
}

/** Diz se a pasta é um repositório Git. A detecção real entra na Tarefa 7. */
export interface GitDetector {
  detect(path: string): Promise<{ kind: 'git' | 'none'; defaultBranch?: string }>;
}

/** Consultas ao sistema de arquivos que os casos de uso precisam. */
export interface FileSystemPort {
  isDirectory(path: string): Promise<boolean>;
}
