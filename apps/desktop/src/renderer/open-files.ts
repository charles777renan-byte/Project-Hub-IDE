import { useEffect, useSyncExternalStore } from 'react';
import type { FileContentDto, FileVersionDto } from '@project-hub/contracts';
import { RIGHT_PANEL_TEXT } from './mission-text';

/*
 * Os arquivos abertos de cada projeto: as abas que ficam ao lado dos Terminais. Um store do renderer no estilo
 * de `terminals-data.ts`: o módulo guarda o estado e os ouvintes (lidos por `useSyncExternalStore`), então a
 * árvore de arquivos (que abre) e a página do projeto (que mostra) falam pelo mesmo lugar. O texto de cada
 * arquivo mora só aqui, em memória: trocar de visão desmonta a tela, mas não o buffer. O que vai para o
 * `localStorage` é só a lista de caminhos e a aba ativa de cada projeto, nunca o texto.
 */

const TEXT = RIGHT_PANEL_TEXT.openFiles;
const EDITOR_TEXT = RIGHT_PANEL_TEXT.editor;

/** Quanto tempo o aviso "Atualizado: o arquivo mudou no disco" fica na tela. */
const RELOADED_NOTICE_MS = 5_000;

/** A aba fixa dos terminais. Um caminho de arquivo nunca é este valor, mas a chave é do mesmo tipo (texto). */
export const TERMINALS_TAB = 'terminals';

/** O que a aba de um arquivo mostra: o editor (`arquivo`) ou o diff contra a base, só leitura (`alteracoes`). */
export type FileMode = 'arquivo' | 'alteracoes';

export type OpenFileBuffer = {
  /** Caminho relativo à raiz do projeto, em POSIX: a identidade do arquivo e da aba dele. */
  path: string;
  /** O modo da aba. Vive só na memória, como o texto: ausente vale `arquivo`. */
  mode?: FileMode;
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
  notice?: 'changed-on-disk' | 'missing' | 'reloaded' | undefined;
  /** Com `changed-on-disk`: o que o disco tem agora (texto e versão), lido quando o conflito apareceu. */
  disk?: FileContentDto | undefined;
  /** Por que o "Salvar" ao fechar a janela não gravou este arquivo; some quando ele é gravado ou o salvamento recomeça. */
  saveProblem?: string | undefined;
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

/**
 * Fechar a janela com arquivo sujo: o `beforeunload` só fica registrado enquanto algum arquivo tem alterações não
 * salvas. O Chromium então avisa o processo principal (`will-prevent-unload`), que pergunta à pessoa. Sem arquivo
 * sujo a janela fecha sem pergunta nenhuma.
 */
function blockUnload(event: BeforeUnloadEvent) {
  event.preventDefault();
  event.returnValue = '';
}

let unloadGuarded = false;

function syncUnloadGuard() {
  const needed = hasDirtyFiles();
  if (needed === unloadGuarded) return;
  unloadGuarded = needed;
  if (needed) window.addEventListener('beforeunload', blockUnload);
  else window.removeEventListener('beforeunload', blockUnload);
}

function notifyAll() {
  syncUnloadGuard();
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

/** O que um arquivo que não pôde ser lido mostra: o tipo da falha e o motivo. */
function failedRead(error: {
  code: string;
  message: string;
}): Pick<OpenFileBuffer, 'load' | 'message'> {
  return {
    load:
      error.code === 'FILE_NOT_TEXT'
        ? 'not-text'
        : error.code === 'FILE_TOO_LARGE'
          ? 'too-large'
          : 'error',
    message: error.message || TEXT.readError,
  };
}

/** Lê o arquivo e o põe no buffer: pronto, ou com o motivo da falha. */
async function load(projectId: string, path: string): Promise<void> {
  let outcome: Pick<OpenFileBuffer, 'load'> & Partial<OpenFileBuffer>;
  try {
    const result = await window.projectHub.files.read(projectId, path);
    if (result.ok) {
      outcome = { load: 'ready', saved: result.data, text: result.data.text, dirty: false };
    } else {
      outcome = failedRead(result.error);
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

/**
 * Abre o arquivo numa aba nova e a ativa, lendo-o; se já está aberto, só ativa a aba dele. Com `mode`, a aba abre
 * (ou passa a estar) nesse modo; sem ele, uma aba nova abre em `arquivo` e uma aberta mantém o modo que tem.
 */
export function openFile(projectId: string, path: string, options: { mode?: FileMode } = {}): void {
  const state = stateOf(projectId);
  readRestored(projectId);
  const { mode } = options;
  if (state.files.some((file) => file.path === path)) {
    if (mode !== undefined) setFileMode(projectId, path, mode);
    setActive(projectId, path);
    return;
  }
  const buffer: OpenFileBuffer = {
    path,
    load: 'loading',
    text: '',
    dirty: false,
    ...(mode === undefined ? {} : { mode }),
  };
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
  clearReloadedTimer(projectId, path);
  commit(projectId, build(files, active), true);
  if (active !== state.active && active !== TERMINALS_TAB) void checkFileOnDisk(projectId, active);
}

/** Ativa a aba dos terminais ou a de um arquivo aberto; qualquer outra chave é ignorada. */
export function setActive(projectId: string, key: 'terminals' | string): void {
  const state = stateOf(projectId);
  if (state.active === key) return;
  if (key !== TERMINALS_TAB && !state.files.some((file) => file.path === key)) return;
  commit(projectId, build(state.files, key), true);
  // Ativar a aba é um bom momento para ver se um agente mexeu no arquivo enquanto ela estava de lado.
  if (key !== TERMINALS_TAB) void checkFileOnDisk(projectId, key);
}

/** Troca o modo da aba do arquivo. O texto do editor não muda: ele mora no buffer, não na tela. */
export function setFileMode(projectId: string, path: string, mode: FileMode): void {
  const file = fileOf(projectId, path);
  if (file === undefined || (file.mode ?? 'arquivo') === mode) return;
  patch(projectId, path, (buffer) => ({ ...buffer, mode }));
}

/** O texto novo do editor. Marca `dirty` quando difere do salvo; um arquivo ainda sem leitura não recebe texto. */
export function updateText(projectId: string, path: string, text: string): void {
  const file = stateOf(projectId).files.find((item) => item.path === path);
  if (file?.saved === undefined || file.text === text) return;
  const { saved } = file;
  patch(projectId, path, (buffer) => ({ ...buffer, text, dirty: text !== saved.text }));
}

/**
 * O que acabou de ser gravado vira o salvo (o texto enviado, os fins de linha e o BOM com que foi gravado, e a
 * versão nova que o disco devolveu). O texto do editor não muda: se a pessoa digitou durante a gravação, o
 * arquivo segue com alterações não salvas, porque `dirty` é refeito contra o texto de agora.
 */
export function markSaved(projectId: string, path: string, saved: FileContentDto): void {
  // O disco acabou de receber este texto: qualquer aviso sobre o disco (conflito, arquivo sumido) está resolvido.
  patch(projectId, path, (buffer) => ({
    ...settled(buffer),
    saved,
    dirty: buffer.text !== saved.text,
  }));
}

export type SaveOutcome = { ok: true } | { ok: false; message: string };

/**
 * Grava o texto do editor. Vive aqui, e não na aba, porque quem grava nem sempre é o editor: a pergunta ao fechar
 * uma aba suja e a faixa de conflito também gravam, e a aba pode nem estar montada. `expected` é a versão lida (ou,
 * com `disk`, a que o disco tem agora: o "Salvar por cima"; com `recreate`, `null`: criar o arquivo que sumiu).
 * Gravação recusada porque o disco mudou manda conferir o disco, o que abre a faixa de conflito.
 */
export async function saveFile(
  projectId: string,
  path: string,
  options: { disk?: FileContentDto; recreate?: boolean } = {},
): Promise<SaveOutcome> {
  const file = fileOf(projectId, path);
  const saved = file?.saved;
  if (file === undefined || saved === undefined) {
    return { ok: false, message: EDITOR_TEXT.saveError };
  }
  // Uma nova tentativa de gravar deixa para trás o motivo da tentativa anterior do "Salvar" ao fechar a janela.
  if (file.saveProblem !== undefined) {
    patch(projectId, path, ({ saveProblem: _saveProblem, ...rest }) => rest);
  }
  if (!file.dirty && options.recreate !== true) return { ok: true };
  // Um aviso do disco só se resolve na faixa de conflito da aba: daqui, nunca se grava por cima.
  if (file.notice === 'changed-on-disk' && options.disk === undefined) {
    return { ok: false, message: EDITOR_TEXT.conflict.saveBlockedChanged };
  }
  if (file.notice === 'missing' && options.recreate !== true) {
    return { ok: false, message: EDITOR_TEXT.conflict.saveBlockedMissing };
  }
  // Gravar um arquivo de fins de linha misturados normalizaria os fins de linha.
  if (saved.eol === 'mixed') return { ok: false, message: EDITOR_TEXT.mixedEol };
  const { text } = file;
  const base = options.disk ?? saved;
  const eol = base.eol === 'mixed' ? saved.eol : base.eol;
  const { bom } = base;
  try {
    const result = await window.projectHub.files.write({
      projectId,
      path,
      text,
      eol,
      bom,
      expected: options.recreate === true ? null : base.version,
    });
    if (result.ok) {
      // O salvo é o texto que foi enviado; se a pessoa digitou depois, o arquivo segue com alterações.
      markSaved(projectId, path, { text, eol, bom, version: result.data });
      return { ok: true };
    }
    if (result.error.code === 'FILE_CHANGED_ON_DISK') void checkFileOnDisk(projectId, path);
    return { ok: false, message: result.error.message || EDITOR_TEXT.saveError };
  } catch {
    return { ok: false, message: EDITOR_TEXT.saveError };
  }
}

let saveAllRun: Promise<boolean> | undefined;

/**
 * "Salvar" ao fechar a janela: grava todo arquivo sujo de todo projeto, pelo mesmo caminho de `saveFile` (que nunca
 * grava por cima de um arquivo mudado no disco, sumido ou de fins de linha misturados). Devolve `true` só se, depois
 * das gravações, nada ficou sujo: uma gravação que falhou, um conflito e o que se digitou durante a gravação
 * mantêm a janela aberta. O motivo de cada falha fica no arquivo (`saveProblem`) e a aba da primeira que falhou
 * vai para a frente. Pedidos ao mesmo tempo dividem a mesma execução: gravar duas vezes o mesmo arquivo mandaria
 * uma versão esperada já velha.
 */
export function saveAllDirty(): Promise<boolean> {
  saveAllRun ??= runSaveAll().finally(() => {
    saveAllRun = undefined;
  });
  return saveAllRun;
}

async function runSaveAll(): Promise<boolean> {
  const dirty = [...states].flatMap(([projectId, state]) =>
    state.files.filter((file) => file.dirty).map((file) => ({ projectId, path: file.path })),
  );
  const outcomes = await Promise.all(
    dirty.map(async (target) => ({
      ...target,
      outcome: await saveFile(target.projectId, target.path),
    })),
  );
  let shown = false;
  for (const { projectId, path, outcome } of outcomes) {
    // Uma gravação que deu certo mas ficou sujo (digitaram durante ela) não é falha: só mantém a janela aberta.
    if (outcome.ok || !isFileDirty(projectId, path)) continue;
    patch(projectId, path, (buffer) => ({ ...buffer, saveProblem: outcome.message }));
    if (!shown) {
      shown = true;
      setActive(projectId, path);
    }
  }
  return !hasDirtyFiles();
}

/**
 * Atende o "Salvar" ao fechar a janela: assina o pedido do processo principal e responde com o resultado de
 * `saveAllDirty`. Devolve a função que cancela a assinatura. Sem a API do preload (telas montadas sem ela, nos
 * testes), não assina nada.
 */
export function listenForSaveAllRequests(): () => void {
  try {
    return window.projectHub.files.onSaveAllRequest(() => saveAllDirty());
  } catch {
    return () => undefined;
  }
}

/** Duas versões têm o mesmo conteúdo. Quem decide é o conteúdo (tamanho e hash), como no processo principal. */
function sameContent(a: FileVersionDto, b: FileVersionDto): boolean {
  return a.size === b.size && a.hash === b.hash;
}

const reloadedTimers = new Map<string, ReturnType<typeof setTimeout>>();
const fileKey = (projectId: string, path: string) => `${projectId}\u0000${path}`;

function clearReloadedTimer(projectId: string, path: string) {
  const key = fileKey(projectId, path);
  clearTimeout(reloadedTimers.get(key));
  reloadedTimers.delete(key);
}

/** O aviso de "atualizado" some sozinho depois de alguns segundos (se não foi trocado por outro nesse tempo). */
function expireReloadedNotice(projectId: string, path: string) {
  clearReloadedTimer(projectId, path);
  const key = fileKey(projectId, path);
  reloadedTimers.set(
    key,
    setTimeout(() => {
      reloadedTimers.delete(key);
      patch(projectId, path, (buffer) =>
        buffer.notice === 'reloaded' ? { ...buffer, notice: undefined } : buffer,
      );
    }, RELOADED_NOTICE_MS),
  );
}

/** O buffer sem aviso e sem a cópia do disco. */
function settled(buffer: OpenFileBuffer): OpenFileBuffer {
  const { notice: _notice, disk: _disk, saveProblem: _saveProblem, ...rest } = buffer;
  return rest;
}

function fileOf(projectId: string, path: string): OpenFileBuffer | undefined {
  return stateOf(projectId).files.find((item) => item.path === path);
}

/** O disco ficou sem o arquivo: a aba guarda o texto e avisa. */
function markMissing(projectId: string, path: string) {
  if (fileOf(projectId, path)?.notice === 'missing') return;
  patch(projectId, path, (buffer) => ({ ...settled(buffer), notice: 'missing' }));
}

const checking = new Set<string>();

/**
 * Confere se o arquivo mudou no disco depois da última leitura ou gravação (`files.stat`, comparando o conteúdo).
 * Sem alterações não salvas, relê o arquivo sozinho e avisa por 5 s. Com alterações, guarda o que o disco tem e
 * abre a faixa de conflito (`changed-on-disk`): o texto da pessoa nunca é trocado nem gravado aqui. Arquivo
 * ausente vira `missing`. Uma falha ao consultar o disco não é relatada: a próxima conferência tenta de novo.
 * Roda ao ativar a aba, quando a janela ganha foco e depois de uma gravação recusada porque o disco mudou.
 */
export async function checkFileOnDisk(projectId: string, path: string): Promise<void> {
  const key = fileKey(projectId, path);
  if (checking.has(key)) return;
  checking.add(key);
  try {
    await compareWithDisk(projectId, path);
  } catch {
    // Sem resposta do disco, não há o que relatar.
  } finally {
    checking.delete(key);
  }
}

async function compareWithDisk(projectId: string, path: string): Promise<void> {
  const first = fileOf(projectId, path);
  if (first?.load !== 'ready' || first.saved === undefined) return;

  const stat = await window.projectHub.files.stat(projectId, path);
  if (!stat.ok) {
    if (stat.error.code === 'FILE_NOT_FOUND') markMissing(projectId, path);
    return;
  }
  if (!stat.data.exists) {
    markMissing(projectId, path);
    return;
  }
  const { version } = stat.data;

  // O estado de agora, não o de antes de perguntar ao disco: a pessoa pode ter digitado ou gravado nesse meio-tempo.
  const file = fileOf(projectId, path);
  if (file?.saved === undefined) return;
  if (sameContent(version, file.saved.version)) {
    // O disco é o que o editor tinha (o arquivo voltou, ou o conflito se desfez): o aviso não vale mais.
    if (file.notice === 'missing' || file.notice === 'changed-on-disk') {
      patch(projectId, path, settled);
    }
    return;
  }
  // Conflito já aberto com esta mesma versão do disco: nada novo a mostrar.
  if (file.notice === 'changed-on-disk' && file.disk && sameContent(version, file.disk.version)) {
    return;
  }

  const read = await window.projectHub.files.read(projectId, path);
  const current = fileOf(projectId, path);
  if (current?.saved === undefined) return;
  if (!read.ok) {
    // Não dá para ler a versão nova (grande demais, ou virou binário): sem edições, a aba mostra o motivo;
    // com edições, o conflito fica aberto e a pessoa decide pelo que tem na tela.
    if (current.dirty) {
      patch(projectId, path, (buffer) => ({
        ...buffer,
        notice: 'changed-on-disk',
        disk: undefined,
      }));
    } else {
      patch(projectId, path, (buffer) => ({ ...settled(buffer), ...failedRead(read.error) }));
    }
    return;
  }
  const disk = read.data;
  let reloaded = false;
  patch(projectId, path, (buffer) => {
    if (buffer.saved === undefined) return buffer;
    // Entre o stat e a leitura o disco pode ter voltado ao que o editor tem.
    if (sameContent(disk.version, buffer.saved.version)) return settled(buffer);
    if (buffer.dirty) return { ...buffer, notice: 'changed-on-disk', disk };
    reloaded = true;
    return { ...settled(buffer), saved: disk, text: disk.text, dirty: false, notice: 'reloaded' };
  });
  if (reloaded) expireReloadedNotice(projectId, path);
}

/** Lê o disco de novo e guarda o resultado como `disk` do conflito. Devolve se conseguiu. */
export async function readDiskVersion(projectId: string, path: string): Promise<boolean> {
  try {
    const read = await window.projectHub.files.read(projectId, path);
    if (!read.ok) return false;
    patch(projectId, path, (buffer) =>
      buffer.notice === 'changed-on-disk' ? { ...buffer, disk: read.data } : buffer,
    );
    return true;
  } catch {
    return false;
  }
}

/** Troca o texto do editor pelo do disco, descartando as alterações. Devolve se conseguiu ler o disco. */
export async function reloadFromDisk(projectId: string, path: string): Promise<boolean> {
  try {
    const read = await window.projectHub.files.read(projectId, path);
    if (!read.ok) return false;
    const disk = read.data;
    patch(projectId, path, (buffer) => ({
      ...settled(buffer),
      saved: disk,
      text: disk.text,
      dirty: false,
    }));
    clearReloadedTimer(projectId, path);
    return true;
  } catch {
    return false;
  }
}

/** O arquivo aberto tem alterações não salvas agora (lido do store, não de uma tela já renderizada). */
export function isFileDirty(projectId: string, path: string): boolean {
  return fileOf(projectId, path)?.dirty === true;
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
  checking.clear();
  for (const timer of reloadedTimers.values()) clearTimeout(timer);
  reloadedTimers.clear();
  syncUnloadGuard();
}
