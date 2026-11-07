import { z } from 'zod';

/** Programas cujo histórico o painel lê (fase 4). O shell não tem sessão. */
export const SESSION_PROVIDERS = ['claude', 'codex', 'antigravity'] as const;
export const sessionProviderSchema = z.enum(SESSION_PROVIDERS);
export type SessionProvider = z.infer<typeof sessionProviderSchema>;

/** Limites dos textos de uma sessão. O leitor corta antes; o schema recusa o que passar disso. */
export const SESSION_FIRST_PROMPT_MAX = 2000;
export const SESSION_LAST_AGENT_TEXT_MAX = 400;
export const SESSION_TURN_MAX = 600;
export const SESSION_LAST_TURNS_MAX = 4;

/** Id de sessão: UUID minúsculo, o formato que os três programas usam. Qualquer outro texto não passa. */
const SESSION_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
export const sessionIdSchema = z.string().regex(SESSION_ID);

const workspaceIdSchema = z.string().min(1).max(128);
const projectIdSchema = z.string().min(1).max(200);

export const sessionTurnSchema = z.object({
  role: z.enum(['user', 'agent']),
  text: z.string().max(SESSION_TURN_MAX),
});

/** Uma sessão do histórico. Texto vem como texto puro; o renderer nunca o interpreta como HTML ou Markdown. */
export const sessionSummarySchema = z.object({
  id: sessionIdSchema,
  provider: sessionProviderSchema,
  title: z.string().max(200).nullable(),
  /** Pasta de trabalho da sessão. Só para exibir: o processo principal não aceita caminho vindo daqui. */
  folder: z.string().min(1).max(1024),
  projectId: projectIdSchema.nullable(),
  branch: z.string().max(200).nullable(),
  isWorktree: z.boolean(),
  startedAt: z.string().min(1).max(40),
  lastActivityAt: z.string().min(1).max(40),
  messages: z.number().int().min(0).nullable(),
  subagents: z.number().int().min(0).nullable(),
  model: z.string().max(100).nullable(),
  firstPrompt: z.string().max(SESSION_FIRST_PROMPT_MAX).nullable(),
  lastAgentText: z.string().max(SESSION_LAST_AGENT_TEXT_MAX).nullable(),
  lastTurns: z.array(sessionTurnSchema).max(SESSION_LAST_TURNS_MAX).nullable(),
  resumable: z.boolean(),
  resumeBlockedReason: z.string().max(300).nullable(),
});
export type SessionSummary = z.infer<typeof sessionSummarySchema>;

/** Progresso da leitura por programa: `unreadable` conta os arquivos que falharam, nunca vira zero em silêncio. */
export const sessionsIndexingSchema = z.object({
  provider: sessionProviderSchema,
  read: z.number().int().min(0),
  total: z.number().int().min(0),
  unreadable: z.number().int().min(0),
});

export const sessionsListResultSchema = z.object({
  sessions: z.array(sessionSummarySchema),
  indexing: z.array(sessionsIndexingSchema),
});
export type SessionsListResult = z.infer<typeof sessionsListResultSchema>;

/** Escopo: `workspace` (pasta do projeto e o que está dentro), `project` (projeto e os worktrees) ou `all`. */
export const sessionsListInputSchema = z
  .object({
    scope: z.enum(['workspace', 'project', 'all']),
    projectId: projectIdSchema.optional(),
  })
  .refine((input) => input.scope === 'all' || input.projectId !== undefined, {
    message: 'Informe o projeto para este escopo.',
    path: ['projectId'],
  });
export type SessionsListInput = z.infer<typeof sessionsListInputSchema>;

/** Retomar em Worktree: só o workspace e o id da sessão. Nenhum caminho, comando ou argumento. */
export const sessionsResumeInputSchema = z.object({
  workspaceId: workspaceIdSchema,
  sessionId: sessionIdSchema,
});
export type SessionsResumeInput = z.infer<typeof sessionsResumeInputSchema>;
