import { CHANNELS } from '@project-hub/contracts';
import type { IpcMainInvokeEvent } from 'electron';
import { describe, expect, it, vi } from 'vitest';
import type { ListWorktreesDeps, RemoveWorktreeDeps } from '@project-hub/application';
import type { IpcRegistry } from '../src/main/ipc/trusted-handler';
import {
  handleListWorktrees,
  handleRemoveWorktree,
  registerWorktreeHandlers,
} from '../src/main/ipc/worktrees';

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
    call(channel: string, senderUrl: string, payload?: unknown) {
      const listener = listeners.get(channel);
      if (listener === undefined) throw new Error(`canal ${channel} não registrado`);
      const event = { senderFrame: { url: senderUrl } } as unknown as IpcMainInvokeEvent;
      return listener(event, payload);
    },
  };
}

describe('worktrees:list:v1', () => {
  it('recusa a entrada fora do contrato sem consultar a aplicação', async () => {
    const listMissions = vi.fn();
    const deps = {
      repo: { listMissions },
      projects: { get: vi.fn() },
    } as unknown as ListWorktreesDeps;

    for (const payload of [undefined, {}, { projectId: '' }, { projectId: 3 }, 'texto']) {
      expect(await handleListWorktrees(deps, payload)).toMatchObject({
        ok: false,
        error: { code: 'VALIDATION_FAILED' },
      });
    }
    expect(listMissions).not.toHaveBeenCalled();
  });
});

describe('worktrees:remove:v1', () => {
  it('recusa a entrada fora do contrato sem consultar a aplicação', async () => {
    const getMission = vi.fn();
    const deps = { repo: { getMission } } as unknown as RemoveWorktreeDeps;

    for (const payload of [undefined, {}, { missionId: '' }, { worktreePath: 'C:\\x' }]) {
      expect(await handleRemoveWorktree(deps, payload)).toMatchObject({
        ok: false,
        error: { code: 'VALIDATION_FAILED' },
      });
    }
    expect(getMission).not.toHaveBeenCalled();
  });

  it('só o id da missão decide o caminho: o que o renderer manda além dele é ignorado', async () => {
    const remove = vi.fn(() => Promise.resolve());
    const deps = {
      repo: {
        getMission: () => ({
          id: 'm1',
          projectId: 'p1',
          status: 'succeeded',
          worktreePath: 'C:\\worktrees\\app\\m1',
        }),
        appendAudit: vi.fn(),
      },
      projects: { get: () => ({ id: 'p1', path: 'C:\\Projetos\\app' }) },
      worktrees: { remove },
      fs: { isDirectory: () => Promise.resolve(true) },
      diff: { diff: vi.fn() },
      now: () => '2026-10-21T09:00:00.000Z',
    } as unknown as RemoveWorktreeDeps;

    const result = await handleRemoveWorktree(deps, {
      missionId: 'm1',
      worktreePath: 'C:\\Windows',
    });

    expect(result).toEqual({ ok: true, data: undefined });
    expect(remove).toHaveBeenCalledWith({
      repoPath: 'C:\\Projetos\\app',
      worktreePath: 'C:\\worktrees\\app\\m1',
    });
  });
});

describe('registerWorktreeHandlers', () => {
  it('registra os dois canais e recusa remetente de outra origem (R65)', async () => {
    const fake = fakeRegistry();
    const getMission = vi.fn();
    const listMissions = vi.fn();
    registerWorktreeHandlers(fake.registry, isTrusted, {
      list: { repo: { listMissions }, projects: {}, fs: {} } as unknown as ListWorktreesDeps,
      remove: { repo: { getMission } } as unknown as RemoveWorktreeDeps,
    });
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    try {
      expect(fake.channels()).toEqual([CHANNELS.worktreesList, CHANNELS.worktreesRemove].sort());
      const refusedList = await fake.call(CHANNELS.worktreesList, 'https://site.invalido/', {
        projectId: 'p1',
      });
      const refusedRemove = await fake.call(CHANNELS.worktreesRemove, 'https://site.invalido/', {
        missionId: 'm1',
      });

      expect(refusedList).toMatchObject({ ok: false, error: { code: 'PERMISSION_DENIED' } });
      expect(refusedRemove).toMatchObject({ ok: false, error: { code: 'PERMISSION_DENIED' } });
      expect(listMissions).not.toHaveBeenCalled();
      expect(getMission).not.toHaveBeenCalled();
    } finally {
      error.mockRestore();
    }
  });
});
