import { describe, expect, it, vi } from 'vitest';
import { failure } from '@project-hub/application';
import type { AppResult, KeyState } from '@project-hub/contracts';
import type {
  AccountRecord,
  AccountRepository,
  AppSettingsRepository,
} from '@project-hub/database';
import type { AccountCli, AccountStatus } from '../../src/main/accounts/account-cli';
import type { AccountPaths } from '../../src/main/accounts/account-paths';
import { VAULT_UNAVAILABLE } from '../../src/main/accounts/account-vault';
import {
  AUTO_SWITCH_API_KEY,
  AUTO_SWITCH_KEY,
} from '../../src/main/accounts/account-switch';
import {
  createAccountsService,
  DEFAULT_ACCOUNT_KEY,
} from '../../src/main/accounts/accounts-service';
import type { ProviderRegistry } from '../../src/main/providers';

const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';
const NEW = '55555555-5555-4555-8555-555555555555';
const API = '66666666-6666-4666-8666-666666666666';
const NOW = '2026-11-21T12:00:00.000Z';

function memoryAccounts(initial: AccountRecord[]): AccountRepository & { rows: AccountRecord[] } {
  // Cópias: `markRemoved` muda a linha, e uma constante compartilhada entre testes não pode mudar.
  const rows = initial.map((row) => ({ ...row }));
  return {
    rows,
    insert: (record) => void rows.push({ ...record, kind: record.kind ?? 'subscription' }),
    get: (id) => rows.find((row) => row.id === id),
    list: (provider) =>
      rows.filter((row) => row.provider === provider && row.removedAt === undefined),
    rename: (id, name) => {
      const row = rows.find((item) => item.id === id);
      if (row) row.name = name;
    },
    markRemoved: (id, at) => {
      const row = rows.find((item) => item.id === id);
      if (row) row.removedAt = at;
    },
  };
}

function memorySettings(): AppSettingsRepository & { values: Map<string, string> } {
  const values = new Map<string, string>();
  return {
    values,
    get: (key) => values.get(key),
    set: (key, value) => void values.set(key, value),
    remove: (key) => void values.delete(key),
  };
}

const providers: ProviderRegistry = {
  list: () => [
    { id: 'claude', label: 'Claude Code', available: true },
    { id: 'codex', label: 'Codex', available: false, reason: 'x' },
    { id: 'antigravity', label: 'Antigravity', available: true },
    { id: 'opencode', label: 'OpenCode', available: false, reason: 'x' },
    { id: 'freebuff', label: 'Freebuff', available: false, reason: 'x' },
    { id: 'shell', label: 'PowerShell', available: true },
  ],
  resolve: (id) =>
    id === 'claude' || id === 'antigravity' || id === 'shell'
      ? { ok: true, launch: { command: id, args: [] } }
      : { ok: false, reason: 'x' },
};

function setup(
  options: {
    statuses?: Record<string, AccountStatus>;
    logout?: AppResult<undefined>;
    removeFolder?: AppResult<undefined>;
    ensureFolder?: () => Promise<string>;
    live?: string[];
    extraRows?: AccountRecord[];
    keyStates?: Record<string, KeyState>;
    vaultAvailable?: boolean;
    exhausted?: Record<string, string>;
  } = {},
) {
  const accounts = memoryAccounts([
    {
      id: A,
      provider: 'claude',
      name: 'Trabalho',
      createdAt: '2026-11-20T10:00:00.000Z',
      kind: 'subscription',
    },
    {
      id: B,
      provider: 'claude',
      name: 'Pessoal',
      createdAt: '2026-11-20T11:00:00.000Z',
      kind: 'subscription',
    },
    ...(options.extraRows ?? []),
  ]);
  const settings = memorySettings();
  const log: string[] = [];
  const statusCalls: string[] = [];
  const cli: AccountCli = {
    status: (provider, accountId) =>
      Promise.resolve(void statusCalls.push(`${provider}:${accountId ?? 'principal'}`)).then(
        () =>
          options.statuses?.[`${provider}:${accountId ?? 'principal'}`] ?? { state: 'signed-out' },
      ),
    logout: (provider, accountId) => {
      log.push(`logout ${provider} ${accountId ?? 'principal'}`);
      return Promise.resolve(options.logout ?? { ok: true, data: undefined });
    },
    loginLaunch: () => failure('UNKNOWN', 'x'),
  };
  const paths: AccountPaths = {
    folderOf: (provider, id) => `${provider}/${id}`,
    ensureFolder:
      options.ensureFolder ??
      ((provider, id) => {
        log.push(`ensure ${provider} ${id}`);
        return Promise.resolve(`${provider}/${id}`);
      }),
    envOf: () => ({ ok: true, data: {} }),
    removeFolder: (provider, id) => {
      log.push(`rm ${provider} ${id}`);
      return Promise.resolve(options.removeFolder ?? { ok: true, data: undefined });
    },
  };
  const vault = {
    status: () => ({ state: 'unlocked' as const, available: options.vaultAvailable ?? true }),
    check: vi.fn((id: string): KeyState => options.keyStates?.[id] ?? 'missing'),
    last4Of: (id: string) =>
      (options.keyStates?.[id] ?? 'missing') === 'missing' ? undefined : 'WXYZ',
    remove: vi.fn((id: string) => void log.push(`vault-rm ${id}`)),
    reveal: vi.fn(),
  };
  const service = createAccountsService({
    accounts,
    settings,
    paths,
    cli,
    vault,
    providers,
    newId: () => NEW,
    now: () => NOW,
    liveSessionsOf: () => Promise.resolve(options.live ?? []),
    exhaustedUntil: (provider, accountId) =>
      options.exhausted?.[`${provider}:${accountId ?? 'principal'}`],
  });
  return { service, accounts, settings, log, vault, statusCalls };
}

const API_ROW: AccountRecord = {
  id: API,
  provider: 'claude',
  name: 'Chave',
  createdAt: '2026-11-20T12:00:00.000Z',
  kind: 'api',
};

describe('list', () => {
  it('lista a Principal e as extras, com o estado de cada uma', async () => {
    const { service, settings } = setup({
      statuses: {
        'claude:principal': { state: 'connected', identity: 'eu@x.co', organization: 'Org' },
        [`claude:${A}`]: { state: 'connected', identity: 'trab@x.co' },
        'codex:principal': { state: 'unknown' },
      },
    });
    settings.set(DEFAULT_ACCOUNT_KEY('claude'), A, NOW);

    const result = await service.list();

    expect(result).toEqual({
      ok: true,
      data: {
        groups: [
          {
            provider: 'claude',
            installed: true,
            accounts: [
              {
                id: null,
                provider: 'claude',
                name: 'Principal',
                isPrincipal: true,
                isDefault: false,
                state: 'connected',
                identity: 'eu@x.co',
                organization: 'Org',
                kind: 'subscription',
              },
              {
                id: A,
                provider: 'claude',
                name: 'Trabalho',
                isPrincipal: false,
                isDefault: true,
                state: 'connected',
                identity: 'trab@x.co',
                kind: 'subscription',
              },
              {
                id: B,
                provider: 'claude',
                name: 'Pessoal',
                isPrincipal: false,
                isDefault: false,
                state: 'signed-out',
                kind: 'subscription',
              },
            ],
            autoSwitch: { enabled: false, includeApi: false },
            preferredId: A,
          },
          {
            provider: 'codex',
            installed: false,
            accounts: [
              {
                id: null,
                provider: 'codex',
                name: 'Principal',
                isPrincipal: true,
                isDefault: true,
                state: 'unknown',
                kind: 'subscription',
              },
            ],
            autoSwitch: { enabled: false, includeApi: false },
            preferredId: null,
          },
        ],
        others: [
          { provider: 'antigravity', label: 'Antigravity', installed: true },
          { provider: 'opencode', label: 'OpenCode', installed: false },
          { provider: 'freebuff', label: 'Freebuff', installed: false },
        ],
      },
    });
  });

  it('com a padrão apontando para conta que não existe, a Principal é a padrão', async () => {
    const { service, settings } = setup();
    settings.set(DEFAULT_ACCOUNT_KEY('claude'), NEW, NOW);
    const result = await service.list();
    expect(result.ok && result.data.groups[0]?.accounts[0]?.isDefault).toBe(true);
  });
});

describe('add', () => {
  it('grava, cria a pasta e devolve a conta sem login', async () => {
    const { service, accounts, log } = setup();

    const result = await service.add({ provider: 'codex', name: 'Trabalho', kind: 'subscription' });

    expect(result).toEqual({
      ok: true,
      data: {
        id: NEW,
        provider: 'codex',
        name: 'Trabalho',
        isPrincipal: false,
        isDefault: false,
        state: 'signed-out',
        kind: 'subscription',
      },
    });
    expect(accounts.get(NEW)).toEqual({
      id: NEW,
      provider: 'codex',
      name: 'Trabalho',
      createdAt: NOW,
      kind: 'subscription',
    });
    expect(log).toEqual([`ensure codex ${NEW}`]);
  });

  it('recusa nome igual mudando só maiúsculas', async () => {
    const { service, accounts } = setup();
    const result = await service.add({
      provider: 'claude',
      name: 'TRABALHO',
      kind: 'subscription',
    });
    expect(result.ok).toBe(false);
    expect(accounts.rows).toHaveLength(2);
  });

  it('recusa o nome Principal', async () => {
    const { service } = setup();
    expect(
      (await service.add({ provider: 'codex', name: 'principal', kind: 'subscription' })).ok,
    ).toBe(false);
  });

  it('quando a pasta não pode ser criada, a conta não fica na lista', async () => {
    const { service, accounts } = setup({
      ensureFolder: () => Promise.reject(new Error('EPERM')),
    });
    const result = await service.add({ provider: 'codex', name: 'Trabalho', kind: 'subscription' });
    expect(result.ok).toBe(false);
    expect(accounts.list('codex')).toEqual([]);
  });
});

describe('rename', () => {
  it('troca o nome', async () => {
    const { service, accounts } = setup();
    expect(await service.rename({ accountId: A, name: 'Cliente' })).toEqual({
      ok: true,
      data: undefined,
    });
    expect(accounts.get(A)?.name).toBe('Cliente');
  });

  it('aceita mudar só as maiúsculas do próprio nome', async () => {
    const { service, accounts } = setup();
    expect((await service.rename({ accountId: A, name: 'TRABALHO' })).ok).toBe(true);
    expect(accounts.get(A)?.name).toBe('TRABALHO');
  });

  it('recusa o nome de outra conta do programa', async () => {
    const { service } = setup();
    expect((await service.rename({ accountId: A, name: 'pessoal' })).ok).toBe(false);
  });

  it('recusa conta que não existe', async () => {
    const { service } = setup();
    expect((await service.rename({ accountId: NEW, name: 'X' })).ok).toBe(false);
  });
});

describe('setDefault', () => {
  it('com conta conectada grava a padrão', async () => {
    const { service, settings } = setup({ statuses: { [`claude:${A}`]: { state: 'connected' } } });
    expect((await service.setDefault({ provider: 'claude', accountId: A })).ok).toBe(true);
    expect(settings.get(DEFAULT_ACCOUNT_KEY('claude'))).toBe(A);
  });

  it('com conta sem login falha', async () => {
    const { service, settings } = setup();
    expect((await service.setDefault({ provider: 'claude', accountId: A })).ok).toBe(false);
    expect(settings.get(DEFAULT_ACCOUNT_KEY('claude'))).toBeUndefined();
  });

  it('com conta de outro programa falha', async () => {
    const { service } = setup({ statuses: { [`codex:${A}`]: { state: 'connected' } } });
    expect((await service.setDefault({ provider: 'codex', accountId: A })).ok).toBe(false);
  });

  it('nulo volta para a Principal', async () => {
    const { service, settings } = setup();
    settings.set(DEFAULT_ACCOUNT_KEY('claude'), A, NOW);
    expect((await service.setDefault({ provider: 'claude', accountId: null })).ok).toBe(true);
    expect(settings.get(DEFAULT_ACCOUNT_KEY('claude'))).toBeUndefined();
  });
});

describe('disconnect', () => {
  it('roda a saída do programa', async () => {
    const { service, log } = setup();
    expect((await service.disconnect({ provider: 'claude', accountId: A })).ok).toBe(true);
    expect(log).toEqual([`logout claude ${A}`]);
  });

  it('com sessão viva falha e não roda o programa', async () => {
    const { service, log } = setup({ live: ['Painel 1', 'Painel 2'] });
    const result = await service.disconnect({ provider: 'claude', accountId: null });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('VALIDATION_FAILED');
      expect(result.error.message).toContain('Painel 1, Painel 2');
    }
    expect(log).toEqual([]);
  });

  it('de conta de outro programa falha sem rodar o programa', async () => {
    const { service, log } = setup();
    expect((await service.disconnect({ provider: 'codex', accountId: A })).ok).toBe(false);
    expect(log).toEqual([]);
  });

  it('da conta padrão devolve a padrão à Principal', async () => {
    const { service, settings } = setup();
    settings.set(DEFAULT_ACCOUNT_KEY('claude'), A, NOW);
    await service.disconnect({ provider: 'claude', accountId: A });
    expect(settings.get(DEFAULT_ACCOUNT_KEY('claude'))).toBeUndefined();
  });
});

describe('remove', () => {
  it('sai da conta, apaga a pasta e marca a linha', async () => {
    const { service, accounts, log } = setup();
    expect(await service.remove({ accountId: A, force: false })).toEqual({
      ok: true,
      data: undefined,
    });
    expect(log).toEqual([`logout claude ${A}`, `rm claude ${A}`]);
    expect(accounts.get(A)?.removedAt).toBe(NOW);
  });

  it('com sessão viva falha e não apaga nada', async () => {
    const { service, accounts, log } = setup({ live: ['Painel 1'] });
    expect((await service.remove({ accountId: A, force: true })).ok).toBe(false);
    expect(log).toEqual([]);
    expect(accounts.get(A)?.removedAt).toBeUndefined();
  });

  it('com a saída falhando não apaga sem force', async () => {
    const { service, accounts, log } = setup({ logout: failure('AGENT_UNAVAILABLE', 'x') });
    const result = await service.remove({ accountId: A, force: false });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('PROCESS_START_FAILED');
    expect(log).toEqual([`logout claude ${A}`]);
    expect(accounts.get(A)?.removedAt).toBeUndefined();
  });

  it('com force apaga mesmo assim', async () => {
    const { service, accounts, log } = setup({ logout: failure('AGENT_UNAVAILABLE', 'x') });
    expect((await service.remove({ accountId: A, force: true })).ok).toBe(true);
    expect(log).toEqual([`logout claude ${A}`, `rm claude ${A}`]);
    expect(accounts.get(A)?.removedAt).toBe(NOW);
  });

  it('da conta padrão devolve a padrão à Principal', async () => {
    const { service, settings } = setup();
    settings.set(DEFAULT_ACCOUNT_KEY('claude'), A, NOW);
    await service.remove({ accountId: A, force: false });
    expect(settings.get(DEFAULT_ACCOUNT_KEY('claude'))).toBeUndefined();
  });

  it('de outra conta não mexe na padrão', async () => {
    const { service, settings } = setup();
    settings.set(DEFAULT_ACCOUNT_KEY('claude'), A, NOW);
    await service.remove({ accountId: B, force: false });
    expect(settings.get(DEFAULT_ACCOUNT_KEY('claude'))).toBe(A);
  });

  it('com a pasta presa mantém a linha', async () => {
    const { service, accounts } = setup({ removeFolder: failure('UNKNOWN', 'presa') });
    const result = await service.remove({ accountId: A, force: false });
    expect(result.ok).toBe(false);
    expect(accounts.get(A)?.removedAt).toBeUndefined();
  });

  it('de conta já removida falha', async () => {
    const { service, log } = setup();
    await service.remove({ accountId: A, force: false });
    log.length = 0;
    expect((await service.remove({ accountId: A, force: false })).ok).toBe(false);
    expect(log).toEqual([]);
  });
});

describe('conta por chave de API', () => {
  it('criar conta API grava o tipo e devolve a conta sem chave', async () => {
    const { service, accounts } = setup();

    const result = await service.add({ provider: 'claude', name: 'Chave', kind: 'api' });

    expect(result).toEqual({
      ok: true,
      data: {
        id: NEW,
        provider: 'claude',
        name: 'Chave',
        isPrincipal: false,
        isDefault: false,
        state: 'unknown',
        kind: 'api',
        keyState: 'missing',
      },
    });
    expect(accounts.get(NEW)?.kind).toBe('api');
  });

  it('cria conta API do Codex, sem chave ainda', async () => {
    const { service, accounts } = setup();

    const result = await service.add({ provider: 'codex', name: 'Chave', kind: 'api' });

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.data).toMatchObject({ kind: 'api', keyState: 'missing' });
    expect(accounts.get(NEW)?.kind).toBe('api');
    expect(accounts.get(NEW)?.provider).toBe('codex');
  });

  it('criar conta API sem safeStorage disponível é recusado', async () => {
    const { service, accounts } = setup({ vaultAvailable: false });

    const result = await service.add({ provider: 'claude', name: 'Chave', kind: 'api' });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.message).toBe(VAULT_UNAVAILABLE);
    expect(accounts.rows).toHaveLength(2);
  });

  it('a lista mostra keyState e keyLast4 da conta API, e nunca chama o programa para ela', async () => {
    const h = setup({ extraRows: [API_ROW], keyStates: { [API]: 'stored' } });

    const result = await h.service.list();

    const api = result.ok
      ? result.data.groups[0]?.accounts.find((account) => account.id === API)
      : undefined;
    expect(api).toEqual({
      id: API,
      provider: 'claude',
      name: 'Chave',
      isPrincipal: false,
      isDefault: false,
      state: 'unknown',
      kind: 'api',
      keyState: 'stored',
      keyLast4: 'WXYZ',
    });
    expect(h.statusCalls).not.toContain(`claude:${API}`);
    expect(h.vault.reveal).not.toHaveBeenCalled();
  });

  it('a lista não roda o programa da conta API', async () => {
    const h = setup({
      extraRows: [API_ROW],
      keyStates: { [API]: 'stored' },
      statuses: { [`claude:${API}`]: { state: 'connected', identity: 'x@y.z' } },
    });

    const result = await h.service.list();

    const api = result.ok
      ? result.data.groups[0]?.accounts.find((account) => account.id === API)
      : undefined;
    expect(api?.state).toBe('unknown');
    expect(api?.identity).toBeUndefined();
  });

  it('com o cofre trancado, a lista mostra "locked" sem decifrar nada', async () => {
    const h = setup({ extraRows: [API_ROW], keyStates: { [API]: 'locked' } });

    const result = await h.service.list();

    const api = result.ok
      ? result.data.groups[0]?.accounts.find((account) => account.id === API)
      : undefined;
    expect(api?.keyState).toBe('locked');
    expect(api?.keyLast4).toBe('WXYZ');
    expect(h.vault.reveal).not.toHaveBeenCalled();
  });

  it('definir como padrão exige chave guardada', async () => {
    const without = setup({ extraRows: [API_ROW] });
    const locked = setup({ extraRows: [API_ROW], keyStates: { [API]: 'locked' } });
    const stored = setup({ extraRows: [API_ROW], keyStates: { [API]: 'stored' } });

    expect((await without.service.setDefault({ provider: 'claude', accountId: API })).ok).toBe(
      false,
    );
    expect((await locked.service.setDefault({ provider: 'claude', accountId: API })).ok).toBe(
      false,
    );
    expect((await stored.service.setDefault({ provider: 'claude', accountId: API })).ok).toBe(true);
    expect(stored.settings.get(DEFAULT_ACCOUNT_KEY('claude'))).toBe(API);
  });

  it('desconectar conta API é recusado, sem rodar o programa', async () => {
    const h = setup({ extraRows: [API_ROW], keyStates: { [API]: 'stored' } });

    expect((await h.service.disconnect({ provider: 'claude', accountId: API })).ok).toBe(false);
    expect(h.log).toEqual([]);
  });

  it('remover conta API: apaga a linha do cofre, depois a pasta, depois marca; sem logout', async () => {
    const h = setup({ extraRows: [API_ROW], keyStates: { [API]: 'stored' } });
    h.settings.set(DEFAULT_ACCOUNT_KEY('claude'), API, NOW);

    expect(await h.service.remove({ accountId: API, force: false })).toEqual({
      ok: true,
      data: undefined,
    });

    expect(h.log).toEqual([`vault-rm ${API}`, `rm claude ${API}`]);
    expect(h.accounts.get(API)?.removedAt).toBe(NOW);
    expect(h.settings.get(DEFAULT_ACCOUNT_KEY('claude'))).toBeUndefined();
  });

  it('remover conta API cuja pasta falha: a conta fica na lista, sem chave', async () => {
    const h = setup({
      extraRows: [API_ROW],
      keyStates: { [API]: 'stored' },
      removeFolder: failure('UNKNOWN', 'presa'),
    });

    const result = await h.service.remove({ accountId: API, force: false });

    expect(result.ok).toBe(false);
    expect(h.vault.remove).toHaveBeenCalledWith(API);
    expect(h.accounts.get(API)?.removedAt).toBeUndefined();
  });

  it('remover conta API com painel vivo falha e não apaga a chave', async () => {
    const h = setup({ extraRows: [API_ROW], keyStates: { [API]: 'stored' }, live: ['Painel'] });

    expect((await h.service.remove({ accountId: API, force: false })).ok).toBe(false);
    expect(h.vault.remove).not.toHaveBeenCalled();
  });
});

const LATER = '2026-11-21T20:10:00.000Z';

describe('troca automática de conta', () => {
  function groupOf(result: Awaited<ReturnType<ReturnType<typeof setup>['service']['list']>>) {
    if (!result.ok) throw new Error('a lista deveria funcionar');
    const group = result.data.groups.find((item) => item.provider === 'claude');
    if (group === undefined) throw new Error('o grupo do Claude deveria existir');
    return group;
  }

  it('lista a opção desligada e a padrão como preferida, sem nada gravado', async () => {
    const { service } = setup();
    expect(groupOf(await service.list())).toMatchObject({
      autoSwitch: { enabled: false, includeApi: false },
      preferredId: null,
    });
  });

  it('com a opção ligada e a padrão esgotada, a preferida é a próxima conectada', async () => {
    const { service, settings } = setup({
      statuses: {
        'claude:principal': { state: 'connected' },
        [`claude:${A}`]: { state: 'signed-out' },
        [`claude:${B}`]: { state: 'connected' },
      },
      exhausted: { 'claude:principal': LATER },
    });
    settings.set(AUTO_SWITCH_KEY('claude'), 'true', NOW);
    expect(groupOf(await service.list())).toMatchObject({
      autoSwitch: { enabled: true, includeApi: false },
      preferredId: B,
    });
  });

  it('com a opção desligada, a preferida é a padrão mesmo esgotada', async () => {
    const { service } = setup({
      statuses: { [`claude:${B}`]: { state: 'connected' } },
      exhausted: { 'claude:principal': LATER },
    });
    expect(groupOf(await service.list()).preferredId).toBeNull();
  });

  it('mostra exhaustedUntil só na conta esgotada', async () => {
    const { service } = setup({ exhausted: { [`claude:${A}`]: LATER } });
    const accounts = groupOf(await service.list()).accounts;
    expect(accounts.find((account) => account.id === A)?.exhaustedUntil).toBe(LATER);
    expect(accounts.find((account) => account.id === null)).not.toHaveProperty('exhaustedUntil');
    expect(accounts.find((account) => account.id === B)).not.toHaveProperty('exhaustedUntil');
  });

  it('recusa ligar com uma conta só', async () => {
    const { service, settings } = setup();
    expect(await service.setAutoSwitch({ provider: 'codex', option: 'enabled', value: true })).toEqual(
      failure('VALIDATION_FAILED', 'Adicione outra conta para usar a troca automática.'),
    );
    expect(settings.values.has(AUTO_SWITCH_KEY('codex'))).toBe(false);
  });

  it('liga e grava a opção', async () => {
    const { service, settings } = setup();
    expect(
      await service.setAutoSwitch({ provider: 'claude', option: 'enabled', value: true }),
    ).toEqual({ ok: true, data: undefined });
    expect(settings.values.get(AUTO_SWITCH_KEY('claude'))).toBe('true');
  });

  it('recusa incluir API com a troca desligada; desligar sempre vale', async () => {
    const { service, settings } = setup();
    expect(
      await service.setAutoSwitch({ provider: 'claude', option: 'includeApi', value: true }),
    ).toEqual(failure('VALIDATION_FAILED', 'Ligue antes a troca de conta.'));
    expect(settings.values.has(AUTO_SWITCH_API_KEY)).toBe(false);

    await service.setAutoSwitch({ provider: 'claude', option: 'enabled', value: true });
    expect(
      await service.setAutoSwitch({ provider: 'claude', option: 'includeApi', value: true }),
    ).toEqual({ ok: true, data: undefined });
    expect(settings.values.get(AUTO_SWITCH_API_KEY)).toBe('true');

    expect(
      await service.setAutoSwitch({ provider: 'codex', option: 'enabled', value: false }),
    ).toEqual({ ok: true, data: undefined });
    expect(settings.values.get(AUTO_SWITCH_KEY('codex'))).toBe('false');
  });
});
