import { CHANNELS, type SystemUsageDto } from '@project-hub/contracts';
import type { IpcMainInvokeEvent } from 'electron';
import { describe, expect, it, vi } from 'vitest';
import type { IpcRegistry } from '../src/main/ipc/trusted-handler';
import { registerSystemHandlers } from '../src/main/ipc/system';

const isTrusted = (event: IpcMainInvokeEvent) =>
  event.senderFrame?.url === 'file:///app/index.html';

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
    call(channel: string, senderUrl: string) {
      const listener = listeners.get(channel);
      if (listener === undefined) throw new Error(`canal ${channel} não registrado`);
      return listener({ senderFrame: { url: senderUrl } } as unknown as IpcMainInvokeEvent);
    },
  };
}

const USAGE: SystemUsageDto = { cpuPercent: 12, memoryUsedBytes: 6, memoryTotalBytes: 24 };

describe('system:usage:v1', () => {
  it('registra só o canal do uso do computador e devolve a leitura', async () => {
    const fake = fakeRegistry();
    registerSystemHandlers(fake.registry, isTrusted, () => USAGE);

    expect(fake.channels()).toEqual([CHANNELS.systemUsage]);
    expect(await fake.call(CHANNELS.systemUsage, 'file:///app/index.html')).toEqual({
      ok: true,
      data: USAGE,
    });
  });

  it('recusa remetente de outra origem sem ler o sistema (R65)', async () => {
    const fake = fakeRegistry();
    const sample = vi.fn(() => USAGE);
    registerSystemHandlers(fake.registry, isTrusted, sample);

    expect(await fake.call(CHANNELS.systemUsage, 'https://site.invalido/')).toMatchObject({
      ok: false,
      error: { code: 'PERMISSION_DENIED' },
    });
    expect(sample).not.toHaveBeenCalled();
  });
});
