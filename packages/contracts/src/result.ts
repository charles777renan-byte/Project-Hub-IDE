import type { AppError } from './errors';

/** Envelope de toda resposta da API interna (seção 13.2): sucesso com `data` ou falha com `error`. */
export type AppResult<T> = { ok: true; data: T } | { ok: false; error: AppError };
