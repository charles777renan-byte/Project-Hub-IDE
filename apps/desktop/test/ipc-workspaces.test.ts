import { CHANNELS, type LayoutNode, type ProviderInfo } from '@project-hub/contracts';
import type { IpcMainInvokeEvent } from 'electron';
import { describe, expect, it, vi } from 'vitest';
import { registerWorkspaceHandlers } from '../src/main/ipc/workspaces';
import type { IpcRegistry } from '../src/main/ipc/trusted-handler';
import type { WorkspaceService } from '../src/main/workspaces';

const TRUSTED = 'file:///app/index.html';
const UNTRUSTED = 'https://site.invalido/';

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

const layout: LayoutNode = {
  type: 'split',
  id: 's1',
  direction: 'row',
  ratio: 0.5,
  first: { type: 'leaf', id: 'l1', provider: 'claude', terminalId: null },
  second: { type: 'leaf', id: 'l2', provider: 'shell', terminalId: 't1' },
};

const dto = {
  id: 'w1',
  projectId: 'p1',
  layout,
  position: 0,
  lastActiveAt: '2026-10-22T10:00:00.000Z',
};

const PROVIDERS: ProviderInfo[] = [
  { id: 'claude', label: 'Claude Code', available: true },
  { id: 'codex', label: 'Codex', available: false, reason: 'Codex não foi encontrado no PATH.' },
];

function setup() {
  const ok = { ok: true as const, data: undefined };
  const service: WorkspaceService = {
    list: vi.fn(() => Promise.resolve({ ok: true as const, data: [dto] })),
    open: vi.fn(() => Promise.resolve({ ok: true as const, data: dto })),
    close: vi.fn(() => Promise.resolve(ok)),
    saveLayout: vi.fn(() => Promise.resolve(ok)),
    startSession: vi.fn(() => Promise.resolve({ ok: true as const, data: dto })),
    endSession: vi.fn(() => Promise.resolve({ ok: true as const, data: dto })),
    addPane: vi.fn(() => Promise.resolve({ ok: true as const, data: dto })),
    removePane: vi.fn(() => Promise.resolve({ ok: true as const, data: dto })),
  };
  const providers = { list: vi.fn(() => PROVIDERS) };
  const fake = fakeRegistry();
  registerWorkspaceHandlers(fake.registry, isTrusted, service, providers);
  return { fake, service, providers };
}

const CALLS: [string, unknown, keyof WorkspaceService][] = [
  [CHANNELS.workspacesList, undefined, 'list'],
  [CHANNELS.workspacesOpen, { projectId: 'p1' }, 'open'],
  [CHANNELS.workspacesClose, { workspaceId: 'w1' }, 'close'],
  [CHANNELS.workspacesSaveLayout, { workspaceId: 'w1', layout }, 'saveLayout'],
  [CHANNELS.workspacesStartSession, { workspaceId: 'w1', leafId: 'l1' }, 'startSession'],
  [CHANNELS.workspacesEndSession, { workspaceId: 'w1', leafId: 'l1' }, 'endSession'],
  [CHANNELS.workspacesAddPane, { workspaceId: 'w1', provider: 'shell' }, 'addPane'],
  [CHANNELS.workspacesRemovePane, { workspaceId: 'w1', leafId: 'l1' }, 'removePane'],
];

describe('canais de workspaces e provedores', () => {
  it('todos os canais recusam remetente de outra origem, sem rodar o serviço', async () => {
    const { fake, service, providers } = setup();
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      for (const [channel, payload] of [
        ...CALLS,
        [CHANNELS.providersList, undefined, 'list'] as const,
      ]) {
        expect(await fake.call(channel, UNTRUSTED, payload)).toMatchObject({
          ok: false,
          error: { code: 'PERMISSION_DENIED' },
        });
      }
      for (const method of Object.values(service)) expect(method).not.toHaveBeenCalled();
      expect(providers.list).not.toHaveBeenCalled();
    } finally {
      error.mockRestore();
    }
  });

  it('list não leva entrada: ignora qualquer payload', async () => {
    const { fake, service } = setup();

    const result = await fake.call(CHANNELS.workspacesList, TRUSTED, { projectId: 'x', lixo: 1 });

    expect(result).toEqual({ ok: true, data: [dto] });
    expect(service.list).toHaveBeenCalledWith();
  });

  it('chama o serviço com os campos validados', async () => {
    const { fake, service } = setup();

    await fake.call(CHANNELS.workspacesOpen, TRUSTED, { projectId: 'p1', extra: 'ignorado' });
    await fake.call(CHANNELS.workspacesClose, TRUSTED, { workspaceId: 'w1' });
    await fake.call(CHANNELS.workspacesSaveLayout, TRUSTED, { workspaceId: 'w1', layout });
    await fake.call(CHANNELS.workspacesStartSession, TRUSTED, { workspaceId: 'w1', leafId: 'l1' });
    await fake.call(CHANNELS.workspacesEndSession, TRUSTED, { workspaceId: 'w1', leafId: 'l2' });
    await fake.call(CHANNELS.workspacesAddPane, TRUSTED, {
      workspaceId: 'w1',
      provider: 'codex',
      extra: 'ignorado',
    });
    await fake.call(CHANNELS.workspacesRemovePane, TRUSTED, { workspaceId: 'w1', leafId: 'l3' });
    await fake.call(CHANNELS.workspacesSaveLayout, TRUSTED, { workspaceId: 'w1', layout: null });

    expect(service.open).toHaveBeenCalledWith('p1');
    expect(service.close).toHaveBeenCalledWith('w1');
    expect(service.saveLayout).toHaveBeenCalledWith('w1', layout);
    expect(service.startSession).toHaveBeenCalledWith('w1', 'l1');
    expect(service.endSession).toHaveBeenCalledWith('w1', 'l2');
    expect(service.addPane).toHaveBeenCalledWith('w1', 'codex');
    expect(service.removePane).toHaveBeenCalledWith('w1', 'l3');
    expect(service.saveLayout).toHaveBeenCalledWith('w1', null);
  });

  it.each([
    [CHANNELS.workspacesOpen, undefined, 'Informe o projeto.'],
    [CHANNELS.workspacesOpen, { projectId: '' }, 'Informe o projeto.'],
    [CHANNELS.workspacesOpen, { projectId: 7 }, 'Informe o projeto.'],
    [CHANNELS.workspacesClose, {}, 'Informe o workspace.'],
    [CHANNELS.workspacesClose, 'w1', 'Informe o workspace.'],
    [CHANNELS.workspacesStartSession, { workspaceId: 'w1' }, 'Informe o painel.'],
    [CHANNELS.workspacesStartSession, { leafId: 'l1' }, 'Informe o painel.'],
    [CHANNELS.workspacesEndSession, { workspaceId: 'w1', leafId: '' }, 'Informe o painel.'],
    [CHANNELS.workspacesAddPane, { workspaceId: 'w1' }, 'Informe o workspace e o programa.'],
    [
      CHANNELS.workspacesAddPane,
      { workspaceId: 'w1', provider: 'bash' },
      'Informe o workspace e o programa.',
    ],
    [CHANNELS.workspacesAddPane, { provider: 'shell' }, 'Informe o workspace e o programa.'],
    [CHANNELS.workspacesRemovePane, { workspaceId: 'w1' }, 'Informe o painel.'],
    [CHANNELS.workspacesRemovePane, { workspaceId: 'w1', leafId: '' }, 'Informe o painel.'],
    [CHANNELS.workspacesSaveLayout, { workspaceId: 'w1' }, 'O layout não é válido.'],
    [CHANNELS.workspacesSaveLayout, { layout }, 'O layout não é válido.'],
    [
      CHANNELS.workspacesSaveLayout,
      { workspaceId: 'w1', layout: { ...layout, ratio: 2 } },
      'O layout não é válido.',
    ],
    [
      CHANNELS.workspacesSaveLayout,
      { workspaceId: 'w1', layout: { type: 'leaf', id: 'x', provider: 'bash', terminalId: null } },
      'O layout não é válido.',
    ],
  ])(
    'entrada inválida em %s devolve VALIDATION_FAILED, sem chamar o serviço',
    async (channel, payload, message) => {
      const { fake, service } = setup();

      const result = await fake.call(channel, TRUSTED, payload);

      expect(result).toMatchObject({ ok: false, error: { code: 'VALIDATION_FAILED', message } });
      for (const method of Object.values(service)) expect(method).not.toHaveBeenCalled();
    },
  );

  it('saveLayout com milhares de níveis devolve VALIDATION_FAILED em vez de lançar', async () => {
    const { fake, service } = setup();
    let deep: unknown = { type: 'leaf', id: 'fundo', provider: 'shell', terminalId: null };
    for (let n = 0; n < 5000; n += 1) {
      deep = {
        type: 'split',
        id: `s${n}`,
        direction: 'row',
        first: deep,
        second: { type: 'leaf', id: `f${n}`, provider: 'shell', terminalId: null },
        ratio: 0.5,
      };
    }

    const result = await fake.call(CHANNELS.workspacesSaveLayout, TRUSTED, {
      workspaceId: 'w1',
      layout: deep,
    });

    expect(result).toMatchObject({
      ok: false,
      error: { code: 'VALIDATION_FAILED', message: 'O layout não é válido.' },
    });
    expect(service.saveLayout).not.toHaveBeenCalled();
  });

  it('devolve o que o serviço responde, inclusive as falhas', async () => {
    const { fake, service } = setup();
    const failed = {
      ok: false as const,
      error: { code: 'PROCESS_START_FAILED' as const, message: 'x', retryable: false },
    };
    vi.mocked(service.startSession).mockResolvedValueOnce(failed);

    expect(
      await fake.call(CHANNELS.workspacesStartSession, TRUSTED, {
        workspaceId: 'w1',
        leafId: 'l1',
      }),
    ).toEqual(failed);
  });

  it('providers:list devolve a lista do registro', async () => {
    const { fake, providers } = setup();

    const result = await fake.call(CHANNELS.providersList, TRUSTED);

    expect(result).toEqual({ ok: true, data: PROVIDERS });
    expect(providers.list).toHaveBeenCalledTimes(1);
  });
});
