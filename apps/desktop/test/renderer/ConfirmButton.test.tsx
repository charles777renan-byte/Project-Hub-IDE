import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { ConfirmButton } from '../../src/renderer/components/ConfirmButton';

const QUESTION = 'Excluir esta missão? Não dá para desfazer.';

describe('ConfirmButton', () => {
  it('o primeiro clique troca o botão pela pergunta, sem chamar a ação', async () => {
    const onConfirm = vi.fn();
    const user = userEvent.setup();
    render(
      <ConfirmButton
        label="Excluir missão"
        question={QUESTION}
        confirmLabel="Excluir"
        onConfirm={onConfirm}
      />,
    );

    await user.click(screen.getByRole('button', { name: 'Excluir missão' }));

    expect(screen.getByRole('group', { name: QUESTION })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Excluir missão' })).not.toBeInTheDocument();
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it('Excluir confirma: a ação roda uma vez e a pergunta some', async () => {
    const onConfirm = vi.fn();
    const user = userEvent.setup();
    render(
      <ConfirmButton
        label="Excluir missão"
        question={QUESTION}
        confirmLabel="Excluir"
        onConfirm={onConfirm}
      />,
    );

    await user.click(screen.getByRole('button', { name: 'Excluir missão' }));
    await user.click(screen.getByRole('button', { name: 'Excluir' }));

    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('group', { name: QUESTION })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Excluir missão' })).toBeInTheDocument();
  });

  it('Voltar desfaz o pedido sem chamar a ação', async () => {
    const onConfirm = vi.fn();
    const user = userEvent.setup();
    render(
      <ConfirmButton
        label="Excluir missão"
        question={QUESTION}
        confirmLabel="Excluir"
        onConfirm={onConfirm}
      />,
    );

    await user.click(screen.getByRole('button', { name: 'Excluir missão' }));
    await user.click(screen.getByRole('button', { name: 'Voltar' }));

    expect(onConfirm).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Excluir missão' })).toBeInTheDocument();
  });

  it('desabilitado, o botão inicial não abre a pergunta', async () => {
    const onConfirm = vi.fn();
    const user = userEvent.setup();
    render(
      <ConfirmButton
        label="Excluir missão"
        question={QUESTION}
        confirmLabel="Excluir"
        disabled
        onConfirm={onConfirm}
      />,
    );

    await user.click(screen.getByRole('button', { name: 'Excluir missão' }));

    expect(screen.queryByRole('group', { name: QUESTION })).not.toBeInTheDocument();
    expect(onConfirm).not.toHaveBeenCalled();
  });
});
