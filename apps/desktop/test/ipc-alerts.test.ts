import { CHANNELS } from '@project-hub/contracts';
import type { IpcMainInvokeEvent } from 'electron';
import { describe, expect, it, vi } from 'vitest';
import type { AlertService } from '../src/main/alerts';
import { registerAlertHandlers } from '../src/main/ipc/alerts';
import type { IpcRegistry } from '../src/main/ipc/trusted-handler';

const TRUSTED = 'file:///app/index.html';
const isTrusted = (event: IpcMainInvokeEvent) => event.senderFrame?.url === TRUSTED;

function setup() {
  const listeners = new Map<string, (event: IpcMainInvokeEvent, payload?: unknown) => unknown>();
  const registry: IpcRegistry = {
    handle(channel, listener) {
      listeners.set(channel, listener);
    },
  };
  const service: AlertService = {
    notify: vi.fn(() => Promise.resolve()),
    notifyAccountSwitch: vi.fn(),
    windowFocused: vi.fn(),
  };
  registerAlertHandlers(registry, isTrusted, service);
  const call = (payload: unknown, url = TRUSTED) =>
    listeners.get(CHANNELS.alertsNotify)?.(
      { senderFrame: { url } } as unknown as IpcMainInvokeEvent,
      payload,
    );
  return { service, call, channels: () => [...listeners.keys()] };
}

describe('registerAlertHandlers', () => {
  it('registra só o canal de pedir aviso', () => {
    expect(setup().channels()).toEqual([CHANNELS.alertsNotify]);
  });

  it('recusa texto no pedido, sem chamar o serviço', async () => {
    const { service, call } = setup();

    await expect(call({ kind: 'mission', id: 'm', title: 'x' })).resolves.toMatchObject({
      ok: false,
      error: { code: 'VALIDATION_FAILED' },
    });
    expect(service.notify).not.toHaveBeenCalled();
  });

  it('pedido válido chama o serviço e volta ok', async () => {
    const { service, call } = setup();

    await expect(call({ kind: 'terminal', id: 't1' })).resolves.toEqual({
      ok: true,
      data: undefined,
    });
    expect(service.notify).toHaveBeenCalledWith({ kind: 'terminal', id: 't1' });
  });

  it('recusa quem não é o app', async () => {
    const { service, call } = setup();

    await expect(
      call({ kind: 'terminal', id: 't1' }, 'https://exemplo.com'),
    ).resolves.toMatchObject({
      ok: false,
      error: { code: 'PERMISSION_DENIED' },
    });
    expect(service.notify).not.toHaveBeenCalled();
  });
});
