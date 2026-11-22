import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { AccountChoice, type AccountChoiceItem } from '../../src/renderer/components/AccountChoice';

const X = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const Y = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

const accounts: AccountChoiceItem[] = [
  { id: null, name: 'Principal', isDefault: true, state: 'connected' },
  { id: X, name: 'Trabalho', isDefault: false, state: 'connected' },
  { id: Y, name: 'Cliente', isDefault: false, state: 'signed-out' },
];

function setup(props: Partial<Parameters<typeof AccountChoice>[0]> = {}) {
  const onChange = vi.fn();
  const onCancel = vi.fn();
  render(
    <AccountChoice
      label="Conta do Claude Code"
      accounts={accounts}
      value={null}
      onChange={onChange}
      onCancel={onCancel}
      {...props}
    />,
  );
  return { onChange, onCancel };
}

describe('AccountChoice', () => {
  it('é uma lista de escolha única, com o nome dado e a conta atual marcada', () => {
    setup({ value: X });

    expect(screen.getByRole('listbox', { name: 'Conta do Claude Code' })).toBeInTheDocument();
    expect(screen.getAllByRole('option')).toHaveLength(3);
    expect(screen.getByRole('option', { name: /Trabalho/ })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    expect(screen.getByRole('option', { name: /Principal/ })).toHaveAttribute(
      'aria-selected',
      'false',
    );
  });

  it('mostra a etiqueta "Padrão" e o estado "Sem login", com a marca de forma', () => {
    setup();

    expect(screen.getByRole('option', { name: /Principal/ })).toHaveTextContent('Padrão');
    expect(screen.getByRole('option', { name: /Trabalho/ })).not.toHaveTextContent('Padrão');
    const semLogin = screen.getByRole('option', { name: /Cliente/ });
    expect(semLogin).toHaveTextContent('Sem login');
    expect(semLogin.querySelector('svg')).not.toBeNull();
    expect(semLogin).not.toHaveAttribute('aria-disabled', 'true');
  });

  it('clicar numa conta a escolhe, pelo id (null é a Principal)', async () => {
    const { onChange } = setup({ value: X });

    await userEvent.click(screen.getByRole('option', { name: /Cliente/ }));
    await userEvent.click(screen.getByRole('option', { name: /Principal/ }));

    expect(onChange.mock.calls).toEqual([[Y], [null]]);
  });

  it('só a conta marcada entra na ordem do Tab; as setas andam, Home e End vão às pontas, Enter escolhe', async () => {
    const { onChange } = setup({ autoFocus: true });

    expect(screen.getByRole('option', { name: /Principal/ })).toHaveFocus();
    expect(screen.getByRole('option', { name: /Trabalho/ })).toHaveAttribute('tabindex', '-1');
    await userEvent.keyboard('{ArrowDown}');
    expect(screen.getByRole('option', { name: /Trabalho/ })).toHaveFocus();
    await userEvent.keyboard('{End}');
    expect(screen.getByRole('option', { name: /Cliente/ })).toHaveFocus();
    await userEvent.keyboard('{ArrowDown}');
    expect(screen.getByRole('option', { name: /Principal/ })).toHaveFocus();
    await userEvent.keyboard('{ArrowUp}{Home}{ArrowDown}{Enter}');

    expect(onChange).toHaveBeenCalledWith(X);
  });

  it('Esc avisa quem abriu, sem escolher nada', async () => {
    const { onChange, onCancel } = setup({ autoFocus: true });

    await userEvent.keyboard('{Escape}');

    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onChange).not.toHaveBeenCalled();
  });

  it('desabilitada, não escolhe', async () => {
    const { onChange } = setup({ disabled: true });

    await userEvent.click(screen.getByRole('option', { name: /Trabalho/ }));

    expect(screen.getByRole('listbox')).toHaveAttribute('aria-disabled', 'true');
    expect(onChange).not.toHaveBeenCalled();
  });

  it('o detalhe de cada conta (o uso dela) aparece ao lado do nome', () => {
    setup({ detailOf: (account) => (account.id === X ? '5 h: 40%' : 'sem leitura') });

    expect(screen.getByRole('option', { name: /Trabalho/ })).toHaveTextContent('5 h: 40%');
    expect(screen.getByRole('option', { name: /Cliente/ })).toHaveTextContent('sem leitura');
  });
});

describe('AccountChoice: conta por chave de API', () => {
  const K = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
  const L = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
  const M = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
  const withApi: AccountChoiceItem[] = [
    { id: null, name: 'Principal', isDefault: true, state: 'connected' },
    { id: K, name: 'Chave', isDefault: false, state: 'connected', kind: 'api', keyState: 'stored' },
    {
      id: L,
      name: 'Vazia',
      isDefault: false,
      state: 'connected',
      kind: 'api',
      keyState: 'missing',
    },
    {
      id: M,
      name: 'Trancada',
      isDefault: false,
      state: 'connected',
      kind: 'api',
      keyState: 'locked',
    },
  ];

  it('a conta API mostra o selo no seletor', () => {
    setup({ accounts: withApi });
    expect(screen.getByRole('option', { name: /Chave/ })).toHaveTextContent('API');
    expect(screen.getByRole('option', { name: /Principal/ })).not.toHaveTextContent('API');
  });

  it('conta API sem chave aparece desativada, com o estado, e não é escolhida por teclado', async () => {
    const { onChange } = setup({ accounts: withApi });
    const empty = screen.getByRole('option', { name: /Vazia/ });
    expect(empty).toHaveAttribute('aria-disabled', 'true');
    expect(empty).toHaveTextContent('Sem chave');

    await userEvent.click(empty);
    empty.focus();
    await userEvent.keyboard('{Enter}');
    await userEvent.keyboard(' ');
    expect(onChange).not.toHaveBeenCalled();
  });

  it('chave ilegível também fica desativada, com o estado', () => {
    setup({
      accounts: [
        ...withApi.slice(0, 1),
        {
          id: L,
          name: 'Ruim',
          isDefault: false,
          state: 'connected',
          kind: 'api',
          keyState: 'unreadable',
        },
      ],
    });
    const bad = screen.getByRole('option', { name: /Ruim/ });
    expect(bad).toHaveAttribute('aria-disabled', 'true');
    expect(bad).toHaveTextContent('Chave ilegível');
  });

  it('conta API com o cofre trancado pode ser escolhida', async () => {
    const { onChange } = setup({ accounts: withApi });
    const locked = screen.getByRole('option', { name: /Trancada/ });
    expect(locked).not.toHaveAttribute('aria-disabled');
    expect(locked).toHaveTextContent('Cofre trancado');

    await userEvent.click(locked);
    expect(onChange).toHaveBeenCalledWith(M);
  });
});
