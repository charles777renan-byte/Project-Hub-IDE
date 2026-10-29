import { CHANNELS } from '@project-hub/contracts';
import type { LimitsService } from '../limits';
import { registerTrustedHandler, type IpcRegistry, type SenderCheck } from './trusted-handler';

/**
 * Liga os canais dos limites da assinatura. Nenhum recebe parâmetro e ambos recusam remetente de outra
 * origem (R65), sem tocar no serviço: `get` devolve o estado guardado e `refresh` pede uma leitura (que o
 * serviço limita a uma por vez e a no máximo uma por minuto).
 */
export function registerLimitsHandlers(
  registry: IpcRegistry,
  isTrusted: SenderCheck,
  service: Pick<LimitsService, 'get' | 'refresh'>,
): void {
  registerTrustedHandler(registry, CHANNELS.limitsGet, isTrusted, () =>
    Promise.resolve({ ok: true as const, data: service.get() }),
  );
  registerTrustedHandler(registry, CHANNELS.limitsRefresh, isTrusted, async () => ({
    ok: true as const,
    data: await service.refresh(),
  }));
}
