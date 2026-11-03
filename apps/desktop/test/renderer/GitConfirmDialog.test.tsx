import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { GitConfirmDialog } from '../../src/renderer/components/right-panel/GitConfirmDialog';

/** O diálogo de confirmação: um `<dialog>` nativo com showModal, nunca o modal do Radix. */

afterEach(() => vi.restoreAllMocks());

function renderDialog(
  props: Partial<Parameters<typeof GitConfirmDialog>[0]> = {},
  handlers: { onConfirm?: () => void; onCancel?: () => void } = {},
) {
  return render(
    <GitConfirmDialog
      open
      title="Enviar 2 commits?"
      confirmLabel="Enviar"
      onConfirm={handlers.onConfirm ?? vi.fn()}
      onCancel={handlers.onCancel ?? vi.fn()}
      {...props}
    >
      <p>detalhes</p>
    </GitConfirmDialog>,
  );
}

describe('GitConfirmDialog', () => {
  it('abre com showModal, com o título e o conteúdo', () => {
    const showModal = vi.spyOn(HTMLDialogElement.prototype, 'showModal');

    renderDialog();

    expect(showModal).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('dialog', { name: 'Enviar 2 commits?' })).toBeInTheDocument();
    expect(screen.getByText('detalhes')).toBeInTheDocument();
  });

  it('fechado, não chama showModal nem mostra o conteúdo', () => {
    const showModal = vi.spyOn(HTMLDialogElement.prototype, 'showModal');

    renderDialog({ open: false });

    expect(showModal).not.toHaveBeenCalled();
    expect(screen.queryByText('detalhes')).not.toBeInTheDocument();
  });

  it('"Cancelar" chama onCancel e não confirma', async () => {
    const user = userEvent.setup();
    const onConfirm = vi.fn();
    const onCancel = vi.fn();
    renderDialog({}, { onConfirm, onCancel });

    await user.click(screen.getByRole('button', { name: 'Cancelar' }));

    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it('Escape (evento cancel) chama onCancel e segura o fechamento nativo', () => {
    const onCancel = vi.fn();
    renderDialog({}, { onCancel });
    const event = new Event('cancel', { cancelable: true });

    fireEvent(screen.getByRole('dialog'), event);

    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(event.defaultPrevented).toBe(true);
  });

  it('o botão de confirmar chama onConfirm', async () => {
    const user = userEvent.setup();
    const onConfirm = vi.fn();
    renderDialog({}, { onConfirm });

    await user.click(screen.getByRole('button', { name: 'Enviar' }));

    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it('sem confirmLabel, não há botão de confirmar e o botão de fechar usa cancelLabel', () => {
    renderDialog({ confirmLabel: null, cancelLabel: 'Fechar' });

    expect(screen.queryByRole('button', { name: 'Enviar' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Fechar' })).toBeInTheDocument();
  });

  it('confirmar fica desligado com busy', () => {
    renderDialog({ busy: true });

    expect(screen.getByRole('button', { name: 'Enviar' })).toBeDisabled();
  });

  it('ao abrir, o foco vai para "Cancelar" (a escolha segura)', () => {
    renderDialog();

    expect(screen.getByRole('button', { name: 'Cancelar' })).toHaveFocus();
  });

  it('ao fechar, fecha o <dialog> e devolve o foco a quem abriu', () => {
    const close = vi.spyOn(HTMLDialogElement.prototype, 'close');
    function Harness({ open }: { open: boolean }) {
      return (
        <>
          <button type="button">Abrir</button>
          <GitConfirmDialog
            open={open}
            title="Enviar?"
            confirmLabel="Enviar"
            onConfirm={vi.fn()}
            onCancel={vi.fn()}
          />
        </>
      );
    }
    const { rerender } = render(<Harness open={false} />);
    const opener = screen.getByRole('button', { name: 'Abrir' });
    opener.focus();

    rerender(<Harness open />);
    expect(opener).not.toHaveFocus();

    rerender(<Harness open={false} />);
    expect(close).toHaveBeenCalled();
    expect(opener).toHaveFocus();
  });
});
