import type { AppResult, ErrorCode } from '@project-hub/contracts';

/** Resposta de falha com código estável e mensagem segura para exibir (seção 13.1). */
export function failure(code: ErrorCode, message: string): AppResult<never> {
  return { ok: false, error: { code, message, retryable: false } };
}
