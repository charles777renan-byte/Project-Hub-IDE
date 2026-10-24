/**
 * Avisos (toasts) da interface. O estado vive no módulo, fora do React, para qualquer código (um
 * componente, um hook) avisar sem receber nada por props; o `Toaster` lê por `useSyncExternalStore`.
 * Biblioteca própria porque o `sonner` injeta um <style> ao carregar e a CSP (style-src 'self') o barra.
 */

export type ToastKind = 'error' | 'success';
export type Toast = { id: number; kind: ToastKind; message: string };

/** Quantos avisos cabem na tela: o quarto empurra o mais antigo. */
export const MAX_TOASTS = 3;
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

function dismiss(id: number): void {
  clearTimeout(timers.get(id));
  timers.delete(id);
  emit(toasts.filter((toast) => toast.id !== id));
}

function push(kind: ToastKind, message: string): void {
  const id = nextId++;
  const kept = toasts.slice(-(MAX_TOASTS - 1));
  for (const gone of toasts.filter((toast) => !kept.includes(toast))) {
    clearTimeout(timers.get(gone.id));
    timers.delete(gone.id);
  }
  emit([...kept, { id, kind, message }]);
  if (kind === 'success')
    timers.set(
      id,
      setTimeout(() => dismiss(id), TOAST_MS),
    );
}

export const notify = {
  error: (message: string): void => push('error', message),
  success: (message: string): void => push('success', message),
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
