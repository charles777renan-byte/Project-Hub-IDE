import { useCallback, useEffect, useRef, useState } from 'react';
import type { AccountsDto } from '@project-hub/contracts';

export type AccountsState =
  { status: 'loading' } | { status: 'failed' } | { status: 'ready'; data: AccountsDto };

/**
 * As contas de cada programa, lidas do processo principal. `reload` relê depois de uma ação; a lista que já está
 * na tela continua nela durante a releitura, e uma releitura que falha não a apaga. Sem a ponte do app (testes da
 * janela inteira), fica em "lendo".
 */
export function useAccounts(): { state: AccountsState; reload: () => void } {
  const [state, setState] = useState<AccountsState>({ status: 'loading' });
  const alive = useRef(true);
  /** Só a resposta da leitura mais nova vale: uma antiga que chega depois não troca a lista. */
  const round = useRef(0);

  const reload = useCallback(() => {
    const api = window.projectHub?.accounts;
    if (api === undefined) return;
    const mine = ++round.current;
    const settle = (data: AccountsDto | null) => {
      if (!alive.current || mine !== round.current) return;
      setState((current) => {
        if (data !== null) return { status: 'ready', data };
        return current.status === 'ready' ? current : { status: 'failed' };
      });
    };
    setState((current) => (current.status === 'failed' ? { status: 'loading' } : current));
    try {
      api.list().then(
        (result) => settle(result.ok ? result.data : null),
        () => settle(null),
      );
    } catch {
      settle(null);
    }
  }, []);

  useEffect(() => {
    alive.current = true;
    reload();
    return () => {
      alive.current = false;
    };
  }, [reload]);

  return { state, reload };
}
