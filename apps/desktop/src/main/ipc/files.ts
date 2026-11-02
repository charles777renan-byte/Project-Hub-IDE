import { stat } from 'node:fs/promises';
import { extname, basename } from 'node:path';
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
const OPEN_REFUSED = 'Só arquivos comuns, que não executam programas, abrem no programa padrão.';

/**
 * Extensões que o sistema executa ou interpreta ao abrir (programas, scripts, atalhos, instaladores,
 * bibliotecas). O `shell.openPath` rodaria o arquivo, e um agente pode ter escrito qualquer um deles no
 * projeto; por isso "Abrir no programa padrão" os recusa.
 */
const BLOCKED_OPEN_EXTENSIONS: ReadonlySet<string> = new Set([
  '.exe', '.com', '.bat', '.cmd', '.lnk', '.js', '.jse', '.vbs', '.vbe', '.wsf', '.hta', '.msi',
  '.scr', '.cpl', '.ps1', '.url', '.reg', '.dll', '.jar', '.sh',
  '.pif', '.msc', '.msp', '.scf', '.inf', '.chm', '.wsh', '.psm1', '.application', '.appref-ms',
]);

/** Extensão em minúsculas; o Windows ignora pontos e espaços no fim do nome, então `x.exe .` também é `.exe`. */
function openExtension(path: string): string {
  return extname(basename(path).replace(/[. ]+$/, '')).toLowerCase();
}

/** Só um arquivo comum, de extensão fora da lista, vai ao sistema; pasta e link abririam outra coisa. */
async function mayOpenByDefault(requested: string, absolute: string): Promise<boolean> {
  if (BLOCKED_OPEN_EXTENSIONS.has(openExtension(requested))) return false;
  if (BLOCKED_OPEN_EXTENSIONS.has(openExtension(absolute))) return false;
  try {
    return (await stat(absolute)).isFile();
  } catch {
    return false;
  }
}

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
      if (!(await mayOpenByDefault(input.data.path, absolute))) {
        throw new FilesError('PERMISSION_DENIED', OPEN_REFUSED);
      }
      if ((await deps.openPath(absolute)) !== '') throw new FilesError('UNKNOWN', OPEN_FAILED);
    });
  });
}
