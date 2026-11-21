import { useSyncExternalStore } from 'react';

/*
 * Como os projetos aparecem na barra lateral: em lista ou em grade. A escolha fica no `localStorage`, como as
 * outras preferências de tela, e um store pequeno (lido por `useSyncExternalStore`, como em `close-confirm.ts`)
 * faz a lateral e as Configurações verem a mudança na hora.
 */

export type SidebarView = 'list' | 'grid';

const STORAGE_KEY = 'project-hub:sidebar-view';

const listeners = new Set<() => void>();

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** A visão guardada. Ausência, valor estranho ou janela sem armazenamento contam como lista. */
export function sidebarView(): SidebarView {
  try {
    return window.localStorage.getItem(STORAGE_KEY) === 'grid' ? 'grid' : 'list';
  } catch {
    return 'list';
  }
}

/** Guarda a escolha e avisa quem lê. Sem armazenamento, a escolha não pega. */
export function setSidebarView(view: SidebarView): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, view);
  } catch {
    // Sem armazenamento a preferência não se guarda; `sidebarView` segue lendo "lista".
  }
  for (const listener of [...listeners]) listener();
}

/** A visão atual, e a tela se refaz quando ela muda. */
export function useSidebarView(): SidebarView {
  return useSyncExternalStore(subscribe, sidebarView);
}
