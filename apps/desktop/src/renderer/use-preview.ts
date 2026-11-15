import type { AppResult, PreviewStateDto } from '@project-hub/contracts';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

/** O preview de um projeto, como a aba Navegador o vê. Cada pedido resolve `true` quando deu certo. */
export type PreviewView = {
  /** `null` enquanto o estado não chegou. */
  state: PreviewStateDto | null;
  /** A mensagem do último pedido recusado. O próximo pedido que dá certo a tira. */
  error: string | null;
  /** Aprova um script pelo nome. `shownBody` é o texto que a tela mostrou. */
  approve(script: string, shownBody: string): Promise<boolean>;
  setAddress(text: string): Promise<boolean>;
  start(tabId: string, options?: { restart?: boolean }): Promise<boolean>;
  forget(): Promise<boolean>;
};

const UNEXPECTED = 'Não foi possível falar com o preview.';

/**
 * Lê o preview do projeto e o mantém em dia. O dono do estado é o processo principal: aqui só fica o último estado
 * que ele publicou ou devolveu. Daqui só saem ids, o nome de um script, o texto que a tela mostrou e o texto de um
 * endereço; o comando é montado no processo principal.
 */
export function usePreview(projectId: string): PreviewView {
  const [state, setState] = useState<PreviewStateDto | null>(null);
  const [error, setError] = useState<string | null>(null);
  /** O projeto da montagem atual, ou `null` depois de desmontar: resposta de outro projeto não mexe em nada. */
  const live = useRef<string | null>(null);

  useEffect(() => {
    live.current = projectId;
    const api = window.projectHub.preview;
    const unsubscribe = api.onChanged((next) => {
      if (next.projectId === projectId) setState(next);
    });
    api.state(projectId).then(
      (result) => {
        if (live.current === projectId && result.ok)
          setState((current) => keep(current, result.data));
      },
      () => undefined,
    );
    return () => {
      live.current = null;
      unsubscribe();
    };
  }, [projectId]);

  const run = useCallback(
    async (request: () => Promise<AppResult<PreviewStateDto>>): Promise<boolean> => {
      const isLive = () => live.current === projectId;
      try {
        const result = await request();
        if (!isLive()) return false;
        if (result.ok) {
          setError(null);
          if (result.data.projectId === projectId) setState(result.data);
          return true;
        }
        setError(result.error.message);
        // Um pedido recusado costuma dizer que o estado da tela ficou velho: a tela mostra o de agora.
        const fresh = await window.projectHub.preview.state(projectId);
        if (isLive() && fresh.ok) setState(fresh.data);
        return false;
      } catch {
        if (isLive()) setError(UNEXPECTED);
        return false;
      }
    },
    [projectId],
  );

  // O estado de outro projeto (a troca ainda não respondeu) não é mostrado como se fosse deste.
  const shown = state?.projectId === projectId ? state : null;

  return useMemo<PreviewView>(() => {
    const api = window.projectHub.preview;
    return {
      state: shown,
      error,
      approve: (script, shownBody) => run(() => api.approve(projectId, script, shownBody)),
      setAddress: (text) => run(() => api.setAddress(projectId, text)),
      start: (tabId, options) =>
        run(() =>
          options === undefined
            ? api.start(projectId, tabId)
            : api.start(projectId, tabId, options),
        ),
      forget: () => run(() => api.forget(projectId)),
    };
  }, [shown, error, projectId, run]);
}

/** A primeira leitura não passa por cima de um evento do mesmo projeto que chegou antes dela. */
function keep(current: PreviewStateDto | null, read: PreviewStateDto): PreviewStateDto {
  return current !== null && current.projectId === read.projectId ? current : read;
}
