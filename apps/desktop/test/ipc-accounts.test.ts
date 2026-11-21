import { CHANNELS, type LoginDto } from '@project-hub/contracts';
import type { IpcMainInvokeEvent } from 'electron';
import { describe, expect, it } from 'vitest';
import type { AccountsService } from '../src/main/accounts/accounts-service';
import type { LoginService } from '../src/main/accounts/login-service';
import { registerAccountsHandlers, registerAppHandlers } from '../src/main/ipc/accounts';
import type { IpcRegistry } from '../src/main/ipc/trusted-handler';

const APP = 'file:///app/index.html';
const A = '11111111-1111-4111-8111-111111111111';
const isTrusted = (event: IpcMainInvokeEvent) => event.senderFrame?.url === APP;

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
    call(channel: string, payload?: unknown, senderUrl = APP) {
      const listener = listeners.get(channel);
      if (listener === undefined) throw new Error(`canal ${channel} não registrado`);
      const event = { senderFrame: { url: senderUrl } } as unknown as IpcMainInvokeEvent;
      return listener(event, payload);
    },
  };
}

const LOGIN: LoginDto = {
  provider: 'claude',
  accountId: A,
  phase: 'browser',
  expiresAt: '2026-11-21T12:10:00.000Z',
};
const DONE = { ok: true as const, data: undefined };

function setup() {
  const calls: [string, unknown?][] = [];
  const note =
    <T>(name: string, result: T) =>
    (input?: unknown) => {
      calls.push(input === undefined ? [name] : [name, input]);
      return Promise.resolve(result);
    };
  const accounts: AccountsService = {
    list: note('list', { ok: true as const, data: { groups: [], others: [] } }),
    add: note('add', {
      ok: true as const,
      data: {
        id: A,
        provider: 'claude' as const,
        name: 'Trabalho',
        isPrincipal: false,
        isDefault: false,
        state: 'signed-out' as const,
      },
    }),
    rename: note('rename', DONE),
    setDefault: note('setDefault', DONE),
    disconnect: note('disconnect', DONE),
    remove: note('remove', DONE),
  };
  const login: LoginService = {
    start: note('login.start', { ok: true as const, data: LOGIN }),
    get: () => LOGIN,
    cancel: note('login.cancel', undefined),
    confirm: note('login.confirm', undefined),
    reject: note('login.reject', undefined),
    openUrl: note('login.openUrl', DONE),
    copyUrl: note('login.copyUrl', DONE),
    write: note('login.write', undefined),
    resize: (cols, rows) => {
      calls.push(['login.resize', [cols, rows]]);
      return Promise.resolve();
    },
    recover: () => Promise.resolve(),
    dispose: () => Promise.resolve(),
  };
  const fake = fakeRegistry();
  registerAccountsHandlers(fake.registry, isTrusted, { accounts, login });
  return { fake, calls };
}

describe('canais das contas', () => {
  it('registra os canais das contas e do login, sem o canal de evento', () => {
    const { fake } = setup();
    expect(fake.channels().sort()).toEqual(
      [
        CHANNELS.accountsList,
        CHANNELS.accountsAdd,
        CHANNELS.accountsRename,
        CHANNELS.accountsSetDefault,
        CHANNELS.accountsDisconnect,
        CHANNELS.accountsRemove,
        CHANNELS.accountsLoginStart,
        CHANNELS.accountsLoginGet,
        CHANNELS.accountsLoginCancel,
        CHANNELS.accountsLoginConfirm,
        CHANNELS.accountsLoginReject,
        CHANNELS.accountsLoginOpenUrl,
        CHANNELS.accountsLoginCopyUrl,
        CHANNELS.accountsLoginWrite,
        CHANNELS.accountsLoginResize,
      ].sort(),
    );
  });

  it('add repassa programa e nome ao serviço', async () => {
    const { fake, calls } = setup();
    const result = await fake.call(CHANNELS.accountsAdd, { provider: 'claude', name: ' Trabalho ' });
    expect(result).toMatchObject({ ok: true });
    expect(calls).toEqual([['add', { provider: 'claude', name: 'Trabalho' }]]);
  });

  it('add recusa entrada com campo a mais sem chamar o serviço', async () => {
    const { fake, calls } = setup();
    const result = await fake.call(CHANNELS.accountsAdd, {
      provider: 'claude',
      name: 'Trabalho',
      folder: 'C:\\Users',
    });
    expect(result).toMatchObject({ ok: false, error: { code: 'VALIDATION_FAILED' } });
    expect(calls).toEqual([]);
  });

  it('add recusa programa que não aceita várias contas', async () => {
    const { fake, calls } = setup();
    const result = await fake.call(CHANNELS.accountsAdd, { provider: 'shell', name: 'X' });
    expect(result).toMatchObject({ ok: false, error: { code: 'VALIDATION_FAILED' } });
    expect(calls).toEqual([]);
  });

  it('remove recusa id que não é UUID', async () => {
    const { fake, calls } = setup();
    const result = await fake.call(CHANNELS.accountsRemove, { accountId: '../../x', force: true });
    expect(result).toMatchObject({ ok: false, error: { code: 'VALIDATION_FAILED' } });
    expect(calls).toEqual([]);
  });

  it('remove não aceita a Principal', async () => {
    const { fake, calls } = setup();
    const result = await fake.call(CHANNELS.accountsRemove, { accountId: null, force: false });
    expect(result).toMatchObject({ ok: false, error: { code: 'VALIDATION_FAILED' } });
    expect(calls).toEqual([]);
  });

  it('rename, setDefault e disconnect repassam a entrada conferida', async () => {
    const { fake, calls } = setup();
    await fake.call(CHANNELS.accountsRename, { accountId: A, name: 'Cliente' });
    await fake.call(CHANNELS.accountsSetDefault, { provider: 'codex', accountId: null });
    await fake.call(CHANNELS.accountsDisconnect, { provider: 'claude', accountId: A });
    expect(calls).toEqual([
      ['rename', { accountId: A, name: 'Cliente' }],
      ['setDefault', { provider: 'codex', accountId: null }],
      ['disconnect', { provider: 'claude', accountId: A }],
    ]);
  });

  it('chamada de origem não confiável recebe PERMISSION_DENIED', async () => {
    const { fake, calls } = setup();
    for (const channel of fake.channels()) {
      expect(await fake.call(channel, undefined, 'https://site.invalido/')).toMatchObject({
        ok: false,
        error: { code: 'PERMISSION_DENIED' },
      });
    }
    expect(calls).toEqual([]);
  });
});

describe('canais do login', () => {
  it('login-start repassa programa e conta ao serviço', async () => {
    const { fake, calls } = setup();
    const result = await fake.call(CHANNELS.accountsLoginStart, { provider: 'claude', accountId: A });
    expect(result).toEqual({ ok: true, data: LOGIN });
    expect(calls).toEqual([['login.start', { provider: 'claude', accountId: A }]]);
  });

  it('login-get devolve o login em andamento', async () => {
    const { fake } = setup();
    expect(await fake.call(CHANNELS.accountsLoginGet)).toEqual({ ok: true, data: LOGIN });
  });

  it('cancel, confirm, reject, open-url e copy-url não recebem dado da tela', async () => {
    const { fake, calls } = setup();
    for (const channel of [
      CHANNELS.accountsLoginCancel,
      CHANNELS.accountsLoginConfirm,
      CHANNELS.accountsLoginReject,
      CHANNELS.accountsLoginOpenUrl,
      CHANNELS.accountsLoginCopyUrl,
    ]) {
      expect(await fake.call(channel, { url: 'https://evil.example/' })).toEqual(DONE);
    }
    expect(calls).toEqual([
      ['login.cancel'],
      ['login.confirm'],
      ['login.reject'],
      ['login.openUrl'],
      ['login.copyUrl'],
    ]);
  });

  it('login-write repassa a digitação', async () => {
    const { fake, calls } = setup();
    expect(await fake.call(CHANNELS.accountsLoginWrite, { data: 'abc\r' })).toEqual(DONE);
    expect(calls).toEqual([['login.write', 'abc\r']]);
  });

  it('login-write recusa texto acima do limite', async () => {
    const { fake, calls } = setup();
    const result = await fake.call(CHANNELS.accountsLoginWrite, { data: 'a'.repeat(16_385) });
    expect(result).toMatchObject({ ok: false, error: { code: 'VALIDATION_FAILED' } });
    expect(calls).toEqual([]);
  });

  it('login-resize repassa colunas e linhas, e recusa zero', async () => {
    const { fake, calls } = setup();
    expect(await fake.call(CHANNELS.accountsLoginResize, { cols: 90, rows: 20 })).toEqual(DONE);
    expect(await fake.call(CHANNELS.accountsLoginResize, { cols: 0, rows: 20 })).toMatchObject({
      ok: false,
    });
    expect(calls).toEqual([['login.resize', [90, 20]]]);
  });
});

describe('canais do app', () => {
  function setupApp(openResult = '') {
    const opened: string[] = [];
    const fake = fakeRegistry();
    registerAppHandlers(fake.registry, isTrusted, {
      version: '0.1.0',
      dataDir: 'C:\\dados',
      openPath: (path) => {
        opened.push(path);
        return Promise.resolve(openResult);
      },
    });
    return { fake, opened };
  }

  it('app:info devolve a versão e a pasta de dados', async () => {
    const { fake } = setupApp();
    expect(await fake.call(CHANNELS.appInfo)).toEqual({
      ok: true,
      data: { version: '0.1.0', dataDir: 'C:\\dados' },
    });
  });

  it('app:open-data-folder abre a pasta que a composição conhece, e não a que a tela mandar', async () => {
    const { fake, opened } = setupApp();
    expect(await fake.call(CHANNELS.appOpenDataFolder, { path: 'C:\\Windows' })).toEqual(DONE);
    expect(opened).toEqual(['C:\\dados']);
  });

  it('app:open-data-folder devolve falha quando o sistema não abre a pasta', async () => {
    const { fake } = setupApp('Failed to open path');
    expect(await fake.call(CHANNELS.appOpenDataFolder)).toMatchObject({ ok: false });
  });

  it('recusa remetente de outra origem', async () => {
    const { fake, opened } = setupApp();
    expect(
      await fake.call(CHANNELS.appOpenDataFolder, undefined, 'https://site.invalido/'),
    ).toMatchObject({ ok: false, error: { code: 'PERMISSION_DENIED' } });
    expect(opened).toEqual([]);
  });
});
