import { z } from 'zod';

/**
 * Códigos de erro estáveis do envelope `AppResult` (seções 13.1 e 13.7 do planejamento).
 * A lista é a fonte única: o tipo `ErrorCode` sai dela, e os testes conferem o conteúdo em execução.
 */
export const ERROR_CODES = [
  // Seção 13.7, na ordem do planejamento.
  'PROJECT_NOT_FOUND',
  'PROJECT_PATH_UNAVAILABLE',
  'PROJECT_ALREADY_EXISTS',
  'GIT_NOT_AVAILABLE',
  'GIT_DIRTY_BASE_REQUIRES_DECISION',
  'WORKTREE_COLLISION',
  'WORKTREE_CREATE_FAILED',
  'MISSION_INVALID_STATE',
  'AGENT_UNAVAILABLE',
  'AGENT_AUTH_REQUIRED',
  'AGENT_PROTOCOL_ERROR',
  'APPROVAL_REQUIRED',
  'APPROVAL_EXPIRED',
  'PROCESS_START_FAILED',
  'PERMISSION_DENIED',
  'PATH_OUTSIDE_ALLOWED_SCOPE',
  'DATABASE_MIGRATION_FAILED',
  // Acrescentados pela Tarefa 2 do plano de fundação.
  'WORKTREE_HAS_UNSAVED_CHANGES',
  'PROJECT_WITHOUT_GIT',
  'VALIDATION_FAILED',
  'UNKNOWN',
  // Acrescentados pela Tarefa 9: a seção 13.7 não traz código de "não encontrado" para missão nem
  // para aprovação.
  'MISSION_NOT_FOUND',
  'APPROVAL_NOT_FOUND',
  // Acrescentado pela Tarefa 10b: nenhum código da seção 13.7 serve para um agente que não pausa.
  'AGENT_CAPABILITY_UNSUPPORTED',
  // Acrescentados pela Tarefa 4 do plano de agente real: o terminal de um agente ou de um shell.
  'TERMINAL_NOT_FOUND',
  'TERMINAL_ALREADY_EXISTS',
  'TERMINAL_EXITED',
  'TERMINAL_HOST_UNAVAILABLE',
  // Acrescentado pelo plano de travas do Git: nenhum código da seção 13.7 diz "o Git está travado,
  // tente depois".
  'GIT_LOCKED',
  // Acrescentados pelo plano do painel direito: arquivos do projeto lidos e gravados pelo editor.
  'FILE_NOT_FOUND',
  'FILE_TOO_LARGE',
  'FILE_NOT_TEXT',
  'FILE_CHANGED_ON_DISK',
] as const;

export type ErrorCode = (typeof ERROR_CODES)[number];

/** Erro de uma resposta: `code` é estável e `message` é segura para exibir (seção 13.1). */
export type AppError = {
  code: ErrorCode;
  message: string;
  details?: Record<string, unknown>;
  retryable: boolean;
};

/** Confere um `AppError` que chegou de fora do contrato (o preload confere respostas, R28). */
export const appErrorSchema = z.object({
  code: z.enum(ERROR_CODES),
  message: z.string(),
  details: z.record(z.string(), z.unknown()).optional(),
  retryable: z.boolean(),
});
