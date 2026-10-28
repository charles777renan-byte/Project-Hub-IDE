import { CHANNELS, type SystemUsageDto } from '@project-hub/contracts';
import { registerTrustedHandler, type IpcRegistry, type SenderCheck } from './trusted-handler';

/** Liga o canal do uso do computador. Só leitura, sem parâmetro; recusa remetente de outra origem (R65). */
export function registerSystemHandlers(
  registry: IpcRegistry,
  isTrusted: SenderCheck,
  sample: () => SystemUsageDto,
): void {
  registerTrustedHandler(registry, CHANNELS.systemUsage, isTrusted, () =>
    Promise.resolve({ ok: true as const, data: sample() }),
  );
}
