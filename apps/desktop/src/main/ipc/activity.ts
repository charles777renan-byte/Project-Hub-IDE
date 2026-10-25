import { failure } from '@project-hub/application';
import {
  ACTIVITY_WINDOW_DAYS,
  CHANNELS,
  activityDailyInputSchema,
  activityDailyResponseSchema,
  type ActivityDay,
  type AppResult,
} from '@project-hub/contracts';
import { registerTrustedHandler, type IpcRegistry, type SenderCheck } from './trusted-handler';

/** O que o canal de atividade precisa: a contagem por dia local no banco e o relógio. */
export type ActivityIpcDeps = {
  /** Eventos de missão por dia local, a partir do instante ISO dado. Só leitura. */
  countByLocalDay(sinceIso: string): ActivityDay[];
  now(): Date;
};

/**
 * Início da janela: a meia-noite local do dia mais antigo. Com 90 dias contando hoje, é hoje menos
 * 89 dias. O `Date` com componentes locais já acerta a virada de horário de verão.
 */
export function activityWindowStart(now: Date): string {
  return new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate() - (ACTIVITY_WINDOW_DAYS - 1),
  ).toISOString();
}

/** Atividade diária dos últimos 90 dias. Não aceita parâmetro; a resposta é conferida antes de sair. */
export function handleActivityDaily(
  deps: ActivityIpcDeps,
  payload: unknown,
): Promise<AppResult<ActivityDay[]>> {
  if (!activityDailyInputSchema.safeParse(payload).success) {
    return Promise.resolve(failure('VALIDATION_FAILED', 'Este pedido não recebe parâmetros.'));
  }
  // Falha na leitura ou resposta fora do contrato lança; o registro confiável a vira em UNKNOWN.
  const days = activityDailyResponseSchema.parse(
    deps.countByLocalDay(activityWindowStart(deps.now())),
  );
  return Promise.resolve({ ok: true, data: days });
}

/** Liga o canal de atividade. Só leitura; recusa remetente de outra origem (R65). */
export function registerActivityHandlers(
  registry: IpcRegistry,
  isTrusted: SenderCheck,
  deps: ActivityIpcDeps,
): void {
  registerTrustedHandler(registry, CHANNELS.activityDaily, isTrusted, (_event, payload) =>
    handleActivityDaily(deps, payload),
  );
}
