import { z } from 'zod';

// A constante mora em `activity-window.ts`, sem dependências, para o renderer importá-la sem o zod.
// O barrel continua exportando `ACTIVITY_WINDOW_DAYS` para o processo principal.
export { ACTIVITY_WINDOW_DAYS } from './activity-window';

/**
 * Entrada de `activity:daily:v1`. O canal não recebe parâmetro: a janela é a fixa de 90 dias. Aceita
 * a chamada sem corpo ou com objeto vazio; qualquer outra coisa é recusada.
 */
export const activityDailyInputSchema = z.union([z.undefined(), z.object({}).strict()]);

/** Um dia local com eventos de missão: `date` é `AAAA-MM-DD` e `count` é o total do dia. */
export const activityDaySchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  count: z.number().int().nonnegative(),
});
export type ActivityDay = z.infer<typeof activityDaySchema>;

/** Resposta de `activity:daily:v1`. Os dias sem evento não vêm; quem consome preenche. */
export const activityDailyResponseSchema = z.array(activityDaySchema);
