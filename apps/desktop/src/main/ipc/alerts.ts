import { failure } from '@project-hub/application';
import { CHANNELS, alertNotifyInputSchema } from '@project-hub/contracts';
import type { AlertService } from '../alerts';
import { registerTrustedHandler, type IpcRegistry, type SenderCheck } from './trusted-handler';

/** Canal dos avisos do sistema. A entrada é conferida aqui (R28): só o tipo e o id do item, nunca texto. */
export function registerAlertHandlers(
  registry: IpcRegistry,
  isTrusted: SenderCheck,
  service: AlertService,
): void {
  registerTrustedHandler(registry, CHANNELS.alertsNotify, isTrusted, async (_event, payload) => {
    const input = alertNotifyInputSchema.safeParse(payload);
    if (!input.success) return failure('VALIDATION_FAILED', 'Aviso fora do formato.');
    await service.notify(input.data);
    return { ok: true, data: undefined };
  });
}
