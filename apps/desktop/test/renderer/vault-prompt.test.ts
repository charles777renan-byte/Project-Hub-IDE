import { afterEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/dom';
import userEvent from '@testing-library/user-event';
import {
  mountVaultPrompt,
  type VaultPromptApi,
  type VaultPromptState,
} from '../../src/renderer/vault-prompt/mount';

function setup(
  state: VaultPromptState,
  answer: { ok: true } | { ok: false; message: string } = { ok: true },
) {
  const root = document.createElement('div');
  document.body.append(root);
  const api: VaultPromptApi = {
    state: vi.fn(() => Promise.resolve(state)),
    submit: vi.fn(() => Promise.resolve(answer)),
    cancel: vi.fn(() => Promise.resolve()),
  };
  const ready = mountVaultPrompt(root, api);
  return { root, api, ready, user: userEvent.setup() };
}

afterEach(() => {
  document.body.replaceChildren();
  vi.useRealTimers();
});

describe('página da senha do cofre', () => {
  it('create: senhas diferentes não enviam nada', async () => {
    const h = setup({ mode: 'create' });
    await h.ready;

    await h.user.type(screen.getByLabelText('Senha'), 'senha-bem-longa-1');
    await h.user.type(screen.getByLabelText('Repita a senha'), 'senha-bem-longa-2');
    await h.user.click(screen.getByRole('button', { name: 'Criar senha' }));

    expect(screen.getByRole('alert').textContent).toBe('As senhas não são iguais.');
    expect(h.api.submit).not.toHaveBeenCalled();
  });

  it('create: menos de 12 caracteres não envia nada', async () => {
    const h = setup({ mode: 'create' });
    await h.ready;

    await h.user.type(screen.getByLabelText('Senha'), 'curta');
    await h.user.type(screen.getByLabelText('Repita a senha'), 'curta');
    await h.user.click(screen.getByRole('button', { name: 'Criar senha' }));

    expect(screen.getByRole('alert').textContent).toBe('Use pelo menos 12 caracteres.');
    expect(h.api.submit).not.toHaveBeenCalled();
  });

  it('create: mostra que a senha não pode ser recuperada e envia a senha', async () => {
    const h = setup({ mode: 'create' });
    await h.ready;

    expect(h.root.textContent).toContain('Esta senha não pode ser recuperada.');
    await h.user.type(screen.getByLabelText('Senha'), 'senha-bem-longa-1');
    await h.user.type(screen.getByLabelText('Repita a senha'), 'senha-bem-longa-1');
    await h.user.click(screen.getByRole('button', { name: 'Criar senha' }));

    expect(h.api.submit).toHaveBeenCalledWith({ password: 'senha-bem-longa-1' });
  });

  it('unlock: envia a senha e limpa o campo', async () => {
    const h = setup({ mode: 'unlock' }, { ok: false, message: 'Senha incorreta.' });
    await h.ready;
    const field = screen.getByLabelText<HTMLInputElement>('Senha');

    await h.user.type(field, 'qualquer-senha');
    await h.user.keyboard('{Enter}');

    expect(h.api.submit).toHaveBeenCalledWith({ password: 'qualquer-senha' });
    await waitFor(() => expect(screen.getByRole('alert').textContent).toBe('Senha incorreta.'));
    expect(field.value).toBe('');
  });

  it('os campos são de senha, sem preenchimento automático, com a classe do app', async () => {
    const h = setup({ mode: 'change' });
    await h.ready;

    const fields = h.root.querySelectorAll('input');
    expect(fields).toHaveLength(3);
    for (const field of fields) {
      expect(field.type).toBe('password');
      expect(field.getAttribute('autocomplete')).toBe('off');
      expect(field.closest('.field')).not.toBeNull();
    }
  });

  it('change: nova e repetição diferentes não enviam nada; iguais enviam atual e nova', async () => {
    const h = setup({ mode: 'change' });
    await h.ready;

    await h.user.type(screen.getByLabelText('Senha atual'), 'senha-atual-longa');
    await h.user.type(screen.getByLabelText('Nova senha'), 'senha-nova-longa-1');
    await h.user.type(screen.getByLabelText('Repita a nova senha'), 'senha-nova-longa-2');
    await h.user.click(screen.getByRole('button', { name: 'Trocar senha' }));
    expect(h.api.submit).not.toHaveBeenCalled();

    await h.user.clear(screen.getByLabelText('Repita a nova senha'));
    await h.user.type(screen.getByLabelText('Repita a nova senha'), 'senha-nova-longa-1');
    await h.user.click(screen.getByRole('button', { name: 'Trocar senha' }));

    expect(h.api.submit).toHaveBeenCalledWith({
      password: 'senha-atual-longa',
      next: 'senha-nova-longa-1',
    });
  });

  it('Esc cancela', async () => {
    const h = setup({ mode: 'unlock' });
    await h.ready;

    await h.user.keyboard('{Escape}');

    expect(h.api.cancel).toHaveBeenCalledTimes(1);
  });

  it('o botão Cancelar cancela', async () => {
    const h = setup({ mode: 'unlock' });
    await h.ready;

    await h.user.click(screen.getByRole('button', { name: 'Cancelar' }));

    expect(h.api.cancel).toHaveBeenCalledTimes(1);
  });

  it('com espera em curso, o botão fica desativado e mostra os segundos', async () => {
    const retryAt = new Date(Date.now() + 4_000).toISOString();
    const h = setup({ mode: 'unlock', retryAt });
    await h.ready;

    const button = screen.getByRole<HTMLButtonElement>('button', {
      name: /Tente de novo em \d+ s/,
    });
    expect(button.disabled).toBe(true);
    expect(button.textContent).toMatch(/Tente de novo em [34] s/);
  });
});
