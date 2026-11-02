import { failure } from '@project-hub/application';
import {
  CHANNELS,
  filesListInputSchema,
  filesPathInputSchema,
  filesSearchContentInputSchema,
  filesSearchNamesInputSchema,
  filesWriteInputSchema,
  type AppResult,
} from '@project-hub/contracts';
import { FilesError } from '../files/files-error';
import type { ProjectFiles } from '../files/project-files';
import { registerTrustedHandler, type IpcRegistry, type SenderCheck } from './trusted-handler';

/** O que os canais de arquivos precisam: o serviço de arquivos e o `shell.openPath` do Electron. */
export type FilesIpcDeps = {
  files: ProjectFiles;
  /** Abre o caminho no programa padrão do sistema. Devolve um texto vazio se abriu, ou a descrição do erro. */
  openPath(path: string): Promise<string>;
};

const INVALID_INPUT = 'Os dados do pedido não são válidos.';
const OPEN_FAILED = 'Não foi possível abrir o arquivo no programa padrão.';

/**
 * Roda o serviço e devolve o resultado. `FilesError` vira `failure(code, message)`: o
 * `registerTrustedHandler` só reconhece `GitError`, e o resto cairia em UNKNOWN. Qualquer outro erro
 * sobe e chega ao renderer como UNKNOWN, registrado no console.
 */
async function respond<T>(run: () => Promise<T>): Promise<AppResult<T>> {
  try {
    return { ok: true, data: await run() };
  } catch (error) {
    if (error instanceof FilesError) return failure(error.code, error.message);
    throw error;
  }
}

/**
 * Liga os sete canais `files:*`. Todos recusam remetente de outra origem (R65) e conferem a entrada com
 * zod antes de chamar o serviço. O renderer manda o id do projeto e um caminho relativo; o caminho
 * absoluto só existe aqui, no processo principal, e só vai ao `openPath`.
 */
export function registerFilesHandlers(
  registry: IpcRegistry,
  isTrusted: SenderCheck,
  deps: FilesIpcDeps,
): void {
  const { files } = deps;

  registerTrustedHandler(registry, CHANNELS.filesList, isTrusted, async (_event, payload) => {
    const input = filesListInputSchema.safeParse(payload);
    if (!input.success) return failure('VALIDATION_FAILED', INVALID_INPUT);
    return respond(() => files.list(input.data.projectId, input.data.dir));
  });

  registerTrustedHandler(registry, CHANNELS.filesStat, isTrusted, async (_event, payload) => {
    const input = filesPathInputSchema.safeParse(payload);
    if (!input.success) return failure('VALIDATION_FAILED', INVALID_INPUT);
    return respond(() => files.stat(input.data.projectId, input.data.path));
  });

  registerTrustedHandler(registry, CHANNELS.filesRead, isTrusted, async (_event, payload) => {
    const input = filesPathInputSchema.safeParse(payload);
    if (!input.success) return failure('VALIDATION_FAILED', INVALID_INPUT);
    return respond(() => files.read(input.data.projectId, input.data.path));
  });

  registerTrustedHandler(registry, CHANNELS.filesWrite, isTrusted, async (_event, payload) => {
    const input = filesWriteInputSchema.safeParse(payload);
    if (!input.success) return failure('VALIDATION_FAILED', INVALID_INPUT);
    return respond(() => files.write(input.data));
  });

  registerTrustedHandler(registry, CHANNELS.filesSearchNames, isTrusted, async (_event, payload) => {
    const input = filesSearchNamesInputSchema.safeParse(payload);
    if (!input.success) return failure('VALIDATION_FAILED', INVALID_INPUT);
    return respond(() => files.searchNames(input.data.projectId, input.data.query));
  });

  registerTrustedHandler(registry, CHANNELS.filesSearchContent, isTrusted, async (_event, payload) => {
    const input = filesSearchContentInputSchema.safeParse(payload);
    if (!input.success) return failure('VALIDATION_FAILED', INVALID_INPUT);
    return respond(() =>
      files.searchContent(input.data.projectId, input.data.query, input.data.regex),
    );
  });

  registerTrustedHandler(registry, CHANNELS.filesOpenDefault, isTrusted, async (_event, payload) => {
    const input = filesPathInputSchema.safeParse(payload);
    if (!input.success) return failure('VALIDATION_FAILED', INVALID_INPUT);
    return respond(async () => {
      const absolute = await files.absolutePath(input.data.projectId, input.data.path);
      if ((await deps.openPath(absolute)) !== '') throw new FilesError('UNKNOWN', OPEN_FAILED);
    });
  });
}
