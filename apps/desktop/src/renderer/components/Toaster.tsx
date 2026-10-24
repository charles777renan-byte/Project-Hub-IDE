import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react';
import { MAX_VISIBLE_ERRORS, getToasts, notify, subscribe } from '../notify';
import { Hint } from './Hint';
import { CircleAlert, CircleCheck, ICON_PROPS, X } from './Icon';

/** Quantos Toaster estão montados: só o primeiro renderiza a região (duas regiões repetiriam cada aviso). */
let mounted = 0;

/**
 * Região dos avisos, no canto inferior direito. Fica sempre montada (`role="status"`, aria-live polite)
 * para o leitor de tela anunciar o que entra; o erro entra como `role="alert"`. O erro fica até ser
 * dispensado, o sucesso fecha sozinho (ver notify.ts). Passando de 5 avisos, o resto vira "mais N avisos".
 * O estilo vem das classes `.toast*` (app.css).
 */
export function Toaster() {
  const toasts = useSyncExternalStore(subscribe, getToasts, getToasts);
  const [primary, setPrimary] = useState(false);
  const region = useRef<HTMLDivElement>(null);
  // Depois de dispensar, o foco vai para o próximo aviso (ou para a região); sem isso ele se perderia.
  const focusNext = useRef<{ id: number | null } | null>(null);

  useEffect(() => {
    if (mounted > 0) return undefined;
    mounted += 1;
    setPrimary(true);
    return () => {
      mounted -= 1;
      setPrimary(false);
    };
  }, []);

  useLayoutEffect(() => {
    const target = focusNext.current;
    if (target === null) return;
    focusNext.current = null;
    const button =
      target.id === null
        ? null
        : region.current?.querySelector<HTMLElement>(`[data-toast-id="${target.id}"] button`);
    (button ?? region.current)?.focus();
  }, [toasts]);

  if (!primary) return null;

  const visible = toasts.slice(0, MAX_VISIBLE_ERRORS);
  const hidden = toasts.length - visible.length;

  function close(index: number) {
    const toast = visible[index];
    if (toast === undefined) return;
    const next = visible[index + 1] ?? visible[index - 1];
    focusNext.current = { id: next?.id ?? null };
    notify.dismiss(toast.id);
  }

  return (
    <div
      ref={region}
      role="status"
      aria-live="polite"
      aria-label="Avisos"
      tabIndex={-1}
      className="toaster"
    >
      {visible.map((toast, index) => (
        <div
          key={toast.id}
          data-toast-id={toast.id}
          className={`toast toast--${toast.kind}`}
          {...(toast.kind === 'error' ? { role: 'alert' } : {})}
        >
          {toast.kind === 'error' ? (
            <CircleAlert {...ICON_PROPS} className="toast__icon" />
          ) : (
            <CircleCheck {...ICON_PROPS} className="toast__icon" />
          )}
          <p className="toast__message">{toast.message}</p>
          <Hint label="Fechar aviso">
            <button
              type="button"
              className="btn-ghost toast__close"
              aria-label="Fechar aviso"
              onClick={() => close(index)}
            >
              <X {...ICON_PROPS} />
            </button>
          </Hint>
        </div>
      ))}
      {hidden > 0 ? (
        <p className="toast-more">{hidden === 1 ? 'mais 1 aviso' : `mais ${hidden} avisos`}</p>
      ) : null}
    </div>
  );
}
