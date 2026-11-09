import { CHANNELS } from '@project-hub/contracts';
import type { IpcMainInvokeEvent } from 'electron';
import { describe, expect, it, vi } from 'vitest';
import type { ProjectWatcher } from '../src/main/files/project-watcher';
import { registerFilesWatchHandlers } from '../src/main/ipc/files-watch';
import type { IpcRegistry } from '../src/main/ipc/trusted-handler';

// Os canais que ligam o explorador ao observador de pastas: só remetente confiável, só o id do projeto, e cada janela
// que fecha solta o que observava.

const TRUSTED = 'file:///app/index.html';
const isTrusted = (event: IpcMainInvokeEvent) => event.senderFrame?.url === TRUSTED;

function fakeSender(id: number) {
  const sent: [string, unknown][] = [];
  let onDestroyed: (() => void) | undefined;
  let destroyed = false;
  return {
    sender: {
      id,
      send: (channel: string, payload: unknown) => sent.push([channel, payload]),
      isDestroyed: () => destroyed,
      once: (event: string, listener: () => void) => {
        if (event === 'destroyed') onDestroyed = listener;
      },
    },
    sent,
    destroy() {
      destroyed = true;
      onDestroyed?.();
    },
  };
}

function setup() {
  const listeners = new Map<string, (event: IpcMainInvokeEvent, payload?: unknown) => unknown>();
  const registry: IpcRegistry = {
    handle(channel, listener) {
      listeners.set(channel, listener);
    },
  };
  const changes = new Map<string, () => void>();
  const stops: string[] = [];
  const watcher: ProjectWatcher = {
    watch: vi.fn((projectId: string, onChange: () => void) => {
      changes.set(projectId, onChange);
      return () => stops.push(projectId);
    }),
    closeAll: vi.fn(),
  };
  registerFilesWatchHandlers(registry, isTrusted, watcher);
  const call = (channel: string, payload: unknown, sender: unknown, url = TRUSTED) => {
    const listener = listeners.get(channel);
    if (listener === undefined) throw new Error(`canal ${channel} não registrado`);
    return listener({ senderFrame: { url }, sender } as unknown as IpcMainInvokeEvent, payload);
  };
  return { channels: [...listeners.keys()].sort(), watcher, changes, stops, call };
}

describe('registerFilesWatchHandlers', () => {
  it('registra observar e deixar de observar', () => {
    expect(setup().channels).toEqual([CHANNELS.filesUnwatch, CHANNELS.filesWatch].sort());
  });

  it('observar leva a mudança à janela que pediu, só com o id do projeto', async () => {
    const { call, changes } = setup();
    const window = fakeSender(1);
    expect(await call(CHANNELS.filesWatch, { projectId: 'p1' }, window.sender)).toEqual({
      ok: true,
      data: undefined,
    });
    changes.get('p1')?.();
    expect(window.sent).toEqual([[CHANNELS.filesChanged, { projectId: 'p1' }]]);
  });

  it('remetente de outra origem e entrada fora do contrato não observam nada', async () => {
    const { call, watcher } = setup();
    const window = fakeSender(1);
    expect(
      await call(CHANNELS.filesWatch, { projectId: 'p1' }, window.sender, 'https://x.invalido/'),
    ).toMatchObject({
      ok: false,
      error: { code: 'PERMISSION_DENIED' },
    });
    for (const payload of [undefined, {}, { projectId: '' }, { projectId: 3 }]) {
      expect(await call(CHANNELS.filesWatch, payload, window.sender)).toMatchObject({
        ok: false,
        error: { code: 'VALIDATION_FAILED' },
      });
    }
    expect(watcher.watch).not.toHaveBeenCalled();
  });

  it('deixar de observar solta um pedido por vez; sem pedido aberto, não faz nada', async () => {
    const { call, stops } = setup();
    const window = fakeSender(1);
    await call(CHANNELS.filesWatch, { projectId: 'p1' }, window.sender);
    await call(CHANNELS.filesWatch, { projectId: 'p1' }, window.sender);
    await call(CHANNELS.filesUnwatch, { projectId: 'p1' }, window.sender);
    expect(stops).toEqual(['p1']);
    await call(CHANNELS.filesUnwatch, { projectId: 'p1' }, window.sender);
    await call(CHANNELS.filesUnwatch, { projectId: 'p1' }, window.sender);
    expect(stops).toEqual(['p1', 'p1']);
  });

  it('a janela que fecha solta tudo o que observava, e uma mudança depois não é enviada', async () => {
    const { call, stops, changes } = setup();
    const window = fakeSender(1);
    await call(CHANNELS.filesWatch, { projectId: 'p1' }, window.sender);
    await call(CHANNELS.filesWatch, { projectId: 'p2' }, window.sender);
    window.destroy();
    expect(stops.sort()).toEqual(['p1', 'p2']);
    changes.get('p1')?.();
    expect(window.sent).toEqual([]);
  });
});
