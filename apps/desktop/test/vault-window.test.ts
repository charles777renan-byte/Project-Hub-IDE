import { describe, expect, it, vi } from 'vitest';
import { CHANNELS, type AppResult } from '@project-hub/contracts';
import {
  VAULT_PROMPT_CHANNELS,
  createVaultWindow,
  type PromptWindowHandle,
  type VaultWindowDeps,
} from '../src/main/vault-window';

type Listener = (event: { sender: { id: number } }, payload: unknown) => unknown;
const PROMPT_ID = 7;
const OTHER_ID = 1;
const OK: AppResult<undefined> = { ok: true, data: undefined };
const WRONG: AppResult<undefined> = {
  ok: false,
  error: { code: 'VALIDATION_FAILED', message: 'Senha incorreta.', retryable: false },
};

function setup(state: 'empty' | 'locked' | 'unlocked' = 'locked') {
  const vault = {
    state,
    status: vi.fn(() => ({ state: vault.state, available: true })),
    create: vi.fn((): Promise<AppResult<undefined>> => {
      vault.state = 'unlocked';
      return Promise.resolve(OK);
    }),
    unlock: vi.fn((password: string): Promise<AppResult<undefined>> =>
      Promise.resolve(password === 'senha-certa-longa' ? OK : WRONG),
    ),
    changePassword: vi.fn((): Promise<AppResult<{ lost: string[] }>> =>
      Promise.resolve({ ok: true, data: { lost: ['conta-perdida'] } }),
    ),
  };
  const handlers = new Map<string, Listener>();
  const ipc = {
    handle: vi.fn((channel: string, listener: Listener) => {
      if (handlers.has(channel)) throw new Error(`canal já registrado: ${channel}`);
      handlers.set(channel, listener);
    }),
    removeHandler: vi.fn((channel: string) => void handlers.delete(channel)),
  };
  const windows: { closed: boolean; close: () => void; fireClosed: () => void }[] = [];
  const open = vi.fn((): PromptWindowHandle => {
    const listeners: (() => void)[] = [];
    const record = {
      closed: false,
      close: () => {
        if (record.closed) return;
        record.closed = true;
        for (const listener of listeners) listener();
      },
      fireClosed: () => record.close(),
    };
    windows.push(record);
    return {
      webContentsId: PROMPT_ID,
      close: record.close,
      onClosed: (listener) => void listeners.push(listener),
    };
  });
  const deps: VaultWindowDeps = { vault, open, ipc };
  const window = createVaultWindow(deps);
  const call = async (channel: string, payload?: unknown, sender = PROMPT_ID) => {
    const listener = handlers.get(channel);
    if (listener === undefined) throw new Error(`sem handler: ${channel}`);
    return await listener({ sender: { id: sender } }, payload);
  };
  return { window, vault, ipc, open, windows, handlers, call };
}

describe('janela da senha do cofre', () => {
  it('cofre vazio abre no modo create; trancado, no modo unlock', async () => {
    const empty = setup('empty');
    const locked = setup('locked');

    void empty.window.ensureUnlocked();
    void locked.window.ensureUnlocked();

    expect(await empty.call(VAULT_PROMPT_CHANNELS.state)).toEqual({ mode: 'create' });
    expect(await locked.call(VAULT_PROMPT_CHANNELS.state)).toEqual({ mode: 'unlock' });
  });

  it('senha certa resolve "unlocked" e fecha a janela', async () => {
    const h = setup();
    const result = h.window.ensureUnlocked();

    expect(await h.call(VAULT_PROMPT_CHANNELS.submit, { password: 'senha-certa-longa' })).toEqual({
      ok: true,
    });

    expect(await result).toBe('unlocked');
    expect(h.windows[0]?.closed).toBe(true);
    expect(h.handlers.size).toBe(0);
  });

  it('criar a senha resolve "unlocked"', async () => {
    const h = setup('empty');
    const result = h.window.ensureUnlocked();

    await h.call(VAULT_PROMPT_CHANNELS.submit, { password: 'senha-nova-longa' });

    expect(h.vault.create).toHaveBeenCalledWith('senha-nova-longa');
    expect(await result).toBe('unlocked');
  });

  it('fechar a janela ou cancelar resolve "cancelled"', async () => {
    const byCancel = setup();
    const byClose = setup();
    const cancelled = byCancel.window.ensureUnlocked();
    const closed = byClose.window.ensureUnlocked();

    await byCancel.call(VAULT_PROMPT_CHANNELS.cancel);
    byClose.windows[0]?.fireClosed();

    expect(await cancelled).toBe('cancelled');
    expect(await closed).toBe('cancelled');
    expect(byCancel.windows[0]?.closed).toBe(true);
    expect(byCancel.handlers.size).toBe(0);
    expect(byClose.handlers.size).toBe(0);
  });

  it('senha errada mantém a janela aberta e devolve a frase', async () => {
    const h = setup();
    const result = h.window.ensureUnlocked();
    let settled = false;
    void result.then(() => {
      settled = true;
    });

    expect(await h.call(VAULT_PROMPT_CHANNELS.submit, { password: 'senha-errada-longa' })).toEqual({
      ok: false,
      message: 'Senha incorreta.',
    });

    await Promise.resolve();
    expect(settled).toBe(false);
    expect(h.windows[0]?.closed).toBe(false);
    await h.call(VAULT_PROMPT_CHANNELS.submit, { password: 'senha-certa-longa' });
    expect(await result).toBe('unlocked');
  });

  it('duas chamadas juntas abrem uma janela só e recebem o mesmo resultado', async () => {
    const h = setup();

    const first = h.window.ensureUnlocked();
    const second = h.window.ensureUnlocked();
    await h.call(VAULT_PROMPT_CHANNELS.submit, { password: 'senha-certa-longa' });

    expect(await first).toBe('unlocked');
    expect(await second).toBe('unlocked');
    expect(h.open).toHaveBeenCalledTimes(1);
  });

  it('cofre já destrancado resolve na hora, sem janela', async () => {
    const h = setup('unlocked');

    expect(await h.window.ensureUnlocked()).toBe('unlocked');
    expect(h.open).not.toHaveBeenCalled();
  });

  it('pedido vindo de outra janela é recusado', async () => {
    const h = setup();
    void h.window.ensureUnlocked();

    await expect(
      h.call(VAULT_PROMPT_CHANNELS.submit, { password: 'senha-certa-longa' }, OTHER_ID),
    ).rejects.toThrow();
    await expect(h.call(VAULT_PROMPT_CHANNELS.state, undefined, OTHER_ID)).rejects.toThrow();
    await expect(h.call(VAULT_PROMPT_CHANNELS.cancel, undefined, OTHER_ID)).rejects.toThrow();

    expect(h.vault.unlock).not.toHaveBeenCalled();
    expect(h.windows[0]?.closed).toBe(false);
  });

  it('entrada fora do formato é recusada sem chamar o cofre', async () => {
    const h = setup();
    void h.window.ensureUnlocked();

    for (const payload of [undefined, {}, { password: 1 }, { password: 'x', extra: true }]) {
      await expect(h.call(VAULT_PROMPT_CHANNELS.submit, payload)).rejects.toThrow();
    }

    expect(h.vault.unlock).not.toHaveBeenCalled();
  });

  it('trocar a senha abre no modo change e repassa a atual e a nova', async () => {
    const h = setup('unlocked');
    const result = h.window.changePassword();

    expect(await h.call(VAULT_PROMPT_CHANNELS.state)).toEqual({ mode: 'change' });
    await h.call(VAULT_PROMPT_CHANNELS.submit, {
      password: 'senha-certa-longa',
      next: 'senha-nova-bem-longa',
    });

    expect(h.vault.changePassword).toHaveBeenCalledWith(
      'senha-certa-longa',
      'senha-nova-bem-longa',
    );
    expect(await result).toEqual({ outcome: 'changed', lost: ['conta-perdida'] });
  });

  it('trocar a senha sem a nova é recusado', async () => {
    const h = setup('unlocked');
    void h.window.changePassword();

    await expect(
      h.call(VAULT_PROMPT_CHANNELS.submit, { password: 'senha-certa-longa' }),
    ).rejects.toThrow();
    expect(h.vault.changePassword).not.toHaveBeenCalled();
  });

  it('a espera depois de erros vai para a página', async () => {
    const h = setup();
    h.vault.status.mockReturnValue({
      state: 'locked',
      available: true,
      retryAt: '2026-11-21T10:00:02.000Z',
    } as never);
    void h.window.ensureUnlocked();

    expect(await h.call(VAULT_PROMPT_CHANNELS.state)).toEqual({
      mode: 'unlock',
      retryAt: '2026-11-21T10:00:02.000Z',
    });
  });

  it('os canais da janela não estão em CHANNELS', () => {
    const app = Object.values(CHANNELS) as string[];
    for (const channel of Object.values(VAULT_PROMPT_CHANNELS)) {
      expect(app).not.toContain(channel);
    }
  });
});
