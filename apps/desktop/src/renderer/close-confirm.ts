import { useSyncExternalStore } from 'react';

/*
 * A preferência "perguntar antes de fechar um terminal com agente rodando". Vale para o app inteiro (todos os
 * projetos) e sobrevive a fechar a janela: fica no `localStorage`, como as outras preferências de tela, e um store
 * pequeno no estilo de `terminal-focus.ts` (lido por `useSyncExternalStore`) faz todos os painéis e as
 * Configurações verem a mudança na hora.
 */

const STORAGE_KEY = 'project-hub:perguntar-ao-fechar-terminal';

const listeners = new Set<() => void>();

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/**
 * Pergunta antes de fechar? Só o valor `'false'` guardado desliga a pergunta: ausência, valor estranho ou erro de
 * acesso ao armazenamento (janela sem `localStorage`) contam como perguntar, o lado seguro.
 */
export function askBeforeClosing(): boolean {
  try {
    return window.localStorage.getItem(STORAGE_KEY) !== 'false';
  } catch {
    return true;
  }
}

/** Guarda a escolha e avisa quem lê. Sem armazenamento, a escolha não pega: a pergunta continua. */
export function setAskBeforeClosing(ask: boolean): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, ask ? 'true' : 'false');
  } catch {
    // Sem armazenamento a preferência não se guarda; `askBeforeClosing` segue lendo "perguntar".
  }
  for (const listener of [...listeners]) listener();
}

/** A preferência atual, e a tela se refaz quando ela muda. */
export function useAskBeforeClosing(): boolean {
  return useSyncExternalStore(subscribe, askBeforeClosing);
}
