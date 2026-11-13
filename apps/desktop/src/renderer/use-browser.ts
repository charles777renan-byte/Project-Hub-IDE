import type { AppResult, BrowserStateDto, BrowserTabDto } from '@project-hub/contracts';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

/** O navegador de um projeto, como a aba Navegador o vê: o estado que o processo principal publica e os pedidos. */
export type BrowserView = {
  /** `null` enquanto o estado não chegou. */
  state: BrowserStateDto | null;
  activeTab: BrowserTabDto | null;
  /** Erro do último pedido (endereço recusado, limite de abas), para mostrar junto da barra. */
  notice: string | null;
  /** O estado não pôde ser lido: a mensagem do erro. */
  failure: string | null;
  openTab(): void;
  closeTab(tabId: string): void;
  selectTab(tabId: string): void;
  navigate(text: string): void;
  back(): void;
  forward(): void;
  reload(): void;
  stop(): void;
  openDevtools(): void;
  openExternal(): void;
  clearData(): void;
};

const UNEXPECTED = 'Não foi possível falar com o navegador.';

/**
 * Lê o navegador do projeto e o mantém em dia. O dono do estado é o processo principal: aqui só se guarda o último
 * estado publicado (o que um pedido devolveu ou o que chegou por evento). Um pedido recusado vira `notice`, e o
 * próximo pedido que dá certo o tira.
 */
export function useBrowser(projectId: string): BrowserView {
  const [state, setState] = useState<BrowserStateDto | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  /** Falso depois de desmontar: uma resposta que chega tarde não mexe em nada. */
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    const api = window.projectHub.browser;
    const unsubscribe = api.onChanged((next) => {
      if (next.projectId === projectId) setState(next);
    });
    api.state(projectId).then(
      (result) => {
        if (!mounted.current) return;
        if (result.ok) setState((current) => current ?? result.data);
        else setFailure(result.error.message);
      },
      () => {
        if (mounted.current) setFailure(UNEXPECTED);
      },
    );
    return () => {
      mounted.current = false;
      unsubscribe();
    };
  }, [projectId]);

  /** Faz o pedido e trata a resposta: estado novo, se veio um; aviso, se foi recusado. */
  const run = useCallback(
    (request: Promise<AppResult<BrowserStateDto | void>>) => {
      request.then(
        (result) => {
          if (!mounted.current) return;
          if (!result.ok) {
            setNotice(result.error.message);
            return;
          }
          setNotice(null);
          const data = result.data;
          if (data !== undefined && data.projectId === projectId) setState(data);
        },
        () => {
          if (mounted.current) setNotice(UNEXPECTED);
        },
      );
    },
    [projectId],
  );

  const activeTab = state?.tabs.find((tab) => tab.id === state.activeTabId) ?? null;
  const activeId = activeTab?.id;

  return useMemo<BrowserView>(() => {
    const api = window.projectHub.browser;
    /** Um pedido que age na aba ativa. Sem aba ativa, não há o que pedir. */
    const onActive = (request: (tabId: string) => Promise<AppResult<BrowserStateDto | void>>) => {
      if (activeId !== undefined) run(request(activeId));
    };
    return {
      state,
      activeTab,
      notice,
      failure,
      openTab: () => run(api.openTab(projectId)),
      closeTab: (tabId) => run(api.closeTab(projectId, tabId)),
      selectTab: (tabId) => run(api.selectTab(projectId, tabId)),
      navigate: (text) => onActive((tabId) => api.navigate(projectId, tabId, text)),
      back: () => onActive((tabId) => api.back(projectId, tabId)),
      forward: () => onActive((tabId) => api.forward(projectId, tabId)),
      reload: () => onActive((tabId) => api.reload(projectId, tabId)),
      stop: () => onActive((tabId) => api.stop(projectId, tabId)),
      openDevtools: () => onActive((tabId) => api.openDevtools(projectId, tabId)),
      openExternal: () => onActive((tabId) => api.openExternal(projectId, tabId)),
      clearData: () => run(api.clearData(projectId)),
    };
  }, [state, activeTab, activeId, notice, failure, projectId, run]);
}
