import { z } from 'zod';
import { appErrorSchema } from './errors';

/**
 * Aba Checks do painel direito (fase 3). Os valores dos enums saem da saída real do `gh pr view --json ...`
 * (fixture em `test/fixtures/gh-pr-view.json`) e dos enums do GraphQL do GitHub. O adaptador converte a saída
 * do `gh` para estes formatos; o renderer importa daqui só os tipos.
 */

/** Limites de tamanho dos textos de entrada. */
const PROJECT_ID_MAX = 200;
/** O GitHub recusa comentário com mais de 65 536 caracteres. */
const COMMENT_BODY_MAX = 65_536;

const projectIdSchema = z.string().min(1, 'Informe o projeto.').max(PROJECT_ID_MAX);

/** Número de PR: inteiro positivo. Nunca vira argumento do `gh` sem passar por aqui. */
export const prNumberSchema = z
  .number('Informe o número do PR.')
  .int('O número do PR precisa ser inteiro.')
  .positive('O número do PR precisa ser maior que zero.');
export type PrNumber = z.infer<typeof prNumberSchema>;

/** Entrada de `github:pr:v1`: o PR é o da branch atual do projeto, descoberto no processo principal. */
export const githubProjectInputSchema = z.object({ projectId: projectIdSchema });
export type GithubProjectInput = z.infer<typeof githubProjectInputSchema>;

/** Corpo do comentário: sem espaços nas pontas, de 1 a 65 536 caracteres. Só espaços vale como vazio. */
export const githubCommentBodySchema = z
  .string()
  .trim()
  .min(1, 'Escreva o comentário.')
  .max(COMMENT_BODY_MAX, 'O comentário passa de 65 536 caracteres.');

/** Entrada de `github:comment:v1`. */
export const githubCommentInputSchema = z.object({
  projectId: projectIdSchema,
  prNumber: prNumberSchema,
  body: githubCommentBodySchema,
});
export type GithubCommentInput = z.infer<typeof githubCommentInputSchema>;

/** Como o PR é mesclado (`gh pr merge --merge|--squash|--rebase`). */
export const GITHUB_MERGE_METHODS = ['merge', 'squash', 'rebase'] as const;
export const githubMergeMethodSchema = z.enum(GITHUB_MERGE_METHODS);
export type GithubMergeMethod = z.infer<typeof githubMergeMethodSchema>;

/** Entrada de `github:merge:v1`. */
export const githubMergeInputSchema = z.object({
  projectId: projectIdSchema,
  prNumber: prNumberSchema,
  method: githubMergeMethodSchema,
});
export type GithubMergeInput = z.infer<typeof githubMergeInputSchema>;

/** Estado do PR (`state` do `gh pr view`). */
export const PR_STATES = ['OPEN', 'MERGED', 'CLOSED'] as const;
/** Se o PR pode ser mesclado sem conflito (`mergeable`). `UNKNOWN` enquanto o GitHub calcula, e nos PRs encerrados. */
export const PR_MERGEABLE_VALUES = ['MERGEABLE', 'CONFLICTING', 'UNKNOWN'] as const;
/** Situação do merge (`mergeStateStatus`, enum `MergeStateStatus` do GraphQL). */
export const PR_MERGE_STATE_STATUSES = [
  'BEHIND',
  'BLOCKED',
  'CLEAN',
  'DIRTY',
  'DRAFT',
  'HAS_HOOKS',
  'UNKNOWN',
  'UNSTABLE',
] as const;
/** Decisão da revisão (`reviewDecision`). O `gh` devolve texto vazio sem decisão; o adaptador converte para `null`. */
export const PR_REVIEW_DECISIONS = ['APPROVED', 'CHANGES_REQUESTED', 'REVIEW_REQUIRED'] as const;

/** Resumo de um PR, como o cabeçalho da aba Checks o mostra. */
export const prSummarySchema = z.object({
  number: prNumberSchema,
  title: z.string(),
  state: z.enum(PR_STATES),
  isDraft: z.boolean(),
  mergeable: z.enum(PR_MERGEABLE_VALUES),
  mergeStateStatus: z.enum(PR_MERGE_STATE_STATUSES),
  url: z.url(),
  /** ISO 8601 em UTC (`2026-11-03T20:53:49Z`). */
  updatedAt: z.string(),
  /** Branch de origem do PR. */
  headRefName: z.string(),
  /** Branch de destino do PR. */
  baseRefName: z.string(),
  /** Linhas somadas e removidas pelo PR inteiro. */
  additions: z.number().int().nonnegative(),
  deletions: z.number().int().nonnegative(),
  reviewDecision: z.enum(PR_REVIEW_DECISIONS).nullable(),
});
export type PrSummaryDto = z.infer<typeof prSummarySchema>;

/** `status` de um `CheckRun` (enum `CheckStatusState` do GraphQL). */
export const CHECK_RUN_STATUSES = [
  'COMPLETED',
  'IN_PROGRESS',
  'PENDING',
  'QUEUED',
  'REQUESTED',
  'WAITING',
] as const;
/** `conclusion` de um `CheckRun` já concluído (enum `CheckConclusionState` do GraphQL). */
export const CHECK_RUN_CONCLUSIONS = [
  'ACTION_REQUIRED',
  'CANCELLED',
  'FAILURE',
  'NEUTRAL',
  'SKIPPED',
  'STALE',
  'STARTUP_FAILURE',
  'SUCCESS',
  'TIMED_OUT',
] as const;
/** `state` de um `StatusContext` (enum `StatusState` do GraphQL). */
export const STATUS_CONTEXT_STATES = [
  'ERROR',
  'EXPECTED',
  'FAILURE',
  'PENDING',
  'SUCCESS',
] as const;

/** Check do GitHub Actions (ou de outro app de checks): tem início, fim e conclusão. */
export const checkRunSchema = z.object({
  kind: z.literal('check-run'),
  name: z.string(),
  /** Nome do workflow, quando o check vem de um (`CI`). */
  workflowName: z.string().nullable(),
  status: z.enum(CHECK_RUN_STATUSES),
  /** `null` enquanto o check não terminou. */
  conclusion: z.enum(CHECK_RUN_CONCLUSIONS).nullable(),
  startedAt: z.string().nullable(),
  completedAt: z.string().nullable(),
  detailsUrl: z.string().nullable(),
});
export type CheckRunDto = z.infer<typeof checkRunSchema>;

/** Status antigo de commit (API de statuses): só tem um estado e um contexto. */
export const statusContextSchema = z.object({
  kind: z.literal('status-context'),
  /** O `context` do status (`ci/build`). */
  name: z.string(),
  state: z.enum(STATUS_CONTEXT_STATES),
  targetUrl: z.string().nullable(),
  startedAt: z.string().nullable(),
});
export type StatusContextDto = z.infer<typeof statusContextSchema>;

/** Um item do `statusCheckRollup`: `CheckRun` ou `StatusContext`, separados pelo campo `kind`. */
export const checkSchema = z.discriminatedUnion('kind', [checkRunSchema, statusContextSchema]);
export type CheckDto = z.infer<typeof checkSchema>;

/** Comentário do PR. O corpo é texto não confiável: a tela o mostra como texto puro. */
export const commentSchema = z.object({
  /** Login de quem comentou. */
  author: z.string(),
  body: z.string(),
  createdAt: z.string(),
});
export type CommentDto = z.infer<typeof commentSchema>;

/** Uma leitura completa do PR: resumo, checks e comentários, com a hora em que foi feita (ISO 8601). */
export const prReadingSchema = z.object({
  pr: prSummarySchema,
  checks: z.array(checkSchema),
  comments: z.array(commentSchema),
  readAt: z.string(),
});
export type PrReadingDto = z.infer<typeof prReadingSchema>;

/**
 * Resultado de ler o PR. `ok`: a leitura acabou de ser feita. `stale`: a leitura de agora falhou (rede,
 * login) e `reading` é a última que deu certo, junto com o erro que impediu a nova.
 */
export const prResultSchema = z.discriminatedUnion('state', [
  z.object({ state: z.literal('ok'), reading: prReadingSchema }),
  z.object({ state: z.literal('stale'), reading: prReadingSchema, error: appErrorSchema }),
]);
export type PrResultDto = z.infer<typeof prResultSchema>;

/**
 * Resposta de `github:pr:v1`. `no-pr`: a branch atual não tem PR. `not-applicable`: a pasta não tem
 * `origin`, ou o `origin` não é do `github.com`. Falhas (sem `gh`, sem login, sem rede) vão no `error` do
 * `AppResult`, não aqui.
 */
export const githubPanelSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('pr'), result: prResultSchema }),
  z.object({ kind: z.literal('no-pr') }),
  z.object({ kind: z.literal('not-applicable') }),
]);
export type GithubPanelDto = z.infer<typeof githubPanelSchema>;
