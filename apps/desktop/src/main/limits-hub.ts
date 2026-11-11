import {
  LIMIT_PROVIDER_VALUES,
  type LimitProviderId,
  type LimitsDto,
  type ProviderLimitsDto,
} from '@project-hub/contracts';
import type { LimitsService } from './limits';

export type LimitsHubOptions = {
  /** Os serviços ativos, um por provedor. O provedor ausente não aparece no estado (a tela mostra "em breve"). */
  services: Partial<Record<LimitProviderId, LimitsService>>;
  /** Entrega o estado inteiro à janela principal (canal `limitsEvent`). */
  publish: (limits: LimitsDto) => void;
};

export type LimitsHub = {
  /** O estado de todos os provedores ativos, em ordem fixa (a de `LIMIT_PROVIDER_VALUES`). Nunca lê. */
  get(): LimitsDto;
  /** Atualiza todos os provedores ao mesmo tempo e devolve o estado inteiro. Nunca rejeita. */
  refresh(): Promise<LimitsDto>;
  /** Publica o estado inteiro agora. Cada subserviço chama isto no lugar do seu próprio `publish`. */
  emit(): void;
  start(): void;
  dispose(): void;
};

/**
 * Agregador dos limites: junta os serviços por provedor e fala com o resto do app (canais IPC, planejador)
 * como se fosse um serviço só. O renderer troca o estado inteiro a cada evento, por isso todo evento carrega
 * todos os provedores. A falha de um serviço não derruba o outro.
 */
export function createLimitsHub(options: LimitsHubOptions): LimitsHub {
  const active = LIMIT_PROVIDER_VALUES.flatMap((provider) => {
    const service = options.services[provider];
    return service === undefined ? [] : [service];
  });

  function get(): LimitsDto {
    return { providers: active.map((service): ProviderLimitsDto => service.snapshot()) };
  }

  return {
    get,
    async refresh() {
      await Promise.all(
        active.map((service) =>
          // `refresh` do serviço nunca rejeita; o `catch` protege contra um serviço que quebre essa regra.
          service.refresh().catch((error: unknown) => {
            console.warn('Falha ao atualizar os limites de um provedor:', error);
          }),
        ),
      );
      return get();
    },
    emit() {
      // A janela pode ter fechado: um erro de envio não pode derrubar a leitura de quem publicou.
      try {
        options.publish(get());
      } catch (error) {
        console.warn('Falha ao publicar os limites da assinatura:', error);
      }
    },
    start() {
      for (const service of active) service.start();
    },
    dispose() {
      for (const service of active) service.dispose();
    },
  };
}
