import { CHANNELS, type EnvironmentDto, type SystemUsageDto } from '@project-hub/contracts';
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
const ENVIRONMENT: EnvironmentDto = {
  git: { installed: true, version: 'git version 2.47.0' },
  worktreesRoot: 'C:\\dados\\worktrees',
};
const environment = () => Promise.resolve(ENVIRONMENT);

describe('system:usage:v1', () => {
  it('registra os canais do uso do computador e do ambiente, e devolve a leitura', async () => {
    const fake = fakeRegistry();
    registerSystemHandlers(fake.registry, isTrusted, () => USAGE, environment);

    expect(fake.channels()).toEqual([CHANNELS.systemUsage, CHANNELS.systemEnvironment]);
    expect(await fake.call(CHANNELS.systemUsage, 'file:///app/index.html')).toEqual({
      ok: true,
      data: USAGE,
    });
  });

  it('recusa remetente de outra origem sem ler o sistema (R65)', async () => {
    const fake = fakeRegistry();
    const sample = vi.fn(() => USAGE);
    registerSystemHandlers(fake.registry, isTrusted, sample, environment);

    expect(await fake.call(CHANNELS.systemUsage, 'https://site.invalido/')).toMatchObject({
      ok: false,
      error: { code: 'PERMISSION_DENIED' },
    });
    expect(sample).not.toHaveBeenCalled();
  });
});

describe('system:environment:v1', () => {
  it('devolve a conferência do ambiente', async () => {
    const fake = fakeRegistry();
    registerSystemHandlers(fake.registry, isTrusted, () => USAGE, environment);

    expect(await fake.call(CHANNELS.systemEnvironment, 'file:///app/index.html')).toEqual({
      ok: true,
      data: ENVIRONMENT,
    });
  });

  it('recusa remetente de outra origem sem rodar a conferência (R65)', async () => {
    const fake = fakeRegistry();
    const check = vi.fn(environment);
    registerSystemHandlers(fake.registry, isTrusted, () => USAGE, check);

    expect(await fake.call(CHANNELS.systemEnvironment, 'https://site.invalido/')).toMatchObject({
      ok: false,
      error: { code: 'PERMISSION_DENIED' },
    });
    expect(check).not.toHaveBeenCalled();
  });

  it('a conferência que estoura devolve a falha genérica, sem o texto do erro', async () => {
    const fake = fakeRegistry();
    registerSystemHandlers(
      fake.registry,
      isTrusted,
      () => USAGE,
      () => Promise.reject(new Error('C:\\Users\\alguem\\segredo')),
    );

    const result = await fake.call(CHANNELS.systemEnvironment, 'file:///app/index.html');

    expect(result).toMatchObject({ ok: false });
    expect(JSON.stringify(result)).not.toContain('segredo');
  });
});
