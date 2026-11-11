import { CHANNELS, type LimitsDto } from '@project-hub/contracts';
import type { IpcMainInvokeEvent } from 'electron';
import { describe, expect, it, vi } from 'vitest';
import { registerLimitsHandlers } from '../src/main/ipc/limits';
import type { IpcRegistry } from '../src/main/ipc/trusted-handler';

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
    channels: () => [...listeners.keys()].sort(),
    call(channel: string, senderUrl: string) {
      const listener = listeners.get(channel);
      if (listener === undefined) throw new Error(`canal ${channel} não registrado`);
      return listener({ senderFrame: { url: senderUrl } } as unknown as IpcMainInvokeEvent);
    },
  };
}

const LIMITS: LimitsDto = {
  providers: [
    {
      provider: 'claude',
      windows: [{ id: 'five_hour', usedPercent: 16, resetsAt: '2026-10-28T15:00:00.000Z' }],
      capturedAt: '2026-10-28T12:00:00.000Z',
      refreshing: false,
    },
    {
      provider: 'codex',
      windows: [
        {
          id: 'thirty_day',
          usedPercent: 47,
          resetsAt: '2026-11-28T00:00:00.000Z',
          durationMinutes: 43200,
        },
      ],
      capturedAt: '2026-10-28T11:50:00.000Z',
      refreshing: false,
    },
  ],
};
const REFRESHED: LimitsDto = {
  providers: [
    { ...LIMITS.providers[0]!, capturedAt: '2026-10-28T12:30:00.000Z' },
    LIMITS.providers[1]!,
  ],
};

describe('limits:get:v1 e limits:refresh:v1', () => {
  it('registra só os dois canais de pedido (o evento vai do processo principal para o renderer)', () => {
    const fake = fakeRegistry();
    registerLimitsHandlers(fake.registry, isTrusted, {
      get: () => LIMITS,
      refresh: () => Promise.resolve(REFRESHED),
    });

    expect(fake.channels()).toEqual([CHANNELS.limitsGet, CHANNELS.limitsRefresh].sort());
  });

  it('get devolve o estado guardado sem pedir leitura', async () => {
    const fake = fakeRegistry();
    const refresh = vi.fn(() => Promise.resolve(REFRESHED));
    registerLimitsHandlers(fake.registry, isTrusted, { get: () => LIMITS, refresh });

    expect(await fake.call(CHANNELS.limitsGet, 'file:///app/index.html')).toEqual({
      ok: true,
      data: LIMITS,
    });
    expect(refresh).not.toHaveBeenCalled();
  });

  it('refresh espera a leitura e devolve o estado depois dela', async () => {
    const fake = fakeRegistry();
    const get = vi.fn(() => LIMITS);
    registerLimitsHandlers(fake.registry, isTrusted, {
      get,
      refresh: () => Promise.resolve(REFRESHED),
    });

    expect(await fake.call(CHANNELS.limitsRefresh, 'file:///app/index.html')).toEqual({
      ok: true,
      data: REFRESHED,
    });
    expect(get).not.toHaveBeenCalled();
  });

  it.each([CHANNELS.limitsGet, CHANNELS.limitsRefresh])(
    'recusa remetente de outra origem em %s, sem tocar no serviço (R65)',
    async (channel) => {
      const fake = fakeRegistry();
      const get = vi.fn(() => LIMITS);
      const refresh = vi.fn(() => Promise.resolve(REFRESHED));
      registerLimitsHandlers(fake.registry, isTrusted, { get, refresh });

      expect(await fake.call(channel, 'https://site.invalido/')).toMatchObject({
        ok: false,
        error: { code: 'PERMISSION_DENIED' },
      });
      expect(get).not.toHaveBeenCalled();
      expect(refresh).not.toHaveBeenCalled();
    },
  );

  it('falha inesperada do serviço vira UNKNOWN, sem vazar a mensagem', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const fake = fakeRegistry();
    registerLimitsHandlers(fake.registry, isTrusted, {
      get: () => LIMITS,
      refresh: () => Promise.reject(new Error('detalhe interno')),
    });

    const result = await fake.call(CHANNELS.limitsRefresh, 'file:///app/index.html');

    expect(result).toMatchObject({ ok: false, error: { code: 'UNKNOWN' } });
    expect(JSON.stringify(result)).not.toContain('detalhe interno');
    error.mockRestore();
  });
});
