import { CHANNELS, type EnvironmentDto, type SystemUsageDto } from '@project-hub/contracts';
import { registerTrustedHandler, type IpcRegistry, type SenderCheck } from './trusted-handler';

/**
 * Liga os canais do uso do computador e da conferência do ambiente. Só leitura, sem parâmetro; recusam remetente de
 * outra origem (R65).
 */
export function registerSystemHandlers(
  registry: IpcRegistry,
  isTrusted: SenderCheck,
  sample: () => SystemUsageDto,
  environment: () => Promise<EnvironmentDto>,
): void {
  registerTrustedHandler(registry, CHANNELS.systemUsage, isTrusted, () =>
    Promise.resolve({ ok: true as const, data: sample() }),
  );
  registerTrustedHandler(registry, CHANNELS.systemEnvironment, isTrusted, async () => ({
    ok: true as const,
    data: await environment(),
  }));
}
