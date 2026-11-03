import { z } from 'zod';

/**
 * Painel de código-fonte (ADR 0010). Os formatos de saída espelham as leituras do adaptador Git, mas este
 * módulo não depende dele: o contrato é a base, e o renderer importa daqui só os tipos.
 */

/** Limites de tamanho dos textos de entrada. */
const PROJECT_ID_MAX = 200;
const PATH_MAX = 1024;
const PATHS_MAX = 5000;
const COMMIT_MESSAGE_MAX = 10_000;

const projectIdSchema = z.string().min(1, 'Informe o projeto.').max(PROJECT_ID_MAX);

/**
 * Caminho de arquivo do projeto: relativo à pasta do projeto, em POSIX. Recusa vazio, caminho absoluto
 * (`/x`, `C:\x`, `C:/x`), barra invertida, o segmento `..` e a pasta `.git` (inclusive `./.git/...`).
 */
export const gitPathSchema = z
  .string()
  .min(1, 'Informe o caminho do arquivo.')
  .max(PATH_MAX, 'O caminho é longo demais.')
  .refine((path) => !path.includes('\0'), 'O caminho tem um caractere inválido.')
  .refine(
    (path) => !path.startsWith('/') && !/^[A-Za-z]:/u.test(path) && !path.includes('\\'),
    'O caminho precisa ser relativo à pasta do projeto, com barras normais.',
  )
  .refine((path) => !path.split('/').includes('..'), 'O caminho não pode sair da pasta do projeto.')
  .refine(
    (path) => !/^(?:\.\/)*\.git(?:\/|$)/iu.test(path),
    'A pasta interna do Git não pode ser alterada pelo painel.',
  );
export type GitPath = z.infer<typeof gitPathSchema>;

/** Mensagem de commit: sem espaços nas pontas, de 1 a 10 000 caracteres. Só espaços vale como vazia. */
export const commitMessageSchema = z
  .string()
  .trim()
  .min(1, 'Escreva a mensagem do commit.')
  .max(COMMIT_MESSAGE_MAX, 'A mensagem do commit passa de 10 000 caracteres.');
export type CommitMessage = z.infer<typeof commitMessageSchema>;

/** Entrada de `git:status:v1`, `git:push:v1`, `git:pull:v1`, `git:fetch:v1`, `git:log:v1` e `git:branch-changes:v1`. */
export const gitProjectInputSchema = z.object({ projectId: projectIdSchema });
export type GitProjectInput = z.infer<typeof gitProjectInputSchema>;

/** Entrada de `git:diff:v1`: o diff de um arquivo contra o último commit (`HEAD`). */
export const gitDiffInputSchema = z.object({ projectId: projectIdSchema, path: gitPathSchema });
export type GitDiffInput = z.infer<typeof gitDiffInputSchema>;

/** Entrada de `git:stage:v1`, `git:unstage:v1` e `git:discard:v1`. */
export const gitPathsInputSchema = z.object({
  projectId: projectIdSchema,
  paths: z.array(gitPathSchema).min(1, 'Escolha ao menos um arquivo.').max(PATHS_MAX),
});
export type GitPathsInput = z.infer<typeof gitPathsInputSchema>;

/** Entrada de `git:commit:v1`: cria o commit com o que está em stage. */
export const gitCommitInputSchema = z.object({
  projectId: projectIdSchema,
  message: commitMessageSchema,
});
export type GitCommitInput = z.infer<typeof gitCommitInputSchema>;

/** Estado de um arquivo em stage (modificado, adicionado, apagado, renomeado). */
export const GIT_STAGED_STATES = ['M', 'A', 'D', 'R'] as const;
/** Estado de um arquivo fora do stage (modificado, apagado, em conflito). */
export const GIT_UNSTAGED_STATES = ['M', 'D', 'U'] as const;

export const gitPanelFileSchema = z.object({
  /** Caminho relativo à pasta do projeto, em POSIX. */
  path: z.string(),
  staged: z.enum(GIT_STAGED_STATES).nullable(),
  unstaged: z.enum(GIT_UNSTAGED_STATES).nullable(),
});
export type GitPanelFileDto = z.infer<typeof gitPanelFileSchema>;

/** Resposta de `git:status:v1`. */
export const gitStatusSchema = z.object({
  /** Branch atual; `null` com o HEAD destacado. */
  branch: z.string().nullable(),
  /** Branch remota que a atual acompanha (por exemplo `origin/main`), ou `null`. */
  upstream: z.string().nullable(),
  /** Commits à frente e atrás do upstream; `null` sem upstream ou quando a ref remota sumiu. */
  ahead: z.number().int().nonnegative().nullable(),
  behind: z.number().int().nonnegative().nullable(),
  /** Com o que a branch é comparada (`origin/main`); `null` quando essa ref não existe. */
  baseRef: z.string().nullable(),
  /** Linhas somadas e removidas em relação à base (binários não contam); `null` sem base. */
  linesAdded: z.number().int().nonnegative().nullable(),
  linesRemoved: z.number().int().nonnegative().nullable(),
  files: z.array(gitPanelFileSchema),
});
export type GitStatusDto = z.infer<typeof gitStatusSchema>;

/** Um commit do histórico da branch, em `git:log:v1`. */
export const gitLogEntrySchema = z.object({
  sha: z.string(),
  shortSha: z.string(),
  author: z.string(),
  /** Data do autor em ISO 8601 (`2026-11-02T18:51:40-03:00`). */
  date: z.string(),
  /** Etiquetas do commit, como o Git as escreve: `HEAD -> main`, `tag: v1.0`, `origin/main`. */
  refs: z.array(z.string()),
  subject: z.string(),
});
export type GitLogEntryDto = z.infer<typeof gitLogEntrySchema>;

/** Um arquivo alterado pela branch em relação à base, em `git:branch-changes:v1`. */
export const branchChangeSchema = z.object({
  path: z.string(),
  status: z.enum(['M', 'A', 'D']),
  /** Linhas somadas e removidas; `null` em arquivo binário. */
  added: z.number().int().nonnegative().nullable(),
  removed: z.number().int().nonnegative().nullable(),
});
export type BranchChangeDto = z.infer<typeof branchChangeSchema>;

/** Resposta de `git:branch-changes:v1`. */
export const branchChangesSchema = z.object({
  baseRef: z.string().nullable(),
  /** Ponto de partida da branch em relação à base; `null` sem base ou sem ancestral comum. */
  mergeBase: z.string().nullable(),
  files: z.array(branchChangeSchema),
});
export type BranchChangesDto = z.infer<typeof branchChangesSchema>;

/**
 * Resposta de `git:diff:v1`: o diff de um arquivo contra o último commit (`HEAD`). Não reutiliza
 * `missionDiffDtoSchema`, que descreve as alterações do worktree de uma missão em relação ao HEAD (lista de
 * arquivos, sem a ref comparada).
 */
export const gitFileDiffSchema = z.object({
  path: z.string(),
  /** A ref comparada: sempre `HEAD`. */
  baseRef: z.string(),
  /** Só os trechos (`@@`), em diff unificado. Vazio em binário e em arquivo sem mudança. */
  patch: z.string(),
  binary: z.boolean(),
  /** O patch passou do limite, e vem só o começo. */
  truncated: z.boolean(),
});
export type GitFileDiffDto = z.infer<typeof gitFileDiffSchema>;

/** Resposta de `git:commit:v1`: o nome completo do commit criado. */
export const gitCommitResultSchema = z.object({ commit: z.string() });
export type GitCommitResultDto = z.infer<typeof gitCommitResultSchema>;

/** Resposta de `git:push:v1`: a branch enviada. */
export const gitPushResultSchema = z.object({ branch: z.string() });
export type GitPushResultDto = z.infer<typeof gitPushResultSchema>;

/** Resposta de `git:pull:v1`: `updated` diz se a branch avançou. */
export const gitPullResultSchema = z.object({ updated: z.boolean() });
export type GitPullResultDto = z.infer<typeof gitPullResultSchema>;
