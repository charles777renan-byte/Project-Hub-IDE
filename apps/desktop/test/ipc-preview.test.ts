import { CHANNELS, type PreviewStateDto } from '@project-hub/contracts';
import type { IpcMainInvokeEvent } from 'electron';
import { describe, expect, it, vi } from 'vitest';
import { registerPreviewHandlers } from '../src/main/ipc/preview';
import type { IpcRegistry } from '../src/main/ipc/trusted-handler';
import type { PreviewService } from '../src/main/preview/preview-service';

const TRUSTED = 'file:///app/index.html';
const isTrusted = (event: IpcMainInvokeEvent) => event.senderFrame?.url === TRUSTED;

const STATE: PreviewStateDto = {
  projectId: 'p1',
  detection: { kind: 'none', packageManager: 'npm', scripts: [], suggested: null },
  approval: { kind: 'none' },
  status: 'idle',
  url: null,
  terminalId: null,
};
const OK_STATE = { ok: true as const, data: STATE };

function setup() {
  const listeners = new Map<string, (event: IpcMainInvokeEvent, payload?: unknown) => unknown>();
  const registry: IpcRegistry = {
    handle(channel, listener) {
      listeners.set(channel, listener);
    },
  };
  const preview = {
    state: vi.fn(() => Promise.resolve(OK_STATE)),
    approve: vi.fn(() => Promise.resolve(OK_STATE)),
    setAddress: vi.fn(() => Promise.resolve(OK_STATE)),
    start: vi.fn(() => Promise.resolve(OK_STATE)),
    forget: vi.fn(() => Promise.resolve(OK_STATE)),
    forgetProject: vi.fn(() => Promise.resolve()),
    dispose: vi.fn(() => Promise.resolve()),
  } satisfies PreviewService;
  registerPreviewHandlers(registry, isTrusted, { preview });
  return {
    preview,
    channels: () => [...listeners.keys()].sort(),
    call(channel: string, payload?: unknown, senderUrl = TRUSTED) {
      const listener = listeners.get(channel);
      if (listener === undefined) throw new Error(`canal ${channel} não registrado`);
      const event = { senderFrame: { url: senderUrl } } as unknown as IpcMainInvokeEvent;
      return listener(event, payload);
    },
  };
}

/** Um pedido válido por canal. */
const VALID: Record<string, unknown> = {
  [CHANNELS.previewState]: { projectId: 'p1' },
  [CHANNELS.previewApprove]: { projectId: 'p1', script: 'dev', shownBody: 'vite' },
  [CHANNELS.previewSetAddress]: { projectId: 'p1', text: 'localhost:3000' },
  [CHANNELS.previewStart]: { projectId: 'p1', tabId: 't1' },
  [CHANNELS.previewForget]: { projectId: 'p1' },
};

describe('registerPreviewHandlers', () => {
  it('registra os 5 canais de pedido do preview', () => {
    expect(setup().channels()).toEqual(Object.keys(VALID).sort());
  });

  it.each(Object.entries(VALID))(
    '%s recusa remetente de outra origem',
    async (channel, payload) => {
      const ipc = setup();
      const result = await ipc.call(channel, payload, 'http://localhost:5173/');
      expect(result).toMatchObject({ ok: false, error: { code: 'PERMISSION_DENIED' } });
      for (const spy of Object.values(ipc.preview)) expect(spy).not.toHaveBeenCalled();
    },
  );

  it.each(Object.keys(VALID))(
    '%s recusa entrada inválida sem chamar o serviço',
    async (channel) => {
      const ipc = setup();
      for (const payload of [undefined, null, 'p1', {}, { projectId: '' }, { projectId: 7 }]) {
        expect(await ipc.call(channel, payload)).toMatchObject({
          ok: false,
          error: { code: 'VALIDATION_FAILED' },
        });
      }
      for (const spy of Object.values(ipc.preview)) expect(spy).not.toHaveBeenCalled();
    },
  );

  it.each([
    ['nome de script com comando', { projectId: 'p1', script: 'dev; calc', shownBody: 'vite' }],
    ['nome de script com espaço', { projectId: 'p1', script: 'dev build', shownBody: 'vite' }],
    ['nome de script vazio', { projectId: 'p1', script: '', shownBody: 'vite' }],
    [
      'texto mostrado grande demais',
      { projectId: 'p1', script: 'dev', shownBody: 'x'.repeat(201) },
    ],
    ['sem o texto mostrado', { projectId: 'p1', script: 'dev' }],
  ])('aprovar recusa %s', async (_label, payload) => {
    const ipc = setup();
    expect(await ipc.call(CHANNELS.previewApprove, payload)).toMatchObject({
      ok: false,
      error: { code: 'VALIDATION_FAILED' },
    });
    expect(ipc.preview.approve).not.toHaveBeenCalled();
  });

  it.each([
    ['sem a aba', { projectId: 'p1' }],
    ['com a aba vazia', { projectId: 'p1', tabId: '' }],
    ['com "restart" que não é booleano', { projectId: 'p1', tabId: 't1', restart: 'sim' }],
  ])('iniciar recusa pedido %s', async (_label, payload) => {
    const ipc = setup();
    expect(await ipc.call(CHANNELS.previewStart, payload)).toMatchObject({
      ok: false,
      error: { code: 'VALIDATION_FAILED' },
    });
    expect(ipc.preview.start).not.toHaveBeenCalled();
  });

  it('endereço vazio ou grande demais é recusado', async () => {
    const ipc = setup();
    for (const text of ['', 'x'.repeat(5000)]) {
      expect(await ipc.call(CHANNELS.previewSetAddress, { projectId: 'p1', text })).toMatchObject({
        ok: false,
        error: { code: 'VALIDATION_FAILED' },
      });
    }
    expect(ipc.preview.setAddress).not.toHaveBeenCalled();
  });

  it('cada canal chama o método certo, com os argumentos certos, e devolve o estado', async () => {
    const ipc = setup();

    expect(await ipc.call(CHANNELS.previewState, VALID[CHANNELS.previewState])).toEqual(OK_STATE);
    expect(ipc.preview.state).toHaveBeenCalledWith('p1');

    expect(await ipc.call(CHANNELS.previewApprove, VALID[CHANNELS.previewApprove])).toEqual(
      OK_STATE,
    );
    expect(ipc.preview.approve).toHaveBeenCalledWith('p1', 'dev', 'vite');

    await ipc.call(CHANNELS.previewSetAddress, VALID[CHANNELS.previewSetAddress]);
    expect(ipc.preview.setAddress).toHaveBeenCalledWith('p1', 'localhost:3000');

    await ipc.call(CHANNELS.previewStart, VALID[CHANNELS.previewStart]);
    expect(ipc.preview.start).toHaveBeenLastCalledWith('p1', 't1', { restart: false });

    await ipc.call(CHANNELS.previewStart, { projectId: 'p1', tabId: 't1', restart: true });
    expect(ipc.preview.start).toHaveBeenLastCalledWith('p1', 't1', { restart: true });

    await ipc.call(CHANNELS.previewForget, VALID[CHANNELS.previewForget]);
    expect(ipc.preview.forget).toHaveBeenCalledWith('p1');
  });

  it('nenhum canal leva texto de comando ao serviço: campos a mais são descartados', async () => {
    const ipc = setup();
    const extra = { command: 'calc.exe', startCommand: 'calc.exe', body: 'calc.exe' };

    await ipc.call(CHANNELS.previewApprove, {
      ...extra,
      projectId: 'p1',
      script: 'dev',
      shownBody: 'vite',
    });
    await ipc.call(CHANNELS.previewStart, { ...extra, projectId: 'p1', tabId: 't1' });
    await ipc.call(CHANNELS.previewState, { ...extra, projectId: 'p1' });

    for (const spy of Object.values(ipc.preview)) {
      for (const call of spy.mock.calls) expect(JSON.stringify(call)).not.toContain('calc.exe');
    }
  });
});
