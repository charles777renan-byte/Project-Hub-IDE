import { z } from 'zod';

/** Projeto como o renderer o recebe na listagem. `defaultBranch` vem só para pasta com Git. */
export type ProjectSummary = {
  id: string;
  name: string;
  path: string;
  repositoryKind: 'git' | 'none';
  available: boolean;
  defaultBranch?: string | undefined;
  /** Grupo da barra lateral (Trabalho, Pessoal...), quando a pessoa escolheu um. */
  group?: string | undefined;
  /** Apelido curto, mostrado no lugar do nome da pasta, quando a pessoa escolheu um. */
  nickname?: string | undefined;
};

/** Schema de `ProjectSummary`, para conferir a resposta que vem do processo principal. */
export const projectSummarySchema: z.ZodType<ProjectSummary> = z.object({
  id: z.string(),
  name: z.string(),
  path: z.string(),
  repositoryKind: z.enum(['git', 'none']),
  available: z.boolean(),
  defaultBranch: z.string().optional(),
  group: z.string().optional(),
  nickname: z.string().optional(),
});

/** Entrada de `projects:add:v1`: o caminho da pasta do projeto. */
export const addProjectInputSchema = z.object({ path: z.string().min(1) });

export type AddProjectInput = z.infer<typeof addProjectInputSchema>;

/** O que a confirmação de criar o repositório Git mostra antes de qualquer escrita (ADR 0009). */
export type RepositoryInitPreview = {
  /** `user.name` e `user.email` estão configurados; sem eles o primeiro commit não sai. */
  identityConfigured: boolean;
  /** A pasta não tem `.gitignore`, e o aplicativo cria um básico antes do primeiro commit. */
  createsGitignore: boolean;
  /** Arquivos com nome sensível (`.env`, `*.pem`, `*.key`) encontrados na pasta, relativos e com `/`. */
  sensitiveFiles: string[];
};

/** Schema de `RepositoryInitPreview`, para conferir a resposta de `projects:repository-preview:v1`. */
export const repositoryInitPreviewSchema: z.ZodType<RepositoryInitPreview> = z.object({
  identityConfigured: z.boolean(),
  createsGitignore: z.boolean(),
  sensitiveFiles: z.array(z.string()),
});

/** Entrada de arquivar, desarquivar e remover: o projeto que a pessoa escolheu. */
export const projectIdInputSchema = z.object({ projectId: z.string().min(1) });

export type ProjectIdInput = z.infer<typeof projectIdInputSchema>;

/**
 * Entrada de `projects:set-group:v1`. `group` nulo ou vazio tira o projeto do grupo. O limite de 40 caracteres
 * (depois de aparar os espaços) é o mesmo da aplicação e do campo da página do projeto.
 */
export const setProjectGroupInputSchema = z.object({
  projectId: z.string().min(1),
  group: z.string().trim().max(40).nullable(),
});

export type SetProjectGroupInput = z.infer<typeof setProjectGroupInputSchema>;

/** Entrada de `projects:set-nickname:v1`. `nickname` nulo ou vazio tira o apelido (limite de 24 caracteres após aparar). */
export const setProjectNicknameInputSchema = z.object({
  projectId: z.string().min(1),
  nickname: z.string().trim().max(24).nullable(),
});

export type SetProjectNicknameInput = z.infer<typeof setProjectNicknameInputSchema>;
