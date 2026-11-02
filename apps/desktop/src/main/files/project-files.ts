import {
  FILE_ERROR_MESSAGES,
  FILE_SIZE_LIMIT_BYTES,
  type ContentSearchDto,
  type FileContentDto,
  type FileEntryDto,
  type FilesWriteInput,
  type FileStatDto,
  type FileVersionDto,
  type NameSearchDto,
} from '@project-hub/contracts';
import { readProjectFile, statProjectFile, toFilesError, writeProjectFile } from './file-io';
import { FilesError } from './files-error';
import { listDirectory, searchContent, searchNames } from './list-search';
import { resolveInProject } from './resolve-in-project';

/** O que o serviço precisa do resto do app: a pasta de cada projeto e a checagem de que ela existe. */
export type ProjectFilesDeps = {
  /** Pasta do projeto, ou `undefined` se o projeto não existe (ou foi removido). */
  rootOf(projectId: string): string | undefined;
  isDirectory(path: string): Promise<boolean>;
};

/**
 * Arquivos de um projeto, por id. O renderer só conhece o `projectId` e caminhos relativos em POSIX: a
 * pasta sai do registro, e todo caminho passa por `resolveInProject` antes de tocar o disco.
 */
export type ProjectFiles = {
  list(projectId: string, dir: string): Promise<FileEntryDto[]>;
  stat(projectId: string, path: string): Promise<FileStatDto>;
  read(projectId: string, path: string): Promise<FileContentDto>;
  write(input: FilesWriteInput): Promise<FileVersionDto>;
  /** Uma busca nova do mesmo projeto cancela a anterior (a cancelada devolve o que achou, truncada). */
  searchNames(projectId: string, query: string): Promise<NameSearchDto>;
  searchContent(projectId: string, query: string, regex: boolean): Promise<ContentSearchDto>;
  /** Caminho absoluto real de um arquivo do projeto, para o sistema abri-lo. Nunca sai do processo principal. */
  absolutePath(projectId: string, path: string): Promise<string>;
};

type SearchKind = 'names' | 'content';

export function createProjectFiles(deps: ProjectFilesDeps): ProjectFiles {
  /** A busca em andamento de cada projeto e tipo. */
  const searches = new Map<string, AbortController>();

  async function rootFor(projectId: string): Promise<string> {
    const root = deps.rootOf(projectId);
    if (root === undefined) throw new FilesError('PROJECT_NOT_FOUND', 'O projeto não foi encontrado.');
    if (!(await deps.isDirectory(root))) {
      throw new FilesError('PROJECT_PATH_UNAVAILABLE', 'A pasta do projeto não está disponível.');
    }
    return root;
  }

  /** Erro do sistema de arquivos vira `FilesError` de mensagem fixa: a original traz caminho absoluto. */
  async function guard<T>(run: () => Promise<T>): Promise<T> {
    try {
      return await run();
    } catch (error) {
      throw toFilesError(error);
    }
  }

  async function inProject<T>(
    projectId: string,
    path: string,
    run: (absolute: string) => Promise<T>,
  ): Promise<T> {
    const root = await rootFor(projectId);
    return guard(async () => run(await resolveInProject(root, path)));
  }

  /** Registra a busca nova e cancela a anterior do mesmo projeto e tipo, ainda antes de qualquer espera. */
  function startSearch(kind: SearchKind, projectId: string): AbortController {
    const key = `${kind}:${projectId}`;
    searches.get(key)?.abort();
    const controller = new AbortController();
    searches.set(key, controller);
    return controller;
  }

  function endSearch(kind: SearchKind, projectId: string, controller: AbortController): void {
    const key = `${kind}:${projectId}`;
    if (searches.get(key) === controller) searches.delete(key);
  }

  return {
    async list(projectId, dir) {
      const root = await rootFor(projectId);
      return guard(() => listDirectory(root, dir));
    },

    stat: (projectId, path) => inProject(projectId, path, statProjectFile),

    read: (projectId, path) => inProject(projectId, path, readProjectFile),

    async write(input) {
      // Recusa cedo pelo tamanho em bytes: o schema conta unidades de texto, e um acento pesa 2 bytes.
      if (Buffer.byteLength(input.text, 'utf8') > FILE_SIZE_LIMIT_BYTES) {
        throw new FilesError('FILE_TOO_LARGE', FILE_ERROR_MESSAGES.FILE_TOO_LARGE);
      }
      return inProject(input.projectId, input.path, (absolute) =>
        writeProjectFile(absolute, {
          text: input.text,
          eol: input.eol,
          bom: input.bom,
          expected: input.expected,
        }),
      );
    },

    async searchNames(projectId, query) {
      const controller = startSearch('names', projectId);
      try {
        const root = await rootFor(projectId);
        return await guard(() => searchNames(root, query, { signal: controller.signal }));
      } finally {
        endSearch('names', projectId, controller);
      }
    },

    async searchContent(projectId, query, regex) {
      const controller = startSearch('content', projectId);
      try {
        const root = await rootFor(projectId);
        return await guard(() => searchContent(root, query, regex, { signal: controller.signal }));
      } finally {
        endSearch('content', projectId, controller);
      }
    },

    absolutePath: (projectId, path) => inProject(projectId, path, (absolute) => Promise.resolve(absolute)),
  };
}
