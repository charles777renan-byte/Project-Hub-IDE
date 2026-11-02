import { useEffect, useSyncExternalStore } from 'react';
import type { FileContentDto } from '@project-hub/contracts';
import { RIGHT_PANEL_TEXT } from './mission-text';

/*
 * Os arquivos abertos de cada projeto: as abas que ficam ao lado dos Terminais. Um store do renderer no estilo
 * de `terminals-data.ts`: o módulo guarda o estado e os ouvintes (lidos por `useSyncExternalStore`), então a
 * árvore de arquivos (que abre) e a página do projeto (que mostra) falam pelo mesmo lugar. O texto de cada
 * arquivo mora só aqui, em memória: trocar de visão desmonta a tela, mas não o buffer. O que vai para o
 * `localStorage` é só a lista de caminhos e a aba ativa de cada projeto, nunca o texto.
 */

const TEXT = RIGHT_PANEL_TEXT.openFiles;

/** A aba fixa dos terminais. Um caminho de arquivo nunca é este valor, mas a chave é do mesmo tipo (texto). */
export const TERMINALS_TAB = 'terminals';

export type OpenFileBuffer = {
  /** Caminho relativo à raiz do projeto, em POSIX: a identidade do arquivo e da aba dele. */
  path: string;
  load: 'loading' | 'ready' | 'error' | 'not-text' | 'too-large';
  /** O motivo, quando a leitura falhou (`error`, `not-text` e `too-large`). */
  message?: string;
  /** A última versão lida ou gravada: o que há no disco, segundo o que o editor sabe. */
  saved?: FileContentDto;
  /** O texto no editor. */
  text: string;
  /** O texto difere do salvo. */
  dirty: boolean;
  /** Aviso sobre o disco (o arquivo mudou, sumiu ou foi relido). */
  notice?: 'changed-on-disk' | 'missing' | 'reloaded';
};

export type OpenFilesView = {
  files: OpenFileBuffer[];
  /** `'terminals'` ou o caminho do arquivo ativo. */
  active: 'terminals' | string;
  /** Algum arquivo deste projeto tem alterações não salvas. */
  anyDirty: boolean;
};

const STORAGE_PREFIX = 'project-hub:open-files:v1:';

const EMPTY: OpenFilesView = { files: [], active: TERMINALS_TAB, anyDirty: false };

// O estado de cada projeto é imutável: cada mudança cria um novo, e é ele que a tela lê.
const states = new Map<string, OpenFilesView>();
const listeners = new Set<() => void>();
// Arquivos restaurados do `localStorage` cuja leitura ainda não começou, por projeto.
const unread = new Map<string, string[]>();

function notifyAll() {
  for (const listener of [...listeners]) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** A lista e a aba ativa guardadas do projeto; valor ausente, estranho ou sem `localStorage` vale nada aberto. */
function readStored(projectId: string): { files: string[]; active: string } {
  try {
    const raw = window.localStorage.getItem(STORAGE_PREFIX + projectId);
    if (raw === null) return { files: [], active: TERMINALS_TAB };
    const value: unknown = JSON.parse(raw);
    if (typeof value !== 'object' || value === null) return { files: [], active: TERMINALS_TAB };
    const { files, active } = value as { files?: unknown; active?: unknown };
    if (!Array.isArray(files) || !files.every((item) => typeof item === 'string' && item !== '')) {
      return { files: [], active: TERMINALS_TAB };
    }
    const unique = [...new Set(files as string[])];
    return {
      files: unique,
      active: typeof active === 'string' && unique.includes(active) ? active : TERMINALS_TAB,
    };
  } catch {
    return { files: [], active: TERMINALS_TAB };
  }
}

function persist(projectId: string, state: OpenFilesView) {
  try {
    if (state.files.length === 0) {
      window.localStorage.removeItem(STORAGE_PREFIX + projectId);
    } else {
      window.localStorage.setItem(
        STORAGE_PREFIX + projectId,
        JSON.stringify({ files: state.files.map((file) => file.path), active: state.active }),
      );
    }
  } catch {
    // Sem armazenamento, os arquivos abertos só valem até fechar a janela.
  }
}

function build(files: OpenFileBuffer[], active: string): OpenFilesView {
  return { files, active, anyDirty: files.some((file) => file.dirty) };
}

/** O estado do projeto. Na primeira leitura restaura a lista guardada, com cada arquivo `loading` até ser lido. */
function stateOf(projectId: string): OpenFilesView {
  const known = states.get(projectId);
  if (known !== undefined) return known;
  const stored = readStored(projectId);
  const restored =
    stored.files.length === 0
      ? EMPTY
      : build(
          stored.files.map((path) => ({ path, load: 'loading', text: '', dirty: false })),
          stored.active,
        );
  states.set(projectId, restored);
  if (stored.files.length > 0) unread.set(projectId, stored.files);
  return restored;
}

/** Troca o estado do projeto e avisa quem lê. `save` guarda lista e aba ativa (mudanças de texto não mexem nelas). */
function commit(projectId: string, next: OpenFilesView, save: boolean) {
  states.set(projectId, next);
  if (save) persist(projectId, next);
  notifyAll();
}

/** Muda um arquivo aberto. Se ele já foi fechado (a leitura demorou), não faz nada. */
function patch(
  projectId: string,
  path: string,
  change: (buffer: OpenFileBuffer) => OpenFileBuffer,
): void {
  const state = stateOf(projectId);
  if (!state.files.some((file) => file.path === path)) return;
  commit(
    projectId,
    build(
      state.files.map((file) => (file.path === path ? change(file) : file)),
      state.active,
    ),
    false,
  );
}

/** Lê o arquivo e o põe no buffer: pronto, ou com o motivo da falha. */
async function load(projectId: string, path: string): Promise<void> {
  let outcome: Pick<OpenFileBuffer, 'load'> & Partial<OpenFileBuffer>;
  try {
    const result = await window.projectHub.files.read(projectId, path);
    if (result.ok) {
      outcome = { load: 'ready', saved: result.data, text: result.data.text, dirty: false };
    } else {
      const { code, message } = result.error;
      outcome = {
        load:
          code === 'FILE_NOT_TEXT' ? 'not-text' : code === 'FILE_TOO_LARGE' ? 'too-large' : 'error',
        message: message || TEXT.readError,
      };
    }
  } catch {
    outcome = { load: 'error', message: TEXT.readError };
  }
  patch(projectId, path, (file) => ({ ...file, ...outcome }));
}

/** Começa a leitura dos arquivos restaurados do `localStorage` que ainda não foram lidos. */
function readRestored(projectId: string) {
  const paths = unread.get(projectId);
  if (paths === undefined) return;
  unread.delete(projectId);
  for (const path of paths) void load(projectId, path);
}

/** Abre o arquivo numa aba nova e a ativa, lendo-o; se já está aberto, só ativa a aba dele. */
export function openFile(projectId: string, path: string): void {
  const state = stateOf(projectId);
  readRestored(projectId);
  if (state.files.some((file) => file.path === path)) {
    setActive(projectId, path);
    return;
  }
  const buffer: OpenFileBuffer = { path, load: 'loading', text: '', dirty: false };
  commit(projectId, build([...state.files, buffer], path), true);
  void load(projectId, path);
}

/** Fecha a aba do arquivo. Se era a ativa, a vizinha ocupa o lugar (a da direita, ou a da esquerda); sem vizinha, Terminais. */
export function closeFile(projectId: string, path: string): void {
  const state = stateOf(projectId);
  const at = state.files.findIndex((file) => file.path === path);
  if (at === -1) return;
  const files = state.files.filter((file) => file.path !== path);
  const active =
    state.active !== path
      ? state.active
      : (files[at]?.path ?? files[at - 1]?.path ?? TERMINALS_TAB);
  commit(projectId, build(files, active), true);
}

/** Ativa a aba dos terminais ou a de um arquivo aberto; qualquer outra chave é ignorada. */
export function setActive(projectId: string, key: 'terminals' | string): void {
  const state = stateOf(projectId);
  if (state.active === key) return;
  if (key !== TERMINALS_TAB && !state.files.some((file) => file.path === key)) return;
  commit(projectId, build(state.files, key), true);
}

/** O texto novo do editor. Marca `dirty` quando difere do salvo; um arquivo ainda sem leitura não recebe texto. */
export function updateText(projectId: string, path: string, text: string): void {
  const file = stateOf(projectId).files.find((item) => item.path === path);
  if (file?.saved === undefined || file.text === text) return;
  const { saved } = file;
  patch(projectId, path, (buffer) => ({ ...buffer, text, dirty: text !== saved.text }));
}

/** Algum projeto tem arquivo com alterações não salvas. */
export function hasDirtyFiles(): boolean {
  return [...states.values()].some((state) => state.anyDirty);
}

/**
 * Os arquivos abertos do projeto, a aba ativa e se algum tem alterações. A lista guardada do projeto é restaurada
 * na primeira leitura, e os arquivos dela são lidos de novo (o texto nunca foi guardado).
 */
export function useOpenFiles(projectId: string): OpenFilesView {
  const view = useSyncExternalStore(subscribe, () => stateOf(projectId));
  useEffect(() => {
    readRestored(projectId);
  }, [projectId]);
  return view;
}

/** Zera tudo, como numa janela recém-aberta. Só os testes usam. */
export function resetOpenFilesForTests(): void {
  states.clear();
  unread.clear();
}
