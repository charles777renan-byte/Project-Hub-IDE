import { useSyncExternalStore } from 'react';
import { getOverviewState, subscribeOverview, type Overview } from './overview-data';

export type { Overview, OverviewItem, PendingApproval } from './overview-data';

/**
 * Visão geral global: contagem das missões, as que falharam e as aprovações pendentes. Os dados vêm
 * da carga compartilhada (`overview-data.ts`), a mesma da barra lateral. Sem a API do preload
 * (testes), `loaded` fica falso e nada quebra.
 */
export function useOverview(): Overview {
  return useSyncExternalStore(subscribeOverview, () => getOverviewState().overview);
}
