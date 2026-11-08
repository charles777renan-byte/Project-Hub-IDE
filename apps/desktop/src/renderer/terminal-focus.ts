import { useSyncExternalStore } from 'react';

/*
 * Qual painel de terminal tem o foco agora, para a barra de status mostrar o terminal certo. Um store do
 * renderer no estilo de `open-files.ts`: o módulo guarda o foco e os ouvintes (lidos por `useSyncExternalStore`),
 * então o painel (que publica) e a barra de status (que lê) falam pelo mesmo lugar.
 */

export type TerminalFocus = {
  /** A identidade do painel que tem o foco. */
  key: string;
  /** O título que a barra de status mostra. */
  title: string;
  /**
   * O teclado está dentro do terminal (e não só em outro ponto do cartão do painel, como o botão do cabeçalho ou o
   * próprio cartão depois de Ctrl+Shift+Tab). Só então vale dizer como sair do terminal.
   */
  inTerminal: boolean;
};

// O foco é imutável: cada mudança cria um novo objeto, e é ele que a tela lê.
let focus: TerminalFocus | null = null;
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

/**
 * Publica o painel que ganhou o foco. Publicar de novo a mesma chave, o mesmo título e o mesmo lugar do foco não faz nada: os eventos de foco
 * se repetem (cada elemento do painel que o recebe publica), e sem isto cada um refaria a tela de quem lê.
 */
export function setTerminalFocus(next: TerminalFocus): void {
  if (
    focus?.key === next.key &&
    focus.title === next.title &&
    focus.inTerminal === next.inTerminal
  ) {
    return;
  }
  focus = { key: next.key, title: next.title, inTerminal: next.inTerminal };
  notifyAll();
}

/**
 * Tira o foco, mas só se o foco atual é desta chave: o painel que perde o foco depois de outro já tê-lo ganho
 * não apaga o foco do outro.
 */
export function clearTerminalFocus(key: string): void {
  if (focus?.key !== key) return;
  focus = null;
  notifyAll();
}

/** O painel de terminal com o foco, ou `null` quando nenhum tem. */
export function useTerminalFocus(): TerminalFocus | null {
  return useSyncExternalStore(subscribe, () => focus);
}

/** Zera o foco, como numa janela recém-aberta. Só os testes usam. */
export function resetTerminalFocusForTests(): void {
  focus = null;
  notifyAll();
}
