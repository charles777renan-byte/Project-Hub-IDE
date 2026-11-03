import { useCallback, useEffect, useSyncExternalStore } from 'react';
import type { GitStatusDto } from '@project-hub/contracts';
import { RIGHT_PANEL_TEXT } from './mission-text';
import { PROJECTS_CHANGED_EVENT } from './projects-events';

/*
 * Estado Git do projeto, lido uma vez por janela (ADR 0010), no modelo de `overview-data.ts`. O módulo guarda
 * uma entrada por projeto (estado, ouvintes, quantos consumidores estão com a aba aberta) e dois ouvintes da
 * janela (`PROJECTS_CHANGED_EVENT` e `focus`), criados quando a primeira entrada ativa surge e desfeitos quando
 * a última some. Quem lê o mesmo projeto (a aba Código-fonte, depois a árvore de arquivos) divide a mesma carga.
 * Sem consumidor ativo, nada é lido.
 */

/** Atraso final (trailing debounce) que junta eventos seguidos da janela numa releitura só. */
export const GIT_RELOAD_DELAY_MS = 250;

export type GitPanelStatus = 'loading' | 'ready' | 'not-git' | 'unavailable' | 'error';

export type GitPanelState = {
  status: GitPanelStatus;
  /** O estado do Git; só existe em `ready`. */
  data: GitStatusDto | null;
  /** A mensagem do processo principal (ou o texto geral) em `error`. */
  message: string | null;
  /** Há uma escrita em andamento (`track`). */
  busy: boolean;
};

export type GitPanel = GitPanelState & {
  /** Relê agora. */
  reload(): void;
  /** Marca ocupação enquanto `promise` roda e relê ao terminar (com sucesso ou não). Devolve a mesma promessa. */
  track<T>(promise: Promise<T>): Promise<T>;
};

const LOADING: GitPanelState = { status: 'loading', data: null, message: null, busy: false };

type Entry = {
  state: GitPanelState;
  listeners: Set<() => void>;
  /** Consumidores com a aba aberta; só com algum a entrada lê. */
  active: number;
  /** Número da última leitura iniciada e da última exibida: só uma leitura mais nova que a exibida vale. */
  started: number;
  shown: number;
  /** Escritas em andamento (`track`). */
  busy: number;
};

const entries = new Map<string, Entry>();
let timer: ReturnType<typeof setTimeout> | undefined;
let windowListening = false;

type Outcome = Pick<GitPanelState, 'status' | 'data' | 'message'>;

async function readStatus(projectId: string): Promise<Outcome> {
  try {
    const result = await window.projectHub.git.status({ projectId });
    if (result.ok) return { status: 'ready', data: result.data, message: null };
    // A aplicação usa VALIDATION_FAILED para "não é repositório Git"; é o único caso dele aqui.
    if (result.error.code === 'VALIDATION_FAILED') {
      return { status: 'not-git', data: null, message: null };
    }
    if (result.error.code === 'PROJECT_PATH_UNAVAILABLE') {
      return { status: 'unavailable', data: null, message: null };
    }
    return { status: 'error', data: null, message: result.error.message };
  } catch {
    return { status: 'error', data: null, message: RIGHT_PANEL_TEXT.git.loadError };
  }
}

function publish(entry: Entry, state: GitPanelState) {
  entry.state = state;
  for (const listener of [...entry.listeners]) listener();
}

function load(projectId: string) {
  const entry = entries.get(projectId);
  if (entry === undefined || entry.active === 0) return;
  const run = ++entry.started;
  void readStatus(projectId).then((outcome) => {
    // A entrada pode ter saído e voltado: só vale a que ainda é esta.
    if (entries.get(projectId) !== entry || run < entry.shown) return;
    entry.shown = run;
    publish(entry, { ...outcome, busy: entry.state.busy });
  });
}

function reloadAll() {
  for (const projectId of [...entries.keys()]) load(projectId);
}

/** Pede a releitura de todos os projetos ativos: eventos seguidos viram uma só. */
function scheduleReloadAll() {
  if (timer !== undefined) clearTimeout(timer);
  timer = setTimeout(() => {
    timer = undefined;
    reloadAll();
  }, GIT_RELOAD_DELAY_MS);
}

function syncWindowListeners() {
  const wanted = [...entries.values()].some((entry) => entry.active > 0);
  if (wanted === windowListening) return;
  windowListening = wanted;
  if (wanted) {
    window.addEventListener(PROJECTS_CHANGED_EVENT, scheduleReloadAll);
    window.addEventListener('focus', scheduleReloadAll);
  } else {
    window.removeEventListener(PROJECTS_CHANGED_EVENT, scheduleReloadAll);
    window.removeEventListener('focus', scheduleReloadAll);
    if (timer !== undefined) clearTimeout(timer);
    timer = undefined;
  }
}

function entryFor(projectId: string): Entry {
  let entry = entries.get(projectId);
  if (entry === undefined) {
    entry = { state: LOADING, listeners: new Set(), active: 0, started: 0, shown: 0, busy: 0 };
    entries.set(projectId, entry);
  }
  return entry;
}

function dropIfIdle(projectId: string, entry: Entry) {
  if (entry.listeners.size === 0 && entry.active === 0 && entries.get(projectId) === entry) {
    entries.delete(projectId);
  }
  syncWindowListeners();
}

/** Para `useSyncExternalStore`: ouve o estado de um projeto. */
function subscribeState(projectId: string, listener: () => void): () => void {
  const entry = entryFor(projectId);
  entry.listeners.add(listener);
  return () => {
    entry.listeners.delete(listener);
    dropIfIdle(projectId, entry);
  };
}

/** Conta um consumidor com a aba aberta; o primeiro lê, e os ouvintes da janela existem enquanto houver algum. */
function activate(projectId: string): () => void {
  const entry = entryFor(projectId);
  entry.active += 1;
  syncWindowListeners();
  if (entry.active === 1) load(projectId);
  return () => {
    entry.active -= 1;
    dropIfIdle(projectId, entry);
  };
}

function track<T>(projectId: string, promise: Promise<T>): Promise<T> {
  const entry = entries.get(projectId);
  if (entry === undefined) return promise;
  entry.busy += 1;
  publish(entry, { ...entry.state, busy: true });
  const done = () => {
    entry.busy -= 1;
    if (entries.get(projectId) !== entry) return;
    if (entry.busy === 0) publish(entry, { ...entry.state, busy: false });
    load(projectId);
  };
  promise.then(done, done);
  return promise;
}

/**
 * O estado Git do projeto. Com `active` falso (a aba fechada) ou sem projeto, não lê nada. Relê ao ficar ativo, em
 * `PROJECTS_CHANGED_EVENT`, no foco da janela e em `reload()`.
 */
export function useGitPanel(projectId: string | null, active: boolean): GitPanel {
  const subscribe = useCallback(
    (listener: () => void) =>
      projectId === null ? () => undefined : subscribeState(projectId, listener),
    [projectId],
  );
  const state = useSyncExternalStore(subscribe, () =>
    projectId === null ? LOADING : (entries.get(projectId)?.state ?? LOADING),
  );
  useEffect(() => {
    if (projectId === null || !active) return undefined;
    return activate(projectId);
  }, [projectId, active]);
  return {
    ...state,
    reload: () => {
      if (projectId !== null) load(projectId);
    },
    track: <T>(promise: Promise<T>) => (projectId === null ? promise : track(projectId, promise)),
  };
}
