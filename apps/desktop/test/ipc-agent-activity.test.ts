import { CHANNELS } from '@project-hub/contracts';
import type { IpcMainInvokeEvent } from 'electron';
import { describe, expect, it, vi } from 'vitest';
import {
  handleAgentActivity,
  registerAgentActivityHandlers,
  type AgentActivityIpcDeps,
} from '../src/main/ipc/agent-activity';
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
    channels: () => [...listeners.keys()],
    call(channel: string, senderUrl: string, payload?: unknown) {
      const listener = listeners.get(channel);
      if (listener === undefined) throw new Error(`canal ${channel} não registrado`);
      const event = { senderFrame: { url: senderUrl } } as unknown as IpcMainInvokeEvent;
      return listener(event, payload);
    },
  };
}

const RESPONSE = {
  agents: [{ id: 'claude', label: 'Claude Code', messagesAvailable: true, tokensAvailable: true }],
  days: [{ date: '2026-11-01', agent: 'claude', messages: 3, tokens: 1200 }],
  since: '2026-10-22',
};

function depsWith(response: unknown): AgentActivityIpcDeps & { read: ReturnType<typeof vi.fn> } {
  return { read: vi.fn(() => Promise.resolve(response)) } as never;
}

describe('activity:agents:v1', () => {
  it('aceita entrada vazia e devolve a resposta conferida', async () => {
    const deps = depsWith(RESPONSE);

    for (const payload of [undefined, {}]) {
      expect(await handleAgentActivity(deps, payload)).toEqual({ ok: true, data: RESPONSE });
    }
    expect(deps.read).toHaveBeenCalledTimes(2);
  });

  it('recusa qualquer parâmetro sem ler arquivo', async () => {
    const deps = depsWith(RESPONSE);

    for (const payload of [{ dias: 7 }, 'texto', 7, null, []]) {
      expect(await handleAgentActivity(deps, payload)).toMatchObject({
        ok: false,
        error: { code: 'VALIDATION_FAILED' },
      });
    }
    expect(deps.read).not.toHaveBeenCalled();
  });

  it('não deixa sair uma resposta fora do contrato', async () => {
    const deps = depsWith({
      ...RESPONSE,
      days: [{ date: '1/11/2026', agent: 'claude', messages: -1, tokens: 1.5 }],
    });

    await expect(handleAgentActivity(deps, undefined)).rejects.toThrow();
  });

  it('registra só o canal de leitura; resposta fora do contrato vira UNKNOWN; outra origem é recusada (R65)', async () => {
    const fake = fakeRegistry();
    const deps = depsWith({ agents: 'nada' });
    registerAgentActivityHandlers(fake.registry, isTrusted, deps);
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    try {
      expect(fake.channels()).toEqual([CHANNELS.activityAgents]);
      expect(await fake.call(CHANNELS.activityAgents, 'https://site.invalido/')).toMatchObject({
        ok: false,
        error: { code: 'PERMISSION_DENIED' },
      });
      expect(deps.read).not.toHaveBeenCalled();
      expect(await fake.call(CHANNELS.activityAgents, 'file:///app/index.html')).toMatchObject({
        ok: false,
        error: { code: 'UNKNOWN' },
      });
      expect(
        await fake.call(CHANNELS.activityAgents, 'file:///app/index.html', { dias: 7 }),
      ).toMatchObject({
        ok: false,
        error: { code: 'VALIDATION_FAILED' },
      });
    } finally {
      error.mockRestore();
    }
  });
});
