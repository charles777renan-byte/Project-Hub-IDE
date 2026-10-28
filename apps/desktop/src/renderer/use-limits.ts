import { useCallback, useEffect, useState } from 'react';
import type { LimitsDto } from '@project-hub/contracts';

export type LimitsState = {
  /** Último estado conhecido; `null` antes da primeira resposta. */
  limits: LimitsDto | null;
  /** Pede uma leitura nova. Nunca rejeita. */
  refresh: () => void;
};

/**
 * Limites da assinatura: lê o estado guardado ao montar, acompanha as atualizações do processo principal e
 * deixa pedir uma leitura nova. A assinatura cai quando o bloco sai da tela. Falha de chamada (ou ausência da
 * API do preload, nos testes) deixa o estado como está, sem rejeição solta.
 */
export function useLimits(): LimitsState {
  const [limits, setLimits] = useState<LimitsDto | null>(null);

  useEffect(() => {
    let cancelled = false;
    const api = window.projectHub?.limits;
    if (!api) return;
    let unsubscribe: (() => void) | undefined;
    try {
      unsubscribe = api.subscribe((next) => {
        if (!cancelled) setLimits(next);
      });
    } catch {
      // Sem assinatura, a leitura inicial e o botão Atualizar ainda funcionam.
    }
    void (async () => {
      try {
        const result = await api.get();
        if (!cancelled && result.ok) setLimits(result.data);
      } catch {
        // Sem leitura, o cartão mostra "Ainda sem leitura.".
      }
    })();
    return () => {
      cancelled = true;
      unsubscribe?.();
    };
  }, []);

  const refresh = useCallback(() => {
    const api = window.projectHub?.limits;
    if (!api) return;
    void (async () => {
      try {
        const result = await api.refresh();
        if (result.ok) setLimits(result.data);
      } catch {
        // O estado anterior fica; o processo principal avisa pelo subscribe.
      }
    })();
  }, []);

  return { limits, refresh };
}
