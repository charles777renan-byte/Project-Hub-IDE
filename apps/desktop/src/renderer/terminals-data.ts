import { useCallback, useSyncExternalStore } from 'react';
import type { ProjectHubApi, TerminalSummary } from '@project-hub/contracts';

/*
 * Leitura compartilhada dos terminais. A barra lateral e quem mais precisar da lista leem a mesma
 * resposta: `terminals.list` uma vez a cada 2 s para a janela inteira, e não uma por consumidor. O
 * módulo guarda o estado e os ouvintes (usado por `useSyncExternalStore`). O ciclo, que começa com o
 * primeiro consumidor e termina com o último, fica parado enquanto a janela está oculta e lê na hora
 * quando ela volta. Quando o último sai, tudo é desfeito e o estado volta ao início.
 */

/** De quanto em quanto tempo a lista é lida. Terminais novos e encerrados aparecem sem recarregar. */
export const TERMINALS_POLL_MS = 2_000;

/** `loaded`: a primeira leitura já respondeu (com dados ou com erro); antes dela, a lista vazia não diz nada. */
export type TerminalsState = {
  terminals: TerminalSummary[];
  error: string | null;
  loaded: boolean;
};

const LOAD_ERROR = 'Não foi possível ler os terminais. Tente de novo.';

const INITIAL: TerminalsState = { terminals: [], error: null, loaded: false };

let state: TerminalsState = INITIAL;
const listeners = new Set<() => void>();
let stop: (() => void) | undefined;
// Cada leitura leva um número; `epoch` muda quando o último consumidor sai e invalida as em voo.
let started = 0;
let shown = 0;
let epoch = 0;
// Terminais que a pessoa acabou de fechar: somem da lista na hora, antes de o processo principal responder, e
// uma leitura que ainda os traga (começou antes do fechamento) não os faz voltar.
const hidden = new Set<string>();

function publish(next: TerminalsState) {
  // A lista chega nova a cada leitura; sem mudança, ninguém precisa redesenhar.
  if (
    next.error === state.error &&
    next.loaded === state.loaded &&
    JSON.stringify(next.terminals) === JSON.stringify(state.terminals)
  ) {
    return;
  }
  state = next;
  for (const listener of [...listeners]) listener();
}

/** A parte de terminais do preload, ou `undefined` sem ele (testes). */
function terminalsApi(): ProjectHubApi['terminals'] | undefined {
  const hub = window.projectHub as ProjectHubApi | undefined;
  return hub?.terminals as ProjectHubApi['terminals'] | undefined;
}

/**
 * Lê agora. Só uma leitura mais nova que a exibida aplica o resultado, então uma resposta lenta não
 * desfaz uma mais recente. Falha (resposta com erro ou exceção) mantém a lista anterior e marca o erro.
 * Sem o preload (testes), não há nada a ler: a lista fica vazia e sem erro.
 */
async function load(): Promise<void> {
  const run = ++started;
  const myEpoch = epoch;
  const apply = (next: (previous: TerminalsState) => TerminalsState) => {
    if (myEpoch !== epoch || run < shown) return;
    shown = run;
    publish(next(state));
  };
  /** A lista lida sem os terminais fechados agora; o que o servidor já não lista deixa de precisar de filtro. */
  const withoutHidden = (list: TerminalSummary[]): TerminalSummary[] => {
    for (const id of [...hidden]) if (!list.some((item) => item.id === id)) hidden.delete(id);
    return list.filter((item) => !hidden.has(item.id));
  };
  const failed = (message: string) => (previous: TerminalsState) => ({
    terminals: previous.terminals,
    error: message,
    loaded: true,
  });
  const api = terminalsApi();
  if (api === undefined) return;
  try {
    const result = await api.list();
    apply((previous) =>
      result.ok
        ? { terminals: withoutHidden(result.data), error: null, loaded: true }
        : failed(result.error.message || LOAD_ERROR)(previous),
    );
  } catch {
    apply(failed(LOAD_ERROR));
  }
}

function tick() {
  if (!document.hidden) void load();
}

function onVisibilityChange() {
  if (!document.hidden) void load();
}

function start(): () => void {
  const timer = setInterval(tick, TERMINALS_POLL_MS);
  document.addEventListener('visibilitychange', onVisibilityChange);
  void load();
  return () => {
    clearInterval(timer);
    document.removeEventListener('visibilitychange', onVisibilityChange);
    epoch += 1;
    shown = 0;
    hidden.clear();
    state = INITIAL;
  };
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  if (listeners.size === 1) stop = start();
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) {
      stop?.();
      stop = undefined;
    }
  };
}

/**
 * Tira o terminal da lista agora, sem esperar o processo principal encerrá-lo (a barra lateral e o resto da janela
 * leem esta mesma lista). Ele fica fora das leituras até o servidor deixar de listá-lo ou até `unhideTerminal`.
 */
export function hideTerminal(id: string): void {
  hidden.add(id);
  publish({ ...state, terminals: state.terminals.filter((item) => item.id !== id) });
}

/** O pedido de fechar terminou: o terminal volta à lista se o servidor ainda o tem (o fechamento falhou). */
export function unhideTerminal(id: string): void {
  if (!hidden.delete(id)) return;
  void load();
}

/**
 * Os terminais abertos e o erro da última leitura, se houve. O primeiro consumidor inicia o ciclo; o
 * último o desfaz. `reload` lê na hora (depois de abrir ou fechar um terminal, por exemplo).
 */
export function useTerminals(): TerminalsState & { reload(): Promise<void> } {
  const current = useSyncExternalStore(subscribe, () => state);
  const reload = useCallback(() => load(), []);
  return { terminals: current.terminals, error: current.error, loaded: current.loaded, reload };
}
