import { CHANNELS } from '@project-hub/contracts';
import type { IpcMainInvokeEvent } from 'electron';
import { describe, expect, it, vi } from 'vitest';
import { registerVaultHandlers, type VaultIpcDeps } from '../src/main/ipc/vault';
import type { IpcRegistry } from '../src/main/ipc/trusted-handler';

const APP = 'file:///app/index.html';
const isTrusted = (event: IpcMainInvokeEvent) => event.senderFrame?.url === APP;

function setup(
  options: {
    unlock?: 'unlocked' | 'cancelled';
    change?: { outcome: 'changed'; lost: string[] } | { outcome: 'cancelled' };
    status?: ReturnType<VaultIpcDeps['vault']['status']>;
  } = {},
) {
  const listeners = new Map<string, (event: IpcMainInvokeEvent, payload?: unknown) => unknown>();
  const registry: IpcRegistry = {
    handle(channel, listener) {
      listeners.set(channel, listener);
    },
  };
  const vault = {
    status: vi.fn(() => options.status ?? { state: 'locked' as const, available: true }),
    lock: vi.fn(),
    reset: vi.fn(),
  };
  const window = {
    ensureUnlocked: vi.fn(() => Promise.resolve(options.unlock ?? 'unlocked')),
    changePassword: vi.fn(() =>
      Promise.resolve(options.change ?? { outcome: 'changed' as const, lost: [] }),
    ),
  };
  registerVaultHandlers(registry, isTrusted, { vault, window });
  const call = (channel: string, payload?: unknown, senderUrl = APP) => {
    const listener = listeners.get(channel);
    if (listener === undefined) throw new Error(`canal ${channel} não registrado`);
    const event = { senderFrame: { url: senderUrl } } as unknown as IpcMainInvokeEvent;
    return listener(event, payload);
  };
  return { call, channels: () => [...listeners.keys()], vault, window };
}

describe('canais do cofre', () => {
  it('registra os canais do cofre, sem o de evento', () => {
    expect(setup().channels().sort()).toEqual(
      [
        CHANNELS.vaultGet,
        CHANNELS.vaultUnlock,
        CHANNELS.vaultLock,
        CHANNELS.vaultChangePassword,
        CHANNELS.vaultReset,
      ].sort(),
    );
  });

  it('vault:get devolve só o estado, a disponibilidade e a espera', async () => {
    const h = setup({
      status: { state: 'locked', available: true, retryAt: '2026-11-21T12:00:04.000Z' },
    });

    expect(await h.call(CHANNELS.vaultGet)).toEqual({
      ok: true,
      data: { state: 'locked', available: true, retryAt: '2026-11-21T12:00:04.000Z' },
    });
  });

  it('vault:unlock devolve só o desfecho', async () => {
    const h = setup({ unlock: 'cancelled' });

    expect(await h.call(CHANNELS.vaultUnlock)).toEqual({
      ok: true,
      data: { outcome: 'cancelled' },
    });
    expect(h.window.ensureUnlocked).toHaveBeenCalledTimes(1);
  });

  it('vault:unlock e vault:change-password recusam dado da tela: a senha só entra pela janela do cofre', async () => {
    const h = setup();

    for (const channel of [CHANNELS.vaultUnlock, CHANNELS.vaultChangePassword]) {
      expect(await h.call(channel, { password: 'senha-de-teste-123' })).toMatchObject({
        ok: false,
        error: { code: 'VALIDATION_FAILED' },
      });
    }
    expect(h.window.ensureUnlocked).not.toHaveBeenCalled();
    expect(h.window.changePassword).not.toHaveBeenCalled();
  });

  it('vault:change-password abre a janela de troca e devolve o desfecho', async () => {
    const lost = '33333333-3333-4333-8333-333333333333';
    const h = setup({ change: { outcome: 'changed', lost: [lost] } });

    expect(await h.call(CHANNELS.vaultChangePassword)).toEqual({
      ok: true,
      data: { outcome: 'changed', lost: [lost] },
    });
  });

  it('vault:lock tranca o cofre', async () => {
    const h = setup();

    expect(await h.call(CHANNELS.vaultLock)).toEqual({ ok: true, data: undefined });
    expect(h.vault.lock).toHaveBeenCalledTimes(1);
  });

  it('vault:reset sem confirm é recusado', async () => {
    const h = setup();

    for (const payload of [
      undefined,
      {},
      { confirm: false },
      { confirm: 'true' },
      { confirm: true, x: 1 },
    ]) {
      expect(await h.call(CHANNELS.vaultReset, payload)).toMatchObject({
        ok: false,
        error: { code: 'VALIDATION_FAILED' },
      });
    }
    expect(h.vault.reset).not.toHaveBeenCalled();

    expect(await h.call(CHANNELS.vaultReset, { confirm: true })).toEqual({
      ok: true,
      data: undefined,
    });
    expect(h.vault.reset).toHaveBeenCalledTimes(1);
  });

  it('chamada de origem não confiável recebe PERMISSION_DENIED, sem tocar no cofre', async () => {
    const h = setup();

    for (const channel of h.channels()) {
      expect(await h.call(channel, { confirm: true }, 'https://site.invalido/')).toMatchObject({
        ok: false,
        error: { code: 'PERMISSION_DENIED' },
      });
    }
    expect(h.vault.lock).not.toHaveBeenCalled();
    expect(h.vault.reset).not.toHaveBeenCalled();
    expect(h.window.ensureUnlocked).not.toHaveBeenCalled();
    expect(h.window.changePassword).not.toHaveBeenCalled();
  });
});
