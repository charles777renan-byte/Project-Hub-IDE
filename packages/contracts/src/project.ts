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
  /** O projeto silenciou os próprios avisos (notificação do sistema e piscar). Ausente é o mesmo que falso. */
  muted?: boolean | undefined;
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
  muted: z.boolean().optional(),
});

/** Entrada de `projects:add:v1`: o caminho da pasta do projeto. */
export const addProjectInputSchema = z.object({ path: z.string().min(1) });

export type AddProjectInput = z.infer<typeof addProjectInputSchema>;

/** Autor de um commit: o nome e o e-mail que o Git grava no histórico. */
export type GitIdentity = { name: string; email: string };

/** Limites da identidade do Git: o nome com até 100 caracteres e o e-mail com até 254. */
export const GIT_IDENTITY_NAME_MAX_LENGTH = 100;
export const GIT_IDENTITY_EMAIL_MAX_LENGTH = 254;

/**
 * Schema de `GitIdentity`. Os dois valores são aparados e viram argumento do Git, então não começam com `-`
 * (o Git leria como opção) nem têm caractere de controle; `<` e `>` cercam o e-mail no histórico e não entram.
 * O e-mail só precisa de um `@` com algo de cada lado: o Git não exige uma caixa de correio de verdade.
 */
export const gitIdentitySchema: z.ZodType<GitIdentity> = z.object({
  name: z
    .string()
    .trim()
    .min(1)
    .max(GIT_IDENTITY_NAME_MAX_LENGTH)
    // eslint-disable-next-line no-control-regex
    .regex(/^[^-<>\u0000-\u001f\u007f][^<>\u0000-\u001f\u007f]*$/u),
  email: z
    .string()
    .trim()
    .min(3)
    .max(GIT_IDENTITY_EMAIL_MAX_LENGTH)
    .regex(/^[^-\s<>@][^\s<>@]*@[^\s<>@]+$/u),
});

/** O que a confirmação de criar o repositório Git mostra antes de qualquer escrita (ADR 0009). */
export type RepositoryInitPreview = {
  /** `user.name` e `user.email` estão configurados; sem eles o primeiro commit não sai. */
  identityConfigured: boolean;
  /**
   * Sem identidade no Git, o autor que o aplicativo propõe para o primeiro commit; a pessoa o vê na confirmação
   * e pode trocá-lo. Ausente quando o Git já tem identidade.
   */
  suggestedIdentity?: GitIdentity | undefined;
  /** A pasta não tem `.gitignore`, e o aplicativo cria um básico antes do primeiro commit. */
  createsGitignore: boolean;
  /** Arquivos com nome sensível (`.env`, `*.pem`, `*.key`) encontrados na pasta, relativos e com `/`. */
  sensitiveFiles: string[];
};

/** Schema de `RepositoryInitPreview`, para conferir a resposta de `projects:repository-preview:v1`. */
export const repositoryInitPreviewSchema: z.ZodType<RepositoryInitPreview> = z.object({
  identityConfigured: z.boolean(),
  suggestedIdentity: gitIdentitySchema.optional(),
  createsGitignore: z.boolean(),
  sensitiveFiles: z.array(z.string()),
});

/**
 * Entrada de `projects:init-repository:v1`: o projeto e, quando o Git não tem identidade, o autor que a pessoa
 * confirmou para o primeiro commit.
 */
export const initRepositoryInputSchema = z.object({
  projectId: z.string().min(1),
  identity: gitIdentitySchema.optional(),
});

export type InitRepositoryInput = z.infer<typeof initRepositoryInputSchema>;

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

/** Entrada de `projects:set-muted:v1`: liga (`true`) ou desliga o silêncio dos avisos do projeto. */
export const setProjectMutedInputSchema = z.object({
  projectId: z.string().min(1),
  muted: z.boolean(),
});

export type SetProjectMutedInput = z.infer<typeof setProjectMutedInputSchema>;
