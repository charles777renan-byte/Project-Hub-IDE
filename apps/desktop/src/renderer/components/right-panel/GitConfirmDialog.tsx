import { useEffect, useId, useRef, type ReactNode } from 'react';
import { RIGHT_PANEL_TEXT } from '../../mission-text';

const TEXT = RIGHT_PANEL_TEXT.git;

/**
 * A confirmação de uma ação do Git que sai do computador ou muda o repositório. É um `<dialog>` modal nativo
 * (`showModal`), como a paleta de comandos, e nunca o diálogo do Radix, porque o modo modal do Radix monta um
 * `<style>` que a CSP bloqueia. Fecha com o botão de cancelar, com Escape (o evento `cancel`, que passa por
 * `onCancel` para o estado de quem monta não ficar diferente da tela) e quando `open` vira falso.
 *
 * Ao abrir, o foco vai para o botão de cancelar (a escolha segura); ao fechar, volta a quem o tinha antes de abrir
 * (o jsdom e alguns caminhos do navegador não o fazem sozinhos). Sem `confirmLabel`, só há o botão de fechar.
 * O conteúdo só existe com o diálogo aberto.
 */
export function GitConfirmDialog({
  open,
  title,
  confirmLabel,
  cancelLabel = TEXT.cancel,
  busy = false,
  onConfirm,
  onCancel,
  children,
}: {
  open: boolean;
  title: string;
  /** O texto do botão que confirma; `null` deixa só o botão de fechar. */
  confirmLabel: string | null;
  cancelLabel?: string;
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
  children?: ReactNode;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const previousFocus = useRef<HTMLElement | null>(null);
  const titleId = useId();

  useEffect(() => {
    const dialog = dialogRef.current;
    if (dialog === null) return;
    if (open) {
      if (!dialog.open) {
        previousFocus.current =
          document.activeElement instanceof HTMLElement ? document.activeElement : null;
        dialog.showModal();
      }
      cancelRef.current?.focus();
      return;
    }
    if (dialog.open) dialog.close();
    previousFocus.current?.focus();
    previousFocus.current = null;
  }, [open]);

  // Uma falha tira o botão de confirmar (o foco estava nele): o foco vai para o de fechar, em vez de cair no corpo.
  useEffect(() => {
    if (open && confirmLabel === null) cancelRef.current?.focus();
  }, [open, confirmLabel]);

  return (
    <dialog
      ref={dialogRef}
      className="git-dialog"
      aria-labelledby={titleId}
      onCancel={(event) => {
        event.preventDefault();
        onCancel();
      }}
    >
      {open ? (
        <div className="git-dialog__content">
          <h2 id={titleId} className="git-dialog__title">
            {title}
          </h2>
          {children}
          <div className="git-dialog__actions">
            <button type="button" ref={cancelRef} onClick={onCancel}>
              {cancelLabel}
            </button>
            {confirmLabel === null ? null : (
              <button type="button" className="btn-primary" disabled={busy} onClick={onConfirm}>
                {confirmLabel}
              </button>
            )}
          </div>
        </div>
      ) : null}
    </dialog>
  );
}
