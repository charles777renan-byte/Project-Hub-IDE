import { CHANNELS } from '@project-hub/contracts';
import type { ProfileDeps } from '@project-hub/application';
import type { IpcMainInvokeEvent } from 'electron';
import { describe, expect, it } from 'vitest';
import type { IpcRegistry } from '../src/main/ipc/trusted-handler';
import {
  handleGetProfile,
  handleSetDisplayName,
  registerProfileHandlers,
} from '../src/main/ipc/profile';

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

/** Configurações em memória; `values` deixa conferir o que foi gravado. */
function fakeDeps(initial: Record<string, string> = {}) {
  const values = new Map(Object.entries(initial));
  const deps: ProfileDeps = {
    settings: {
      get: (key) => values.get(key),
      set: (key, value) => {
        values.set(key, value);
      },
      remove: (key) => {
        values.delete(key);
      },
    },
    now: () => '2026-10-25T12:00:00.000Z',
  };
  return { deps, values };
}

describe('profile:get:v1', () => {
  it('devolve o nome gravado, ou nulo quando não há', () => {
    expect(handleGetProfile(fakeDeps().deps)).toEqual({
      ok: true,
      data: { displayName: null },
    });
    expect(handleGetProfile(fakeDeps({ 'perfil.nome': 'Ana' }).deps)).toEqual({
      ok: true,
      data: { displayName: 'Ana' },
    });
  });
});

describe('profile:set-display-name:v1', () => {
  it('aceita nulo e texto, e grava o texto aparado', () => {
    const { deps, values } = fakeDeps();

    expect(handleSetDisplayName(deps, { name: '  Ana  ' })).toEqual({ ok: true, data: undefined });
    expect(values.get('perfil.nome')).toBe('Ana');
    expect(handleSetDisplayName(deps, { name: null })).toEqual({ ok: true, data: undefined });
    expect(values.has('perfil.nome')).toBe(false);
  });

  it('recusa nome com mais de 40 caracteres, com mensagem própria, sem gravar', () => {
    const { deps, values } = fakeDeps();

    expect(handleSetDisplayName(deps, { name: 'a'.repeat(41) })).toMatchObject({
      ok: false,
      error: { code: 'VALIDATION_FAILED', message: 'O nome pode ter até 40 caracteres.' },
    });
    expect(values.size).toBe(0);
  });

  it('recusa entrada fora do formato, sem gravar', () => {
    const { deps, values } = fakeDeps();

    for (const payload of [undefined, {}, 'Ana', 3, { name: 3 }]) {
      expect(handleSetDisplayName(deps, payload)).toMatchObject({
        ok: false,
        error: { code: 'VALIDATION_FAILED', message: 'Informe um nome válido.' },
      });
    }
    expect(values.size).toBe(0);
  });

  it('registra só os dois canais do perfil e recusa remetente de outra origem (R65)', async () => {
    const fake = fakeRegistry();
    const { deps, values } = fakeDeps();
    registerProfileHandlers(fake.registry, isTrusted, deps);

    expect(fake.channels()).toEqual([CHANNELS.profileGet, CHANNELS.profileSetDisplayName]);
    expect(
      await fake.call(CHANNELS.profileSetDisplayName, 'https://site.invalido/', { name: 'Ana' }),
    ).toMatchObject({ ok: false, error: { code: 'PERMISSION_DENIED' } });
    expect(values.size).toBe(0);

    expect(
      await fake.call(CHANNELS.profileSetDisplayName, 'file:///app/index.html', { name: 'Ana' }),
    ).toEqual({ ok: true, data: undefined });
    expect(await fake.call(CHANNELS.profileGet, 'file:///app/index.html')).toEqual({
      ok: true,
      data: { displayName: 'Ana' },
    });
  });
});
