import { z } from 'zod';

/** Maior arquivo que o painel abre para edição: 2 MiB. Acima disso a leitura recusa com FILE_TOO_LARGE. */
export const FILE_SIZE_LIMIT_BYTES = 2 * 1024 * 1024;

/** Limites de tamanho dos textos de entrada. O caminho é sempre relativo à raiz do projeto, em POSIX. */
const PROJECT_ID_MAX = 200;
const PATH_MAX = 1024;
const QUERY_MAX = 200;

/**
 * Texto de erro de cada código de arquivo. É fixo e seguro para exibir: não leva caminho absoluto, nem
 * mensagem do sistema operacional. O serviço de arquivos monta o `AppError` com estes textos.
 */
export const FILE_ERROR_MESSAGES = {
  FILE_NOT_FOUND: 'O arquivo não existe mais no projeto.',
  FILE_TOO_LARGE: 'O arquivo passa de 2 MiB e não abre no editor.',
  FILE_NOT_TEXT: 'O arquivo não é de texto e não abre no editor.',
  FILE_CHANGED_ON_DISK: 'O arquivo mudou no disco depois de aberto.',
} as const;

const projectIdSchema = z.string().min(1).max(PROJECT_ID_MAX);
const relativePathSchema = z.string().min(1).max(PATH_MAX);
const queryTextSchema = z.string().min(1).max(QUERY_MAX);

/** Entrada de `files:list:v1`. `dir` vazio é a raiz do projeto. */
export const filesListInputSchema = z.object({
  projectId: projectIdSchema,
  dir: z.string().max(PATH_MAX),
});
export type FilesListInput = z.infer<typeof filesListInputSchema>;

/** Entrada de `files:stat:v1`, `files:read:v1` e `files:open-default:v1`. */
export const filesPathInputSchema = z.object({
  projectId: projectIdSchema,
  path: relativePathSchema,
});
export type FilesPathInput = z.infer<typeof filesPathInputSchema>;

/** Versão de um arquivo no disco: confere se ele mudou depois da leitura. O hash é SHA-256 em hexadecimal. */
export const fileVersionSchema = z.object({
  size: z.number().int().nonnegative(),
  mtimeMs: z.number().nonnegative(),
  hash: z.string().regex(/^[0-9a-f]{64}$/),
});
export type FileVersionDto = z.infer<typeof fileVersionSchema>;

/**
 * Entrada de `files:write:v1`. O texto vem com `\n` e o serviço converte para `eol`. `expected` é a versão
 * lida; `null` cria um arquivo novo e recusa se ele já existir.
 */
export const filesWriteInputSchema = z.object({
  projectId: projectIdSchema,
  path: relativePathSchema,
  text: z.string().max(FILE_SIZE_LIMIT_BYTES),
  eol: z.enum(['lf', 'crlf']),
  bom: z.boolean(),
  expected: fileVersionSchema.nullable(),
});
export type FilesWriteInput = z.infer<typeof filesWriteInputSchema>;

/** Entrada de `files:search-names:v1`. */
export const filesSearchNamesInputSchema = z.object({
  projectId: projectIdSchema,
  query: queryTextSchema,
});
export type FilesSearchNamesInput = z.infer<typeof filesSearchNamesInputSchema>;

/** Entrada de `files:search-content:v1`. Com `regex` falso, a consulta é um texto literal. */
export const filesSearchContentInputSchema = z.object({
  projectId: projectIdSchema,
  query: queryTextSchema,
  regex: z.boolean(),
});
export type FilesSearchContentInput = z.infer<typeof filesSearchContentInputSchema>;

/** Uma entrada de pasta. `path` é relativo ao projeto, em POSIX; `ignored` marca o que o .gitignore cobre. */
export const fileEntrySchema = z.object({
  name: z.string(),
  path: z.string(),
  kind: z.enum(['file', 'directory']),
  ignored: z.boolean(),
});
export type FileEntryDto = z.infer<typeof fileEntrySchema>;

/** Resposta de `files:stat:v1`: o arquivo pode não existir. */
export const fileStatSchema = z.discriminatedUnion('exists', [
  z.object({ exists: z.literal(false) }),
  z.object({ exists: z.literal(true), version: fileVersionSchema }),
]);
export type FileStatDto = z.infer<typeof fileStatSchema>;

/** Resposta de `files:read:v1`. O texto sai com `\n`; `eol` e `bom` dizem como o arquivo estava. */
export const fileContentSchema = z.object({
  text: z.string(),
  eol: z.enum(['lf', 'crlf', 'mixed']),
  bom: z.boolean(),
  version: fileVersionSchema,
});
export type FileContentDto = z.infer<typeof fileContentSchema>;

/** Resposta de `files:search-names:v1`. `truncated` avisa que a busca parou no limite de entradas. */
export const nameSearchSchema = z.object({
  paths: z.array(z.string()),
  truncated: z.boolean(),
});
export type NameSearchDto = z.infer<typeof nameSearchSchema>;

/** Uma linha que casou na busca por conteúdo. `line` conta a partir de 1. */
export const contentMatchSchema = z.object({
  path: z.string(),
  line: z.number().int().positive(),
  text: z.string(),
});
export type ContentMatchDto = z.infer<typeof contentMatchSchema>;

/** Resposta de `files:search-content:v1`. `truncated` avisa que a busca parou no limite de resultados ou de tempo. */
export const contentSearchSchema = z.object({
  matches: z.array(contentMatchSchema),
  truncated: z.boolean(),
});
export type ContentSearchDto = z.infer<typeof contentSearchSchema>;
