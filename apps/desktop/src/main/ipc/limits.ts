import { failure } from '@project-hub/application';
import { CHANNELS, accountTargetInputSchema } from '@project-hub/contracts';
import type { AccountLimits } from '../account-limits';
import { registerTrustedHandler, type IpcRegistry, type SenderCheck } from './trusted-handler';

/**
 * Liga os canais dos limites da assinatura. Todos recusam remetente de outra origem (R65), sem tocar no serviço:
 * `get` devolve o estado guardado, `refresh` pede a leitura da conta padrão e das contas em uso, e `refreshAccount`
 * pede a de uma conta, só pelo programa e pelo id dela (o serviço limita a uma leitura por vez e a no máximo uma por
 * minuto).
 */
export function registerLimitsHandlers(
  registry: IpcRegistry,
  isTrusted: SenderCheck,
  service: Pick<AccountLimits, 'get' | 'refresh' | 'refreshAccount'>,
): void {
  registerTrustedHandler(registry, CHANNELS.limitsGet, isTrusted, () =>
    Promise.resolve({ ok: true as const, data: service.get() }),
  );
  registerTrustedHandler(registry, CHANNELS.limitsRefresh, isTrusted, async () => ({
    ok: true as const,
    data: await service.refresh(),
  }));
  registerTrustedHandler(registry, CHANNELS.limitsRefreshAccount, isTrusted, (_event, payload) => {
    const input = accountTargetInputSchema.safeParse(payload);
    return input.success
      ? service.refreshAccount(input.data.provider, input.data.accountId)
      : Promise.resolve(failure('VALIDATION_FAILED', 'Informe o programa e a conta.'));
  });
}
