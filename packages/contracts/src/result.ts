import { z } from 'zod';
import { appErrorSchema, type AppError } from './errors';

/** Envelope de toda resposta da API interna (seção 13.2): sucesso com `data` ou falha com `error`. */
export type AppResult<T> = { ok: true; data: T } | { ok: false; error: AppError };

/** Schema do envelope para um `data` do tipo `dataSchema`. */
export function appResultSchema<T extends z.ZodType>(dataSchema: T) {
  return z.union([
    z.object({ ok: z.literal(true), data: dataSchema }),
    z.object({ ok: z.literal(false), error: appErrorSchema }),
  ]);
}
