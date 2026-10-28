import type { AppResult, TerminalEvent } from '@project-hub/contracts';

/** Teto do que se guarda para um terminal aberto em outra visão (o processo de terminais já limita o replay a 1 MiB). */
const MAX_HISTORY_CHARS = 2 * 1024 * 1024;

type Listener = (event: TerminalEvent) => void;

interface Stream {
  listeners: Set<Listener>;
  /** Tudo o que chegou desde a primeira visão: serve a tela atual a uma segunda visão do mesmo terminal. */
  history: TerminalEvent[];
  historyChars: number;
  ready: Promise<AppResult<void>>;
  stopListening: () => void;
  unsubscribe: () => void;
}

const streams = new Map<string, Stream>();

/** Guarda o evento para quem abrir depois. Reinício zera a tela; o excesso antigo sai do começo. */
function record(stream: Stream, event: TerminalEvent): void {
  if (event.type === 'restart') {
    stream.history = [];
    stream.historyChars = 0;
    return;
  }
  stream.history.push(event);
  if (event.type === 'data') stream.historyChars += event.data.length;
  while (stream.historyChars > MAX_HISTORY_CHARS && stream.history.length > 1) {
    const dropped = stream.history.shift();
    if (dropped?.type === 'data') stream.historyChars -= dropped.data.length;
  }
}

/**
 * Liga uma visão ao fluxo de saída de um terminal. O processo de terminais guarda UMA assinatura por terminal
 * (assinar de novo troca a anterior e repete o replay inteiro; soltar corta todas): por isso a assinatura
 * é contada por terminal. Só a primeira visão assina, só a última solta, e a saída chega a todas as visões
 * abertas uma única vez. Quem abre depois recebe, na hora, o que já chegou (a tela atual).
 * `ready` resolve quando a assinatura está feita. `detach` é seguro de chamar mais de uma vez.
 */
export function attachTerminalStream(
  terminalId: string,
  listener: Listener,
): { ready: Promise<AppResult<void>>; detach: () => void } {
  let stream = streams.get(terminalId);
  if (stream === undefined) {
    const api = window.projectHub.terminals;
    const created: Stream = {
      listeners: new Set(),
      history: [],
      historyChars: 0,
      ready: Promise.resolve({ ok: true, data: undefined }),
      stopListening: () => {},
      unsubscribe: () => void api.unsubscribe(terminalId),
    };
    created.stopListening = api.onEvent((event) => {
      if (event.terminalId !== terminalId) return;
      record(created, event);
      for (const each of [...created.listeners]) each(event);
    });
    created.ready = api.subscribe(terminalId);
    streams.set(terminalId, created);
    stream = created;
  } else {
    for (const event of stream.history) listener(event);
  }
  const current = stream;
  current.listeners.add(listener);
  let attached = true;
  return {
    ready: current.ready,
    detach: () => {
      if (!attached) return;
      attached = false;
      current.listeners.delete(listener);
      if (current.listeners.size > 0) return;
      if (streams.get(terminalId) === current) streams.delete(terminalId);
      current.stopListening();
      current.unsubscribe();
    },
  };
}
