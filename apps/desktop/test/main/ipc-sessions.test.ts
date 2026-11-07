import { CHANNELS, type SessionsListResult } from '@project-hub/contracts';
import type { IpcMainInvokeEvent } from 'electron';
import { describe, expect, it, vi } from 'vitest';
import { buildProjectHubApi } from '../../src/preload/api';
import { registerSessionHandlers } from '../../src/main/ipc/sessions';
import type { IpcRegistry } from '../../src/main/ipc/trusted-handler';

const TRUSTED = 'file:///app/index.html';
const UNTRUSTED = 'https://site.invalido/';
const SESSION = '5f0c2a7e-8d1b-4c3a-9e2f-1a2b3c4d5e6f';

const isTrusted = (event: IpcMainInvokeEvent) => event.senderFrame?.url === TRUSTED;

/** Registro do `ipcMain` de imitação: guarda os ouvintes por canal, para chamá-los nos testes. */
function fakeRegistry() {
  const listeners = new Map<string, (event: IpcMainInvokeEvent, payload?: unknown) => unknown>();
  const registry: IpcRegistry = {
    handle(channel, listener) {
      listeners.set(channel, listener);
    },
  };
  return {
    registry,
    call(channel: string, senderUrl: string, payload?: unknown) {
      const listener = listeners.get(channel);
      if (listener === undefined) throw new Error(`canal ${channel} não registrado`);
      const event = { senderFrame: { url: senderUrl } } as unknown as IpcMainInvokeEvent;
      return listener(event, payload);
    },
  };
}

const LIST: SessionsListResult = { sessions: [], indexing: [] };
const DTO = {
  id: 'w1',
  projectId: 'p1',
  layout: null,
  position: 0,
  lastActiveAt: '2026-11-07T10:00:00.000Z',
};

function setup(options: { listFails?: boolean } = {}) {
  const history = {
    list: vi.fn(() =>
      options.listFails === true ? Promise.reject(new Error('disco cheio')) : Promise.resolve(LIST),
    ),
  };
  const workspaces = {
    resumeSession: vi.fn(() => Promise.resolve({ ok: true as const, data: DTO })),
  };
  const fake = fakeRegistry();
  registerSessionHandlers(fake.registry, isTrusted, history, workspaces);
  return { fake, history, workspaces };
}

describe('canais de sessões', () => {
  it('os dois canais recusam remetente de outra origem, sem rodar nada', async () => {
    const { fake, history, workspaces } = setup();
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      expect(await fake.call(CHANNELS.sessionsList, UNTRUSTED, { scope: 'all' })).toMatchObject({
        ok: false,
        error: { code: 'PERMISSION_DENIED' },
      });
      expect(
        await fake.call(CHANNELS.sessionsResume, UNTRUSTED, {
          workspaceId: 'w1',
          sessionId: SESSION,
        }),
      ).toMatchObject({ ok: false, error: { code: 'PERMISSION_DENIED' } });
    } finally {
      error.mockRestore();
    }
    expect(history.list).not.toHaveBeenCalled();
    expect(workspaces.resumeSession).not.toHaveBeenCalled();
  });

  it('lista com escopo válido responde com o resultado embrulhado em AppResult', async () => {
    const { fake, history } = setup();

    expect(await fake.call(CHANNELS.sessionsList, TRUSTED, { scope: 'all' })).toEqual({
      ok: true,
      data: LIST,
    });
    expect(history.list).toHaveBeenCalledWith({ scope: 'all' });
  });

  it('escopo de projeto sem projeto é recusado antes de ler o histórico', async () => {
    const { fake, history } = setup();

    expect(await fake.call(CHANNELS.sessionsList, TRUSTED, { scope: 'workspace' })).toMatchObject({
      ok: false,
      error: { code: 'VALIDATION_FAILED' },
    });
    expect(history.list).not.toHaveBeenCalled();
  });

  it('falha inesperada da lista vira UNKNOWN, sem derrubar o processo', async () => {
    const { fake } = setup({ listFails: true });
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      expect(await fake.call(CHANNELS.sessionsList, TRUSTED, { scope: 'all' })).toMatchObject({
        ok: false,
        error: { code: 'UNKNOWN' },
      });
    } finally {
      error.mockRestore();
    }
  });

  it('retomada com id fora do formato é recusada antes de chegar ao serviço', async () => {
    const { fake, workspaces } = setup();

    expect(
      await fake.call(CHANNELS.sessionsResume, TRUSTED, {
        workspaceId: 'w1',
        sessionId: 'nao-e-uuid',
      }),
    ).toMatchObject({ ok: false, error: { code: 'VALIDATION_FAILED' } });
    expect(workspaces.resumeSession).not.toHaveBeenCalled();
  });

  it('retomada só passa o workspace e o id; caminho ou comando no pedido não chegam ao serviço', async () => {
    const { fake, workspaces } = setup();

    expect(
      await fake.call(CHANNELS.sessionsResume, TRUSTED, {
        workspaceId: 'w1',
        sessionId: SESSION,
        folder: 'C:/Windows',
        command: 'cmd.exe',
      }),
    ).toEqual({ ok: true, data: DTO });
    expect(workspaces.resumeSession).toHaveBeenCalledWith('w1', SESSION);
  });
});

describe('API do preload para sessões', () => {
  const noEvents = () => () => undefined;

  it('sessions.list e sessions.resume chamam os próprios canais, levando o pedido', async () => {
    const calls: Array<[string, unknown]> = [];
    const api = buildProjectHubApi(async (channel, payload) => {
      calls.push([channel, payload]);
      return { ok: true, data: channel === CHANNELS.sessionsList ? LIST : DTO };
    }, noEvents);

    await api.sessions.list({ scope: 'project', projectId: 'p1' });
    await api.sessions.resume({ workspaceId: 'w1', sessionId: SESSION });

    expect(calls).toEqual([
      [CHANNELS.sessionsList, { scope: 'project', projectId: 'p1' }],
      [CHANNELS.sessionsResume, { workspaceId: 'w1', sessionId: SESSION }],
    ]);
  });

  it('resposta de sessions.list fora do contrato vira VALIDATION_FAILED e não chega ao renderer', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    try {
      const api = buildProjectHubApi(
        () => Promise.resolve({ ok: true, data: { sessions: 'nao-e-uma-lista', indexing: [] } }),
        noEvents,
      );

      expect(await api.sessions.list({ scope: 'all' })).toMatchObject({
        ok: false,
        error: { code: 'VALIDATION_FAILED' },
      });
    } finally {
      warn.mockRestore();
    }
  });
});
