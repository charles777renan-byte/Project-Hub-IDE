import { CHANNELS } from '@project-hub/contracts';
import type { IpcMainInvokeEvent } from 'electron';
import { describe, expect, it, vi } from 'vitest';
import type { IpcRegistry } from '../src/main/ipc/trusted-handler';
import {
  activityWindowStart,
  handleActivityDaily,
  registerActivityHandlers,
  type ActivityIpcDeps,
} from '../src/main/ipc/activity';

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
    call(channel: string, senderUrl: string, payload?: unknown) {
      const listener = listeners.get(channel);
      if (listener === undefined) throw new Error(`canal ${channel} não registrado`);
      const event = { senderFrame: { url: senderUrl } } as unknown as IpcMainInvokeEvent;
      return listener(event, payload);
    },
  };
}

const NOW = new Date(2026, 9, 25, 15, 0);

function depsWith(days: unknown): ActivityIpcDeps & { countByLocalDay: ReturnType<typeof vi.fn> } {
  return { countByLocalDay: vi.fn(() => days), now: () => NOW } as never;
}

describe('activity:daily:v1', () => {
  it('a janela começa na meia-noite local de 89 dias antes de hoje', () => {
    expect(activityWindowStart(NOW)).toBe(new Date(2026, 6, 28, 0, 0).toISOString());
  });

  it('aceita entrada vazia e devolve os dias conferidos', async () => {
    const days = [{ date: '2026-10-24', count: 3 }];
    const deps = depsWith(days);

    for (const payload of [undefined, {}]) {
      expect(await handleActivityDaily(deps, payload)).toEqual({ ok: true, data: days });
    }
    expect(deps.countByLocalDay).toHaveBeenCalledWith(activityWindowStart(NOW));
  });

  it('recusa qualquer parâmetro sem consultar o banco', async () => {
    const deps = depsWith([]);

    for (const payload of [{ days: 30 }, { since: '2020-01-01' }, 'texto', 7, null, []]) {
      expect(await handleActivityDaily(deps, payload)).toMatchObject({
        ok: false,
        error: { code: 'VALIDATION_FAILED' },
      });
    }
    expect(deps.countByLocalDay).not.toHaveBeenCalled();
  });

  it('não deixa sair um dia fora do contrato', async () => {
    expect(() =>
      handleActivityDaily(depsWith([{ date: '24/10/2026', count: -1 }]), undefined),
    ).toThrow();
  });

  it('registra só o canal de leitura e recusa remetente de outra origem (R65)', async () => {
    const fake = fakeRegistry();
    const deps = depsWith([]);
    registerActivityHandlers(fake.registry, isTrusted, deps);
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    try {
      expect(fake.channels()).toEqual([CHANNELS.activityDaily]);
      expect(await fake.call(CHANNELS.activityDaily, 'https://site.invalido/')).toMatchObject({
        ok: false,
        error: { code: 'PERMISSION_DENIED' },
      });
      expect(deps.countByLocalDay).not.toHaveBeenCalled();
      expect(await fake.call(CHANNELS.activityDaily, 'file:///app/index.html')).toEqual({
        ok: true,
        data: [],
      });
    } finally {
      error.mockRestore();
    }
  });
});
