import { useCallback, useEffect, useRef, useState } from 'react';
import type { AppResult, SessionsListInput, SessionsListResult } from '@project-hub/contracts';
import { SESSIONS_TEXT } from './sessions-text';
import type { SessionScope } from './sessions-state';

export type SessionsState =
  | { status: 'loading' }
  | { status: 'ready'; data: SessionsListResult }
  | { status: 'error'; message: string };

export type UseSessions = {
  state: SessionsState;
  /** Relê a lista agora (o botão Atualizar e a volta do foco à janela usam esta). */
  refresh(): void;
};

/** O pedido para o escopo. Com projeto, o escopo `all` também o leva: a retomada confere contra ele. */
function inputFor(scope: SessionScope, projectId: string | null): SessionsListInput | null {
  if (scope === 'all') {
    return projectId === null ? { scope: 'all' } : { scope: 'all', projectId };
  }
  return projectId === null ? null : { scope, projectId };
}

/**
 * A lista de sessões do escopo. Carrega ao montar (a aba é montada quando é aberta) e de novo ao mudar o escopo, ao
 * pedir `refresh` e quando a janela volta a ter o foco. Só vale a resposta do pedido mais novo: uma resposta
 * atrasada não sobrescreve a da troca de escopo. Falha vira estado de erro, nunca lista vazia.
 */
export function useSessions(scope: SessionScope, projectId: string | null): UseSessions {
  const [state, setState] = useState<SessionsState>({ status: 'loading' });
  const latest = useRef(0);

  const load = useCallback(() => {
    const mine = ++latest.current;
    const input = inputFor(scope, projectId);
    if (input === null) {
      // Escopo de projeto sem projeto: não há o que ler, e a aba oferece só o escopo Todos.
      setState({ status: 'ready', data: { sessions: [], indexing: [] } });
      return;
    }
    void (async () => {
      try {
        const result: AppResult<SessionsListResult> = await window.projectHub.sessions.list(input);
        if (mine !== latest.current) return;
        setState(
          result.ok
            ? { status: 'ready', data: result.data }
            : { status: 'error', message: result.error.message || SESSIONS_TEXT.loadError },
        );
      } catch {
        if (mine === latest.current)
          setState({ status: 'error', message: SESSIONS_TEXT.loadError });
      }
    })();
  }, [scope, projectId]);

  useEffect(() => {
    setState({ status: 'loading' });
    load();
  }, [load]);

  useEffect(() => {
    window.addEventListener('focus', load);
    return () => window.removeEventListener('focus', load);
  }, [load]);

  return { state, refresh: load };
}
