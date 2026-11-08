import { useSyncExternalStore } from 'react';

/*
 * "Fechar todos os terminais" entre o cabeçalho do projeto e o workspace, que ficam em lugares diferentes da
 * árvore (e o workspace continua montado, escondido, nas outras visões). Um store do renderer no estilo de
 * `terminal-focus.ts`, com dois recados por projeto:
 *
 * - quantos painéis o workspace tem (o workspace publica, o cabeçalho lê, para saber se habilita o item);
 * - o pedido de fechar todos (o cabeçalho faz, o workspace atende e limpa).
 *
 * O pedido fica guardado no store, e não num evento: quem o faz de outra visão navega para Terminais no mesmo
 * gesto, e o pedido tem de esperar a visão aparecer. O workspace o consome uma vez (`clearCloseAllRequest`).
 */

// Cada mudança cria um novo mapa/conjunto: o que a tela lê nunca é alterado no lugar.
let counts: ReadonlyMap<string, number> = new Map();
let requests: ReadonlySet<string> = new Set();
const listeners = new Set<() => void>();

function notifyAll() {
  for (const listener of [...listeners]) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Publica quantos painéis o workspace do projeto tem agora. Zero tira o registro. */
export function setPaneCount(projectId: string, count: number): void {
  if ((counts.get(projectId) ?? 0) === count) return;
  const next = new Map(counts);
  if (count > 0) next.set(projectId, count);
  else next.delete(projectId);
  counts = next;
  notifyAll();
}

/** Quantos painéis o workspace do projeto tem; 0 sem registro (o workspace ainda não abriu, ou foi desmontado). */
export function usePaneCount(projectId: string): number {
  return useSyncExternalStore(subscribe, () => counts.get(projectId) ?? 0);
}

/** Pede ao workspace do projeto para perguntar se fecha todos os terminais. Pedir de novo não muda nada. */
export function requestCloseAll(projectId: string): void {
  if (requests.has(projectId)) return;
  requests = new Set(requests).add(projectId);
  notifyAll();
}

/** O projeto tem um pedido de fechar todos à espera de resposta. */
export function useCloseAllRequest(projectId: string): boolean {
  return useSyncExternalStore(subscribe, () => requests.has(projectId));
}

/** Dá o pedido do projeto por atendido (confirmado, recusado ou descartado). */
export function clearCloseAllRequest(projectId: string): void {
  if (!requests.has(projectId)) return;
  const next = new Set(requests);
  next.delete(projectId);
  requests = next;
  notifyAll();
}

/**
 * A pergunta da faixa do workspace. `sessions` são as sessões avulsas vivas, que o fechamento encerra; `missions` são
 * os painéis de terminal de missão, que só saem do painel. Sem sessão a encerrar não há a frase de sessões, e sem
 * missão não há a de missões.
 */
export function closeAllQuestion(counts: {
  panes: number;
  sessions: number;
  missions: number;
}): string {
  const head = counts.panes === 1 ? 'Fechar o painel?' : `Fechar os ${counts.panes} painéis?`;
  const sessions =
    counts.sessions === 0
      ? null
      : counts.sessions === 1
        ? '1 sessão será encerrada'
        : `${counts.sessions} sessões serão encerradas`;
  const missions = counts.missions === 0 ? null : 'as missões continuam';
  if (sessions !== null && missions !== null) return `${head} ${sessions}; ${missions}.`;
  if (sessions !== null) return `${head} ${sessions}.`;
  if (missions !== null) return `${head} As missões continuam.`;
  return head;
}

/** Zera tudo, como numa janela recém-aberta. Só os testes usam. */
export function resetCloseAllForTests(): void {
  counts = new Map();
  requests = new Set();
  notifyAll();
}
