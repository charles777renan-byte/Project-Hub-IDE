import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { ConfirmButton, ConfirmInline } from '../../src/renderer/components/ConfirmButton';

const QUESTION = 'Excluir esta missão? Não dá para desfazer.';

describe('ConfirmButton', () => {
  it('com ariaLabel, o botão inicial ganha esse nome acessível e mantém o texto visível', () => {
    render(
      <ConfirmButton
        label="Remover"
        ariaLabel="Remover tarefa Criar API"
        question="Remover a tarefa?"
        confirmLabel="Remover"
        onConfirm={vi.fn()}
      />,
    );

    expect(screen.getByRole('button', { name: 'Remover tarefa Criar API' })).toHaveTextContent(
      'Remover',
    );
  });

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

  it('Voltar devolve o foco ao botão inicial', async () => {
    const user = userEvent.setup();
    render(
      <ConfirmButton
        label="Excluir missão"
        question={QUESTION}
        confirmLabel="Excluir"
        onConfirm={vi.fn()}
      />,
    );

    await user.click(screen.getByRole('button', { name: 'Excluir missão' }));
    await user.click(screen.getByRole('button', { name: 'Voltar' }));

    expect(screen.getByRole('button', { name: 'Excluir missão' })).toHaveFocus();
  });

  it('com hint (botão envolvido pelo Radix), Voltar também devolve o foco ao botão inicial', async () => {
    const user = userEvent.setup();
    render(
      <ConfirmButton
        label="Excluir missão"
        question={QUESTION}
        confirmLabel="Excluir"
        hint="Exclui a missão inteira"
        onConfirm={vi.fn()}
      />,
    );

    await user.click(screen.getByRole('button', { name: 'Excluir missão' }));
    await user.click(screen.getByRole('button', { name: 'Voltar' }));

    expect(screen.getByRole('button', { name: 'Excluir missão' })).toHaveFocus();
  });

  it('Excluir não devolve o foco ao botão inicial, porque o item costuma sair da tela', async () => {
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
    expect(screen.getByRole('button', { name: 'Excluir missão' })).not.toHaveFocus();
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

describe('ConfirmInline', () => {
  it('mostra a pergunta num grupo, com o botão de confirmar e o Voltar', () => {
    render(
      <ConfirmInline
        question={QUESTION}
        confirmLabel="Excluir"
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />,
    );

    const grupo = screen.getByRole('group', { name: QUESTION });
    expect(grupo).toHaveClass('confirm-inline');
    expect(grupo).toHaveTextContent(QUESTION);
    expect(screen.getByRole('button', { name: 'Excluir' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Voltar' })).toBeEnabled();
  });

  it('Excluir chama onConfirm e Voltar chama onCancel, cada um só o seu', async () => {
    const onConfirm = vi.fn();
    const onCancel = vi.fn();
    const user = userEvent.setup();
    render(
      <ConfirmInline
        question={QUESTION}
        confirmLabel="Excluir"
        onConfirm={onConfirm}
        onCancel={onCancel}
      />,
    );

    await user.click(screen.getByRole('button', { name: 'Voltar' }));
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onConfirm).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: 'Excluir' }));
    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it('desabilitado, nenhum dos dois botões age', async () => {
    const onConfirm = vi.fn();
    const onCancel = vi.fn();
    const user = userEvent.setup();
    render(
      <ConfirmInline
        question={QUESTION}
        confirmLabel="Excluir"
        disabled
        onConfirm={onConfirm}
        onCancel={onCancel}
      />,
    );

    await user.click(screen.getByRole('button', { name: 'Excluir' }));
    await user.click(screen.getByRole('button', { name: 'Voltar' }));

    expect(onConfirm).not.toHaveBeenCalled();
    expect(onCancel).not.toHaveBeenCalled();
  });
});
