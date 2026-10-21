import { ERROR_CODES, type AppResult, type ErrorCode } from '@project-hub/contracts';

/** Resposta de falha com código estável e mensagem segura para exibir (seção 13.1). */
export function failure(code: ErrorCode, message: string): AppResult<never> {
  return { ok: false, error: { code, message, retryable: false } };
}

/** O código do contrato que um erro traz, se ele traz um (o `GitError` traz). Fora da lista, `undefined`. */
export function errorCode(error: unknown): ErrorCode | undefined {
  if (typeof error !== 'object' || error === null || !('code' in error)) return undefined;
  const code = error.code;
  return typeof code === 'string' && (ERROR_CODES as readonly string[]).includes(code)
    ? (code as ErrorCode)
    : undefined;
}
