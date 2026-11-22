import { describe, expect, it } from 'vitest';
import {
  failure,
  type TerminalOpenInput,
  type TerminalPort,
  type TerminalSubscriber,
} from '@project-hub/application';
import type { AccountsDto, AppResult, LoginEvent } from '@project-hub/contracts';
import type { AppSettingsRepository } from '@project-hub/database';
import type { AccountCli, AccountStatus } from '../../src/main/accounts/account-cli';
import { createLoginService, LOGIN_TERMINAL_KEY } from '../../src/main/accounts/login-service';

const A = '11111111-1111-4111-8111-111111111111';
const URL_OK = 'https://claude.ai/oauth/authorize?code=true&client_id=abc';

const flush = (): Promise<void> => new Promise((resolve) => setImmediate(resolve));

function setup(
  options: {
    status?: AccountStatus;
    launch?: AppResult<{ command: string; args: string[]; env: Record<string, string> }>;
    failOpen?: boolean;
    /** O que o processo de terminais entrega antes de responder ao `listen`. */
    duringListen?: { data?: string; exit?: boolean };
    accounts?: AccountsDto;
  } = {},
) {
  const opened: TerminalOpenInput[] = [];
  const killed: string[] = [];
  const removed: string[] = [];
  /** A ordem do encerramento: matar, esquecer a saída e apagar a anotação. */
  const order: string[] = [];
  const written: string[] = [];
  const resized: [number, number][] = [];
  const listeners = new Map<string, TerminalSubscriber>();
  const port: TerminalPort = {
    open: (input) => {
      if (options.failOpen) return Promise.reject(new Error('falhou'));
      opened.push(input);
      return Promise.resolve();
    },
    write: (_id, data) => {
      written.push(data);
      return Promise.resolve();
    },
    resize: (_id, cols, rows) => {
      resized.push([cols, rows]);
      return Promise.resolve();
    },
    kill: (id) => {
      killed.push(id);
      order.push('kill');
      return Promise.resolve();
    },
    remove: (id) => {
      removed.push(id);
      order.push('remove');
      return Promise.resolve();
    },
    snapshot: () => Promise.resolve(undefined),
    subscribe: () => Promise.resolve(() => undefined),
    listen: (id, listener) => {
      listeners.set(id, listener);
      if (options.duringListen?.data !== undefined) listener.onData(options.duringListen.data);
      if (options.duringListen?.exit === true) listener.onExit({ exitCode: 0 });
      return Promise.resolve(() => void listeners.delete(id));
    },
  };

  const log: string[] = [];
  const cli: AccountCli = {
    status: () => {
      log.push('status');
      return Promise.resolve(options.status ?? { state: 'connected', identity: 'eu@x.co' });
    },
    logout: (provider, accountId) => {
      log.push(`logout ${provider} ${accountId ?? 'principal'}`);
      return Promise.resolve({ ok: true, data: undefined });
    },
    loginLaunch: (provider) =>
      options.launch ?? {
        ok: true,
        data: { command: provider, args: ['auth', 'login'], env: { PATH: 'x' } },
      },
  };

  const values = new Map<string, string>();
  const settings: AppSettingsRepository = {
    get: (key) => values.get(key),
    set: (key, value) => void values.set(key, value),
    remove: (key) => {
      order.push('unmark');
      values.delete(key);
    },
  };

  const events: LoginEvent[] = [];
  const external: string[] = [];
  const clipboard: string[] = [];
  const timers: { run: () => void; ms: number; cleared: boolean }[] = [];
  let ids = 0;

  const make = () =>
    createLoginService({
      port,
      cli,
      accounts: {
        list: () =>
          Promise.resolve({ ok: true, data: options.accounts ?? { groups: [], others: [] } }),
      },
      settings,
      publish: (event) => void events.push(event),
      openExternal: (url) => {
        external.push(url);
        return Promise.resolve();
      },
      writeClipboard: (text) => void clipboard.push(text),
      newId: () => `id${++ids}`,
      now: () => Date.parse('2026-11-21T12:00:00.000Z'),
      setTimer: (run, ms) => {
        const timer = { run, ms, cleared: false };
        timers.push(timer);
        return timer;
      },
      clearTimer: (handle) => {
        (handle as { cleared: boolean }).cleared = true;
      },
      cwd: 'C:\\dados',
    });

  const service = make();
  const states = () =>
    events.flatMap((event) => (event.type === 'state' ? [event.login?.phase ?? null] : []));
  const lastState = () => {
    const found = [...events].reverse().find((event) => event.type === 'state');
    return found?.type === 'state' ? found.login : undefined;
  };
  const current = () => listeners.get(opened[opened.length - 1]?.id ?? '');
  return {
    service,
    make,
    opened,
    killed,
    removed,
    order,
    written,
    resized,
    listeners,
    log,
    values,
    events,
    external,
    clipboard,
    timers,
    states,
    lastState,
    current,
  };
}

describe('start', () => {
  it('abre o programa com o comando de login e publica browser', async () => {
    const t = setup();

    const result = await t.service.start({ provider: 'claude', accountId: A });

    expect(result).toEqual({
      ok: true,
      data: {
        provider: 'claude',
        accountId: A,
        phase: 'browser',
        expiresAt: '2026-11-21T12:10:00.000Z',
      },
    });
    expect(t.opened).toHaveLength(1);
    expect(t.opened[0]).toMatchObject({
      id: 'login-id1',
      cwd: 'C:\\dados',
      command: 'claude',
      args: ['auth', 'login'],
      env: { PATH: 'x' },
    });
    expect(t.states()).toEqual(['starting', 'browser']);
    expect(t.values.get(LOGIN_TERMINAL_KEY)).toBe('login-id1');
    expect(t.timers[0]?.ms).toBe(600_000);
  });

  it('um segundo start com login aberto falha', async () => {
    const t = setup();
    await t.service.start({ provider: 'claude', accountId: A });

    const second = await t.service.start({ provider: 'codex', accountId: null });

    expect(second.ok).toBe(false);
    if (!second.ok) expect(second.error.message).toBe('Já há um login em andamento.');
    expect(t.opened).toHaveLength(1);
  });

  it('com o programa não instalado publica failed com not-installed', async () => {
    const t = setup({ launch: failure('AGENT_UNAVAILABLE', 'não achei') });
    const result = await t.service.start({ provider: 'codex', accountId: null });
    expect(result.ok && result.data.phase).toBe('failed');
    expect(result.ok && result.data.problem).toBe('not-installed');
    expect(t.opened).toHaveLength(0);
  });

  it('com conta que não existe devolve o erro e não deixa login em andamento', async () => {
    const t = setup({ launch: failure('VALIDATION_FAILED', 'A conta não existe mais.') });
    const result = await t.service.start({ provider: 'claude', accountId: A });
    expect(result.ok).toBe(false);
    expect(t.service.get()).toBeNull();
  });

  it('quando o terminal não abre publica failed com start-failed e apaga a anotação', async () => {
    const t = setup({ failOpen: true });
    const result = await t.service.start({ provider: 'claude', accountId: A });
    expect(result.ok && result.data.problem).toBe('start-failed');
    expect(t.values.has(LOGIN_TERMINAL_KEY)).toBe(false);
  });
});

describe('saída do programa', () => {
  it('com endereço permitido publica o host, e não o endereço', async () => {
    const t = setup();
    await t.service.start({ provider: 'claude', accountId: A });

    t.current()?.onData(`Abra: ${URL_OK}\r\n`);

    expect(t.lastState()?.host).toBe('claude.ai');
    const serialized = JSON.stringify(t.events.filter((event) => event.type === 'state'));
    expect(serialized).not.toContain('https://');
    expect(serialized).not.toContain('client_id');
  });

  it('é repassada à tela como evento data', async () => {
    const t = setup();
    await t.service.start({ provider: 'claude', accountId: A });
    t.current()?.onData('Cole o código: ');
    expect(t.events).toContainEqual({ type: 'data', data: 'Cole o código: ' });
  });

  it('acha o endereço que chega partido em dois trechos', async () => {
    const t = setup();
    await t.service.start({ provider: 'claude', accountId: A });
    t.current()?.onData('Abra: https://claude.ai/oauth/auth');
    t.current()?.onData('orize?x=1\r\n');
    await t.service.copyUrl();
    expect(t.clipboard).toEqual(['https://claude.ai/oauth/authorize?x=1']);
  });
});

describe('fim do processo', () => {
  it('com conta conectada publica confirm com a identidade', async () => {
    const t = setup();
    await t.service.start({ provider: 'claude', accountId: A });

    t.current()?.onExit({ exitCode: 0 });
    await flush();

    expect(t.states()).toEqual(['starting', 'browser', 'verifying', 'confirm']);
    expect(t.lastState()).toMatchObject({ phase: 'confirm', identity: 'eu@x.co' });
    expect(t.values.has(LOGIN_TERMINAL_KEY)).toBe(false);
    expect(t.timers[0]?.cleared).toBe(true);
  });

  it('sem conta conectada publica failed com not-connected', async () => {
    const t = setup({ status: { state: 'signed-out' } });
    await t.service.start({ provider: 'claude', accountId: A });
    t.current()?.onExit({ exitCode: 1 });
    await flush();
    expect(t.lastState()).toMatchObject({ phase: 'failed', problem: 'not-connected' });
  });

  it('com estado desconhecido publica failed com status-failed', async () => {
    const t = setup({ status: { state: 'unknown' } });
    await t.service.start({ provider: 'claude', accountId: A });
    t.current()?.onExit({ exitCode: 0 });
    await flush();
    expect(t.lastState()).toMatchObject({ phase: 'failed', problem: 'status-failed' });
  });

  it('a identidade igual à de outra conta vem em duplicateOf', async () => {
    const t = setup({
      accounts: {
        groups: [
          {
            provider: 'claude',
            installed: true,
            autoSwitch: { enabled: false, includeApi: false },
            preferredId: null,
            accounts: [
              {
                id: null,
                provider: 'claude',
                name: 'Principal',
                isPrincipal: true,
                isDefault: true,
                state: 'connected',
                identity: 'EU@x.co',
                kind: 'subscription',
              },
              {
                id: A,
                provider: 'claude',
                name: 'Trabalho',
                isPrincipal: false,
                isDefault: false,
                state: 'connected',
                identity: 'eu@x.co',
                kind: 'subscription',
              },
            ],
          },
        ],
        others: [],
      },
    });
    await t.service.start({ provider: 'claude', accountId: A });
    t.current()?.onExit({ exitCode: 0 });
    await flush();
    expect(t.lastState()?.duplicateOf).toBe('Principal');
  });

  it('descarta o endereço: openUrl depois do fim falha', async () => {
    const t = setup();
    await t.service.start({ provider: 'claude', accountId: A });
    t.current()?.onData(URL_OK);
    t.current()?.onExit({ exitCode: 0 });
    await flush();
    expect((await t.service.openUrl()).ok).toBe(false);
    expect(t.external).toEqual([]);
    expect(t.lastState()?.host).toBeUndefined();
  });
});

describe('confirm', () => {
  it('publica done e deixa de haver login em andamento', async () => {
    const t = setup();
    await t.service.start({ provider: 'claude', accountId: A });
    t.current()?.onExit({ exitCode: 0 });
    await flush();

    await t.service.confirm();

    expect(t.lastState()?.phase).toBe('done');
    expect(t.service.get()).toBeNull();
  });

  it('fora da fase confirm não faz nada', async () => {
    const t = setup();
    await t.service.start({ provider: 'claude', accountId: A });
    await t.service.confirm();
    expect(t.service.get()?.phase).toBe('browser');
  });
});

describe('cancel', () => {
  it('mata o processo e publica cancelled', async () => {
    const t = setup();
    await t.service.start({ provider: 'claude', accountId: A });

    await t.service.cancel();

    expect(t.killed).toEqual(['login-id1']);
    expect(t.lastState()?.phase).toBe('cancelled');
    expect(t.service.get()).toBeNull();
    expect(t.values.has(LOGIN_TERMINAL_KEY)).toBe(false);
    expect(t.listeners.size).toBe(0);
  });

  it('depois de uma falha só dispensa o aviso', async () => {
    const t = setup({ status: { state: 'signed-out' } });
    await t.service.start({ provider: 'claude', accountId: A });
    t.current()?.onExit({ exitCode: 1 });
    await flush();

    await t.service.cancel();

    expect(t.service.get()).toBeNull();
    expect(t.events[t.events.length - 1]).toEqual({ type: 'state', login: null });
  });
});

describe('prazo', () => {
  it('mata o processo e publica timed-out', async () => {
    const t = setup();
    await t.service.start({ provider: 'claude', accountId: A });

    t.timers[0]?.run();
    await flush();

    expect(t.killed).toEqual(['login-id1']);
    expect(t.lastState()?.phase).toBe('timed-out');
    expect(t.values.has(LOGIN_TERMINAL_KEY)).toBe(false);
  });
});

describe('reject', () => {
  it('roda a saída oficial e reabre o login', async () => {
    const t = setup();
    await t.service.start({ provider: 'claude', accountId: A });
    t.current()?.onExit({ exitCode: 0 });
    await flush();

    await t.service.reject();

    expect(t.log).toContain(`logout claude ${A}`);
    expect(t.opened.map((input) => input.id)).toEqual(['login-id1', 'login-id2']);
    expect(t.service.get()).toMatchObject({ phase: 'browser', accountId: A });
    expect(t.service.get()?.identity).toBeUndefined();
  });
});

describe('openUrl e copyUrl', () => {
  it('sem endereço achado falham e não abrem nada', async () => {
    const t = setup();
    await t.service.start({ provider: 'claude', accountId: A });
    expect((await t.service.openUrl()).ok).toBe(false);
    expect((await t.service.copyUrl()).ok).toBe(false);
    expect(t.external).toEqual([]);
    expect(t.clipboard).toEqual([]);
  });

  it('com endereço achado abrem e copiam o endereço do programa', async () => {
    const t = setup();
    await t.service.start({ provider: 'claude', accountId: A });
    t.current()?.onData(URL_OK);

    expect((await t.service.openUrl()).ok).toBe(true);
    expect((await t.service.copyUrl()).ok).toBe(true);

    expect(t.external).toEqual([URL_OK]);
    expect(t.clipboard).toEqual([URL_OK]);
  });
});

describe('write e resize', () => {
  it('vão para o terminal do login enquanto ele está aberto', async () => {
    const t = setup();
    await t.service.start({ provider: 'claude', accountId: A });
    await t.service.write('abc\r');
    await t.service.resize(90, 20);
    expect(t.written).toEqual(['abc\r']);
    expect(t.resized).toEqual([[90, 20]]);
  });

  it('sem login aberto não fazem nada', async () => {
    const t = setup();
    await t.service.write('abc');
    await t.service.resize(90, 20);
    expect(t.written).toEqual([]);
    expect(t.resized).toEqual([]);
  });
});

describe('ciclo de vida', () => {
  it('dispose mata o processo em curso', async () => {
    const t = setup();
    await t.service.start({ provider: 'claude', accountId: A });
    await t.service.dispose();
    expect(t.killed).toEqual(['login-id1']);
    expect(t.values.has(LOGIN_TERMINAL_KEY)).toBe(false);
  });

  it('um serviço novo não tem login em andamento', async () => {
    const t = setup();
    await t.service.start({ provider: 'claude', accountId: A });
    expect(t.make().get()).toBeNull();
  });

  it('recover mata o terminal de login que ficou de uma execução anterior e apaga a anotação', async () => {
    const t = setup();
    t.values.set(LOGIN_TERMINAL_KEY, 'login-antigo');

    await t.service.recover();

    expect(t.killed).toEqual(['login-antigo']);
    expect(t.values.has(LOGIN_TERMINAL_KEY)).toBe(false);
  });

  it('recover não mata um terminal que não é de login', async () => {
    const t = setup();
    t.values.set(LOGIN_TERMINAL_KEY, 'painel-1');
    await t.service.recover();
    expect(t.killed).toEqual([]);
    expect(t.values.has(LOGIN_TERMINAL_KEY)).toBe(false);
  });
});

describe('correções da revisão final', () => {
  it('o programa que sai enquanto o terminal abre é verificado, e o guia não fica parado', async () => {
    const t = setup({ duringListen: { exit: true } });

    await t.service.start({ provider: 'claude', accountId: A });
    await flush();

    expect(t.lastState()).toMatchObject({ phase: 'confirm', identity: 'eu@x.co' });
  });

  it('a saída que chega enquanto o terminal abre não se perde', async () => {
    const t = setup({ duringListen: { data: `Abra: ${URL_OK}\r\n` } });

    await t.service.start({ provider: 'claude', accountId: A });

    expect(t.lastState()).toMatchObject({ phase: 'browser', host: 'claude.ai' });
    expect(t.events).toContainEqual({ type: 'data', data: `Abra: ${URL_OK}\r\n` });
  });

  it('quando o programa sai, a saída do terminal do login é esquecida pelo processo de terminais', async () => {
    const t = setup();
    await t.service.start({ provider: 'claude', accountId: A });

    t.current()?.onExit({ exitCode: 0 });
    await flush();

    expect(t.removed).toEqual(['login-id1']);
    expect(t.killed).toEqual([]);
  });

  it('cancelar mata o processo, esquece a saída e só então apaga a anotação', async () => {
    const t = setup();
    await t.service.start({ provider: 'claude', accountId: A });
    t.order.length = 0;

    await t.service.cancel();

    expect(t.order).toEqual(['kill', 'remove', 'unmark']);
    expect(t.removed).toEqual(['login-id1']);
  });

  it('recover esquece a saída do login que ficou de uma execução anterior', async () => {
    const t = setup();
    t.values.set(LOGIN_TERMINAL_KEY, 'login-antigo');
    t.order.length = 0;

    await t.service.recover();

    expect(t.order).toEqual(['kill', 'remove', 'unmark']);
    expect(t.removed).toEqual(['login-antigo']);
  });

  it('cancelar na conferência publica cancelled, para a lista de contas ser relida', async () => {
    const t = setup();
    await t.service.start({ provider: 'claude', accountId: A });
    t.current()?.onExit({ exitCode: 0 });
    await flush();
    expect(t.lastState()?.phase).toBe('confirm');

    await t.service.cancel();

    expect(t.lastState()?.phase).toBe('cancelled');
    expect(t.service.get()).toBeNull();
  });
});
