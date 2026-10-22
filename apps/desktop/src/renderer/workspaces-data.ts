import { useSyncExternalStore } from 'react';
import type { WorkspaceDto } from '@project-hub/contracts';
import { WORKSPACES_CHANGED_EVENT } from './workspaces-events';

/*
 * Lista dos workspaces abertos, carregada uma vez por janela e compartilhada por quem a lê (a barra
 * superior e a restauração da última aba). O módulo guarda o estado e os ouvintes (usado por
 * `useSyncExternalStore`). A carga e o ouvinte de `WORKSPACES_CHANGED_EVENT` existem enquanto houver
 * algum consumidor; quando o último sai, tudo é desfeito e o estado volta ao início.
 */

export type OpenWorkspaces = {
  status: 'loading' | 'ready' | 'error';
  workspaces: WorkspaceDto[];
  message?: string;
};

const LOAD_ERROR = 'Não foi possível carregar os workspaces. Tente de novo.';

const INITIAL: OpenWorkspaces = { status: 'loading', workspaces: [] };

let state: OpenWorkspaces = INITIAL;
const listeners = new Set<() => void>();
let stop: (() => void) | undefined;
// Cada carga leva um número; `epoch` muda quando o último consumidor sai e invalida as em voo.
let started = 0;
let shown = 0;
let epoch = 0;

function publish(next: OpenWorkspaces) {
  state = next;
  for (const listener of [...listeners]) listener();
}

/** Carrega agora. Só uma carga mais nova que a exibida aplica o resultado. */
function reload() {
  const run = ++started;
  const myEpoch = epoch;
  const apply = (next: (previous: OpenWorkspaces) => OpenWorkspaces) => {
    if (myEpoch !== epoch || run < shown) return;
    shown = run;
    publish(next(state));
  };
  const failed = (previous: OpenWorkspaces): OpenWorkspaces => ({
    status: 'error',
    // A lista que já estava na tela continua: uma recarga que falha não esvazia as abas.
    workspaces: previous.workspaces,
    message: LOAD_ERROR,
  });
  // Sem o preload (testes), `window.projectHub.workspaces` não existe: a chamada lança e cai no erro.
  void (async () => {
    try {
      const result = await window.projectHub.workspaces.list();
      apply((previous) =>
        result.ok ? { status: 'ready', workspaces: result.data } : failed(previous),
      );
    } catch {
      apply(failed);
    }
  })();
}

function start(): () => void {
  window.addEventListener(WORKSPACES_CHANGED_EVENT, reload);
  reload();
  return () => {
    window.removeEventListener(WORKSPACES_CHANGED_EVENT, reload);
    epoch += 1;
    shown = 0;
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

/** Os workspaces abertos, por posição. O primeiro consumidor inicia a carga; o último a desfaz. */
export function useOpenWorkspaces(): OpenWorkspaces {
  return useSyncExternalStore(subscribe, () => state);
}
