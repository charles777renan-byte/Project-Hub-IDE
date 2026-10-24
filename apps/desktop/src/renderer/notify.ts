/**
 * Avisos (toasts) da interface. O estado vive no módulo, fora do React, para qualquer código (um
 * componente, um hook) avisar sem receber nada por props; o `Toaster` lê por `useSyncExternalStore`.
 * Biblioteca própria porque o `sonner` injeta um <style> ao carregar e a CSP (style-src 'self') o barra.
 */

export type ToastKind = 'error' | 'success';
export type Toast = { id: number; kind: ToastKind; message: string };

/** Quantos avisos cabem na pilha: ao passar disso, o sucesso mais antigo sai. */
export const MAX_TOASTS = 3;
/** Quantos avisos aparecem de uma vez; o resto vira o resumo "mais N avisos" (nenhum erro se perde). */
export const MAX_VISIBLE_ERRORS = 5;
/** Tempo até o aviso de sucesso fechar sozinho. O erro fica até ser dispensado. */
export const TOAST_MS = 6000;

let toasts: readonly Toast[] = [];
let nextId = 1;
const timers = new Map<number, ReturnType<typeof setTimeout>>();
const listeners = new Set<() => void>();

function emit(next: readonly Toast[]): void {
  toasts = next;
  for (const listener of listeners) listener();
}

function stopTimer(id: number): void {
  clearTimeout(timers.get(id));
  timers.delete(id);
}

function dismiss(id: number): void {
  stopTimer(id);
  if (!toasts.some((toast) => toast.id === id)) return;
  emit(toasts.filter((toast) => toast.id !== id));
}

function startTimer(id: number): void {
  stopTimer(id);
  timers.set(
    id,
    setTimeout(() => dismiss(id), TOAST_MS),
  );
}

/** Cria o aviso e devolve o id. Igual a um que já está na tela (mesmo tipo e texto): reaproveita-o. */
function push(kind: ToastKind, message: string): number {
  const existing = toasts.find((toast) => toast.kind === kind && toast.message === message);
  if (existing !== undefined) {
    if (kind === 'success') startTimer(existing.id);
    return existing.id;
  }
  const id = nextId++;
  let next = [...toasts, { id, kind, message }];
  // Pilha cheia: sai o sucesso mais antigo. Erro não lido nunca é expulso.
  while (next.length > MAX_TOASTS) {
    const victim = next.find((toast) => toast.kind === 'success' && toast.id !== id);
    if (victim === undefined) break;
    stopTimer(victim.id);
    next = next.filter((toast) => toast !== victim);
  }
  emit(next);
  if (kind === 'success') startTimer(id);
  return id;
}

export const notify = {
  error: (message: string): number => push('error', message),
  success: (message: string): number => push('success', message),
  /** Fecha o aviso; um id que já saiu da tela é ignorado. */
  dismiss,
  /** Esvazia a fila (testes). */
  clear(): void {
    for (const timer of timers.values()) clearTimeout(timer);
    timers.clear();
    emit([]);
  },
};

export function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getToasts(): readonly Toast[] {
  return toasts;
}
