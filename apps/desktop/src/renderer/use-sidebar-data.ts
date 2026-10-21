import { useEffect, useRef, useSyncExternalStore } from 'react';
import { useLocation } from 'react-router';
import {
  getOverviewState,
  scheduleReload,
  subscribeOverview,
  type SidebarData,
} from './overview-data';

export type { SidebarData } from './overview-data';

/**
 * Dados da barra lateral, da carga compartilhada (`overview-data.ts`). Além dos eventos de missão e do
 * cadastro de projeto, que a carga já ouve, a troca de rota também pede recarga, no mesmo agrupamento
 * de 250 ms (um projeto cadastrado na página de Projetos aparece na barra quando a pessoa sai dela).
 * Sem o preload (testes), a barra mostra a mensagem e segue.
 */
export function useSidebarData(): SidebarData {
  const { key } = useLocation();
  const data = useSyncExternalStore(subscribeOverview, () => getOverviewState().sidebar);
  const lastKey = useRef(key);

  useEffect(() => {
    if (lastKey.current === key) return;
    lastKey.current = key;
    scheduleReload();
  }, [key]);

  return data;
}
