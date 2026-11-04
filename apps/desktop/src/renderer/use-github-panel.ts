import { useCallback, useEffect, useSyncExternalStore } from 'react';
import type {
  AppError,
  AppResult,
  CheckDto,
  GithubMergeMethod,
  GithubPanelDto,
  PrReadingDto,
  PrResultDto,
} from '@project-hub/contracts';
import { RIGHT_PANEL_TEXT } from './mission-text';

/*
 * O PR da branch atual, lido uma vez por janela (ADR 0010), no modelo de `use-git-panel.ts`. É dado do
 * `RightPanel`, não da aba Checks: o ponto de estado da barra de abas precisa dele com a aba fechada. O módulo
 * guarda uma entrada por projeto (estado, ouvintes, última leitura boa) e um ouvinte de foco da janela, criado
 * quando a primeira entrada surge e desfeito quando a última some. Sem projeto, nada é lido.
 *
 * O texto vindo do GitHub (título, nomes, comentários) é dado não confiável: este módulo só o repassa, e a tela o
 * mostra como texto puro.
 */

/** Atraso final que junta eventos seguidos da janela (foco) numa releitura só. */
export const GITHUB_RELOAD_DELAY_MS = 250;
/** Intervalo da releitura automática, só com a aba Checks visível e algum check pendente. */
export const GITHUB_POLL_MS = 30_000;

/** O erro que impediu uma releitura, como o contrato o descreve. */
type StaleError = Extract<PrResultDto, { state: 'stale' }>['error'];

/** O que a leitura mais recente diz, sem os indicadores de andamento. */
export type GithubPanelView =
  | { status: 'loading' }
  /** Há PR. `stale`: a leitura de agora falhou e `reading` é a última boa, com o erro que impediu a nova. */
  | { status: 'ready'; reading: PrReadingDto; stale: boolean; error: StaleError | null }
  | { status: 'no-pr' }
  /** A pasta não tem `origin`, ou o `origin` não é do github.com. */
  | { status: 'not-applicable' }
  | { status: 'no-gh'; message: string }
  | { status: 'no-login'; message: string }
  /** Falha de rede sem nenhuma leitura boa antes. */
  | { status: 'network'; message: string }
  | { status: 'error'; message: string };

export type GithubPanelState = GithubPanelView & {
  /** Há uma leitura em andamento. */
  refreshing: boolean;
  /** Há um comentário ou uma mesclagem em andamento. */
  writing: boolean;
};

export type GithubPanel = {
  state: GithubPanelState;
  /** Relê agora. */
  refresh(): void;
  /** Publica um comentário no PR atual e relê ao terminar (com sucesso ou não). */
  comment(body: string): Promise<AppResult<void>>;
  /** Mescla o PR atual e relê ao terminar (com sucesso ou não). */
  merge(method: GithubMergeMethod): Promise<AppResult<void>>;
};

const LOADING: GithubPanelState = { status: 'loading', refreshing: false, writing: false };

/** Um check ainda sem resultado: o `CheckRun` não terminou, ou o status antigo está pendente ou esperado. */
export function isPendingCheck(check: CheckDto): boolean {
  return check.kind === 'check-run'
    ? check.status !== 'COMPLETED'
    : check.state === 'PENDING' || check.state === 'EXPECTED';
}

export function hasPendingChecks(checks: readonly CheckDto[]): boolean {
  return checks.some(isPendingCheck);
}

type Entry = {
  state: GithubPanelState;
  listeners: Set<() => void>;
  /** Número da última leitura iniciada e da última exibida: só uma leitura mais nova que a exibida vale. */
  started: number;
  shown: number;
  /** Leituras e escritas em andamento. */
  reading: number;
  writing: number;
};

const entries = new Map<string, Entry>();
let timer: ReturnType<typeof setTimeout> | undefined;
let windowListening = false;

function appError(code: AppError['code'], message: string): AppError {
  return { code, message, retryable: true };
}

/** Converte a resposta do processo principal no que a tela mostra, guardando a última leitura boa. */
function viewFrom(result: AppResult<GithubPanelDto>, previous: GithubPanelView): GithubPanelView {
  if (result.ok) {
    const panel = result.data;
    if (panel.kind === 'no-pr') return { status: 'no-pr' };
    if (panel.kind === 'not-applicable') return { status: 'not-applicable' };
    return panel.result.state === 'ok'
      ? { status: 'ready', reading: panel.result.reading, stale: false, error: null }
      : {
          status: 'ready',
          reading: panel.result.reading,
          stale: true,
          error: panel.result.error,
        };
  }
  const { error } = result;
  if (error.code === 'GH_NOT_AVAILABLE') return { status: 'no-gh', message: error.message };
  if (error.code === 'GH_NOT_AUTHENTICATED') return { status: 'no-login', message: error.message };
  // Qualquer outra falha mantém a lista que já estava na tela, marcada como desatualizada.
  if (previous.status === 'ready') {
    return { status: 'ready', reading: previous.reading, stale: true, error };
  }
  if (error.code === 'GH_NETWORK_FAILED') return { status: 'network', message: error.message };
  return { status: 'error', message: error.message };
}

async function readPanel(projectId: string): Promise<AppResult<GithubPanelDto>> {
  try {
    return await window.projectHub.github.pr({ projectId });
  } catch {
    return { ok: false, error: appError('UNKNOWN', RIGHT_PANEL_TEXT.github.loadError) };
  }
}

function publish(entry: Entry, state: GithubPanelState) {
  entry.state = state;
  for (const listener of [...entry.listeners]) listener();
}

function flags(entry: Entry) {
  return { refreshing: entry.reading > 0, writing: entry.writing > 0 };
}

function load(projectId: string) {
  const entry = entries.get(projectId);
  if (entry === undefined) return;
  const run = ++entry.started;
  entry.reading += 1;
  publish(entry, { ...entry.state, ...flags(entry) });
  void readPanel(projectId).then((result) => {
    // A entrada pode ter saído e voltado: só vale a que ainda é esta.
    if (entries.get(projectId) !== entry) return;
    entry.reading -= 1;
    if (run < entry.shown) {
      publish(entry, { ...entry.state, ...flags(entry) });
      return;
    }
    entry.shown = run;
    publish(entry, { ...viewFrom(result, entry.state), ...flags(entry) });
  });
}

function reloadAll() {
  for (const projectId of [...entries.keys()]) load(projectId);
}

/** Pede a releitura de todos os projetos: eventos seguidos viram uma só. */
function scheduleReloadAll() {
  if (timer !== undefined) clearTimeout(timer);
  timer = setTimeout(() => {
    timer = undefined;
    reloadAll();
  }, GITHUB_RELOAD_DELAY_MS);
}

function syncWindowListeners() {
  const wanted = entries.size > 0;
  if (wanted === windowListening) return;
  windowListening = wanted;
  if (wanted) {
    window.addEventListener('focus', scheduleReloadAll);
  } else {
    window.removeEventListener('focus', scheduleReloadAll);
    if (timer !== undefined) clearTimeout(timer);
    timer = undefined;
  }
}

function entryFor(projectId: string): Entry {
  let entry = entries.get(projectId);
  if (entry === undefined) {
    entry = { state: LOADING, listeners: new Set(), started: 0, shown: 0, reading: 0, writing: 0 };
    entries.set(projectId, entry);
    syncWindowListeners();
    load(projectId);
  }
  return entry;
}

/** Para `useSyncExternalStore`: ouve o estado de um projeto; o primeiro ouvinte cria a entrada e lê. */
function subscribeState(projectId: string, listener: () => void): () => void {
  const entry = entryFor(projectId);
  entry.listeners.add(listener);
  return () => {
    entry.listeners.delete(listener);
    if (entry.listeners.size === 0 && entries.get(projectId) === entry) {
      entries.delete(projectId);
      syncWindowListeners();
    }
  };
}

/** Relê a cada `GITHUB_POLL_MS`, sem empilhar uma leitura sobre a outra. */
function startPolling(projectId: string): () => void {
  const id = setInterval(() => {
    if ((entries.get(projectId)?.reading ?? 1) === 0) load(projectId);
  }, GITHUB_POLL_MS);
  return () => clearInterval(id);
}

/**
 * Escreve no PR da leitura atual; sem projeto ou sem PR na tela, devolve `GH_PR_NOT_FOUND` sem chamar nada.
 * Com outra escrita em andamento (comentário ou merge), recusa sem chamar nada: duas escritas seguidas não
 * chegam juntas ao processo principal, mesmo que a tela deixe de desabilitar o botão por um instante.
 */
function write(
  projectId: string | null,
  start: (projectId: string, prNumber: number) => Promise<AppResult<void>>,
): Promise<AppResult<void>> {
  const entry = projectId === null ? undefined : entries.get(projectId);
  const view = entry?.state;
  if (projectId === null || entry === undefined || view?.status !== 'ready') {
    return Promise.resolve({
      ok: false,
      error: { code: 'GH_PR_NOT_FOUND', message: RIGHT_PANEL_TEXT.github.noPr, retryable: false },
    });
  }
  if (entry.writing > 0) {
    return Promise.resolve({
      ok: false,
      error: appError('UNKNOWN', RIGHT_PANEL_TEXT.github.writeError),
    });
  }
  entry.writing += 1;
  publish(entry, { ...entry.state, ...flags(entry) });
  const done = () => {
    entry.writing -= 1;
    if (entries.get(projectId) !== entry) return;
    publish(entry, { ...entry.state, ...flags(entry) });
    load(projectId);
  };
  // O executor do `Promise` roda na hora, e uma exceção síncrona do preload vira rejeição: sem isso, `writing`
  // ficaria ligado para sempre.
  const run = new Promise<AppResult<void>>((resolve) =>
    resolve(start(projectId, view.reading.pr.number)),
  ).catch((): AppResult<void> => ({
    ok: false,
    error: appError('UNKNOWN', RIGHT_PANEL_TEXT.github.writeError),
  }));
  void run.then(done);
  return run;
}

/**
 * O PR da branch atual do projeto. Sem projeto, não lê nada. Lê ao abrir, no foco da janela e em `refresh()`;
 * com `checksVisible` (a aba Checks aberta) e algum check pendente, relê também a cada 30 s. Falha de rede
 * mantém a última leitura boa, marcada como desatualizada. Trocar de projeto zera o estado.
 */
export function useGithubPanel(projectId: string | null, checksVisible: boolean): GithubPanel {
  const subscribe = useCallback(
    (listener: () => void) =>
      projectId === null ? () => undefined : subscribeState(projectId, listener),
    [projectId],
  );
  const state = useSyncExternalStore(subscribe, () =>
    projectId === null ? LOADING : (entries.get(projectId)?.state ?? LOADING),
  );
  const polling =
    checksVisible && state.status === 'ready' && hasPendingChecks(state.reading.checks);
  useEffect(() => {
    if (projectId === null || !polling) return undefined;
    return startPolling(projectId);
  }, [projectId, polling]);
  return {
    state,
    refresh: () => {
      if (projectId !== null) load(projectId);
    },
    comment: (body) =>
      write(projectId, (id, prNumber) =>
        window.projectHub.github.comment({ projectId: id, prNumber, body }),
      ),
    merge: (method) =>
      write(projectId, (id, prNumber) =>
        window.projectHub.github.merge({ projectId: id, prNumber, method }),
      ),
  };
}
