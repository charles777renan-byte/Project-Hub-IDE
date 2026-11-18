import { z } from 'zod';

/** O que avisa: uma missão, ou um terminal avulso (sem missão). */
export const ALERT_KIND_VALUES = ['mission', 'terminal'] as const;

/**
 * Entrada de `alerts:notify:v1`: o renderer diz só qual item passou a esperar a pessoa. O texto da notificação é
 * montado pelo processo principal com os dados dele (RF-OBS-009); por isso o schema é estrito e recusa qualquer campo
 * a mais.
 */
export const alertNotifyInputSchema = z
  .object({ kind: z.enum(ALERT_KIND_VALUES), id: z.string().min(1) })
  .strict();

export type AlertNotifyInput = z.infer<typeof alertNotifyInputSchema>;

/** Evento de `alerts:open:v1`: a pessoa clicou na notificação. Do processo principal para o renderer; não tem resposta. */
export const alertOpenEventSchema = z.object({
  kind: z.enum(ALERT_KIND_VALUES),
  projectId: z.string().min(1),
  id: z.string().min(1),
});

export type AlertOpenEvent = z.infer<typeof alertOpenEventSchema>;
