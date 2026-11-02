import { CHANNELS } from '@project-hub/contracts';
import type { IpcMainInvokeEvent } from 'electron';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { registerSaveAllResultHandler } from '../src/main/ipc/save-all';
import type { IpcRegistry } from '../src/main/ipc/trusted-handler';

const TRUSTED = 'file:///app/index.html';
const isTrusted = (event: IpcMainInvokeEvent) => event.senderFrame?.url === TRUSTED;

function fakeRegistry() {
  const listeners = new Map<string, (event: IpcMainInvokeEvent, payload?: unknown) => unknown>();
  const registry: IpcRegistry = {
    handle(channel, listener) {
      listeners.set(channel, listener);
    },
  };
  return {
    registry,
    channels: () => [...listeners.keys()],
    call(channel: string, payload?: unknown, senderUrl = TRUSTED) {
      const listener = listeners.get(channel);
      if (listener === undefined) throw new Error(`canal ${channel} não registrado`);
      const event = { senderFrame: { url: senderUrl } } as unknown as IpcMainInvokeEvent;
      return listener(event, payload);
    },
  };
}

let consoleError: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
});
afterEach(() => {
  consoleError.mockRestore();
});

describe('files:save-all-result:v1', () => {
  it('registra só o canal do resultado (o pedido vai do processo principal ao renderer)', () => {
    const fake = fakeRegistry();
    registerSaveAllResultHandler(fake.registry, isTrusted, vi.fn());

    expect(fake.channels()).toEqual([CHANNELS.filesSaveAllResult]);
  });

  it('entrega o resultado do pedido a quem fecha a janela', async () => {
    const fake = fakeRegistry();
    const onResult = vi.fn();
    registerSaveAllResultHandler(fake.registry, isTrusted, onResult);

    const response = await fake.call(CHANNELS.filesSaveAllResult, {
      requestId: 'req-1',
      saved: true,
    });

    expect(response).toEqual({ ok: true, data: undefined });
    expect(onResult).toHaveBeenCalledExactlyOnceWith('req-1', true);
  });

  it('recusa remetente de outra origem sem entregar o resultado', async () => {
    const fake = fakeRegistry();
    const onResult = vi.fn();
    registerSaveAllResultHandler(fake.registry, isTrusted, onResult);

    const response = await fake.call(
      CHANNELS.filesSaveAllResult,
      { requestId: 'req-1', saved: true },
      'https://site.invalido/',
    );

    expect(response).toMatchObject({ ok: false, error: { code: 'PERMISSION_DENIED' } });
    expect(onResult).not.toHaveBeenCalled();
  });

  it.each([
    undefined,
    {},
    { requestId: 'req-1' },
    { saved: true },
    { requestId: '', saved: true },
    { requestId: 'req-1', saved: 'sim' },
    { requestId: 'x'.repeat(101), saved: true },
  ])('recusa entrada fora do contrato (%j) sem entregar o resultado', async (payload) => {
    const fake = fakeRegistry();
    const onResult = vi.fn();
    registerSaveAllResultHandler(fake.registry, isTrusted, onResult);

    const response = await fake.call(CHANNELS.filesSaveAllResult, payload);

    expect(response).toMatchObject({ ok: false, error: { code: 'VALIDATION_FAILED' } });
    expect(onResult).not.toHaveBeenCalled();
  });
});
