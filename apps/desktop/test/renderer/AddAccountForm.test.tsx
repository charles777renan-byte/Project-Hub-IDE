import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { VaultDto } from '@project-hub/contracts';
import { AddAccountForm } from '../../src/renderer/components/settings/AddAccountForm';

// Criar conta: um painel com título, o tipo (assinatura ou chave de API, num grupo de rádio) só no Claude Code, o nome
// e as ações. No Codex, só assinatura. A tela nunca tem campo para a chave: só o nome da conta.

const RISK =
  'O programa e os comandos que ele executa têm acesso à chave. Use uma chave só para este computador, com limite de gasto definido no site do serviço. Se suspeitar de vazamento, revogue a chave no site.';
const BILLING =
  'Esta conta cobra por uso, sem o teto de uma assinatura. Sessões e missões longas podem custar caro.';
const READY: VaultDto = { state: 'locked', available: true };

function setup(
  options: {
    allowApi?: boolean;
    vault?: VaultDto | null;
    result?: string | null;
  } = {},
) {
  const onSubmit = vi.fn((_name: string, _kind: string) => Promise.resolve(options.result ?? null));
  const onCancel = vi.fn();
  render(
    <AddAccountForm
      program={options.allowApi === false ? 'Codex' : 'Claude Code'}
      allowApi={options.allowApi ?? true}
      vault={options.vault === undefined ? READY : options.vault}
      submitLabel="Adicionar conta"
      onSubmit={onSubmit}
      onCancel={onCancel}
    />,
  );
  return { onSubmit, onCancel };
}

const nameField = () => screen.getByRole('textbox', { name: 'Nome da conta' });

describe('AddAccountForm', () => {
  it('o painel tem o título do programa', () => {
    setup();
    expect(screen.getByRole('form', { name: 'Nova conta do Claude Code' })).toBeInTheDocument();
  });

  it('o formulário pergunta o tipo e manda kind junto do nome', async () => {
    const { onSubmit } = setup();
    const kinds = screen.getByRole('radiogroup', { name: 'Tipo da conta' });
    const subscription = within(kinds).getByRole('radio', { name: 'Assinatura' });
    const api = within(kinds).getByRole('radio', { name: 'Chave de API' });
    expect(subscription).toBeChecked();
    expect(api).not.toBeChecked();
    expect(subscription).toHaveAccessibleDescription(
      'O login é feito no próprio programa e usa o limite do seu plano.',
    );
    expect(api).toHaveAccessibleDescription(
      'Cobrança por uso. A chave fica cifrada no cofre deste computador.',
    );
    expect(screen.queryByText(RISK)).toBeNull();

    await userEvent.click(api);

    expect(api).toBeChecked();
    expect(subscription).not.toBeChecked();
    const notes = screen.getByRole('list', { name: 'Antes de usar uma chave de API' });
    expect(within(notes).getByText(RISK)).toBeInTheDocument();
    expect(within(notes).getByText(BILLING)).toBeInTheDocument();

    await userEvent.type(nameField(), 'Estudos{Enter}');
    await waitFor(() => expect(onSubmit).toHaveBeenCalledWith('Estudos', 'api'));
  });

  it('assinatura é o tipo que vai quando a pessoa não escolhe', async () => {
    const { onSubmit } = setup();
    await userEvent.type(nameField(), 'Pessoal');
    await userEvent.click(screen.getByRole('button', { name: 'Adicionar conta' }));
    await waitFor(() => expect(onSubmit).toHaveBeenCalledWith('Pessoal', 'subscription'));
  });

  it('o foco começa no tipo escolhido, e as setas trocam o tipo', async () => {
    setup();
    const subscription = screen.getByRole('radio', { name: 'Assinatura' });
    const api = screen.getByRole('radio', { name: 'Chave de API' });
    expect(subscription).toHaveFocus();
    expect(subscription).toHaveAttribute('tabindex', '0');
    expect(api).toHaveAttribute('tabindex', '-1');

    await userEvent.keyboard('{ArrowRight}');
    expect(api).toBeChecked();
    expect(api).toHaveFocus();

    await userEvent.keyboard('{ArrowLeft}');
    expect(subscription).toBeChecked();
    expect(subscription).toHaveFocus();
  });

  it('sem cifra disponível, a opção API fica desativada com o motivo, e as setas não a escolhem', async () => {
    setup({ vault: { state: 'empty', available: false } });
    const api = screen.getByRole('radio', { name: 'Chave de API' });
    expect(api).toBeDisabled();
    expect(api).toHaveAccessibleDescription(
      'A proteção do Windows que cifra a chave não está disponível neste computador.',
    );

    await userEvent.keyboard('{ArrowRight}');
    expect(api).not.toBeChecked();
    expect(screen.getByRole('radio', { name: 'Assinatura' })).toBeChecked();
  });

  it('antes de saber o estado do cofre, a opção API fica desativada', () => {
    setup({ vault: null });
    expect(screen.getByRole('radio', { name: 'Chave de API' })).toBeDisabled();
  });

  it('no Codex, não pergunta o tipo, o foco vai ao nome e manda assinatura', async () => {
    const { onSubmit } = setup({ allowApi: false });
    expect(screen.getByRole('form', { name: 'Nova conta do Codex' })).toBeInTheDocument();
    expect(screen.queryByRole('radiogroup')).toBeNull();
    expect(nameField()).toHaveFocus();
    await userEvent.type(nameField(), 'Outra{Enter}');
    await waitFor(() => expect(onSubmit).toHaveBeenCalledWith('Outra', 'subscription'));
  });

  it('o nome tem rótulo visível', () => {
    setup();
    expect(screen.getByText('Nome da conta').tagName).toBe('LABEL');
    expect(nameField()).toHaveAccessibleName('Nome da conta');
  });

  it('a falha aparece junto do campo, sem apagar o nome', async () => {
    setup({ result: 'Já existe uma conta com esse nome.' });
    await userEvent.type(nameField(), 'Pessoal{Enter}');
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Já existe uma conta com esse nome.',
    );
    expect(nameField()).toHaveValue('Pessoal');
    expect(nameField()).toHaveAttribute('aria-invalid', 'true');
    expect(nameField()).toHaveAccessibleDescription('Já existe uma conta com esse nome.');
  });

  it('nenhum campo de texto para a chave existe na tela', async () => {
    setup();
    await userEvent.click(screen.getByRole('radio', { name: 'Chave de API' }));
    const boxes = screen.queryAllByRole('textbox');
    expect(boxes).toHaveLength(1);
    expect(boxes[0]).toHaveAccessibleName('Nome da conta');
    expect(document.querySelectorAll('input[type="password"]')).toHaveLength(0);
  });

  it('Cancelar chama onCancel sem enviar', async () => {
    const { onSubmit, onCancel } = setup();
    await userEvent.click(screen.getByRole('button', { name: 'Cancelar' }));
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('Esc fecha o painel sem enviar', async () => {
    const { onSubmit, onCancel } = setup();
    await userEvent.type(nameField(), 'Rascunho{Escape}');
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onSubmit).not.toHaveBeenCalled();
  });
});
