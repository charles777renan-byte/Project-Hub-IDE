import { useSyncExternalStore } from 'react';
import { getToasts, notify, subscribe } from '../notify';
import { Hint } from './Hint';
import { CircleAlert, CircleCheck, ICON_PROPS, X } from './Icon';

/**
 * Região dos avisos, no canto inferior direito. Fica sempre montada (`role="status"`, aria-live polite)
 * para o leitor de tela anunciar o que entra; o erro entra como `role="alert"`. O erro fica até ser
 * dispensado, o sucesso fecha sozinho (ver notify.ts). O estilo vem das classes `.toast*` (app.css).
 */
export function Toaster() {
  const toasts = useSyncExternalStore(subscribe, getToasts, getToasts);
  return (
    <div role="status" aria-live="polite" aria-label="Avisos" className="toaster">
      {toasts.map((toast) => (
        <div
          key={toast.id}
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
              onClick={() => notify.dismiss(toast.id)}
            >
              <X {...ICON_PROPS} />
            </button>
          </Hint>
        </div>
      ))}
    </div>
  );
}
