import { describe, expect, it } from 'vitest';
import { failure } from '@project-hub/application';
import type { AppResult } from '@project-hub/contracts';
import type {
  AccountRecord,
  AccountRepository,
  AppSettingsRepository,
} from '@project-hub/database';
import type { AccountCli, AccountStatus } from '../../src/main/accounts/account-cli';
import type { AccountPaths } from '../../src/main/accounts/account-paths';
import {
  createAccountsService,
  DEFAULT_ACCOUNT_KEY,
} from '../../src/main/accounts/accounts-service';
import type { ProviderRegistry } from '../../src/main/providers';

const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';
const NEW = '55555555-5555-4555-8555-555555555555';
const NOW = '2026-11-21T12:00:00.000Z';

function memoryAccounts(initial: AccountRecord[]): AccountRepository & { rows: AccountRecord[] } {
  const rows = [...initial];
  return {
    rows,
    insert: (record) => void rows.push(record),
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
  } = {},
) {
  const accounts = memoryAccounts([
    { id: A, provider: 'claude', name: 'Trabalho', createdAt: '2026-11-20T10:00:00.000Z' },
    { id: B, provider: 'claude', name: 'Pessoal', createdAt: '2026-11-20T11:00:00.000Z' },
  ]);
  const settings = memorySettings();
  const log: string[] = [];
  const cli: AccountCli = {
    status: (provider, accountId) =>
      Promise.resolve(
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
  const service = createAccountsService({
    accounts,
    settings,
    paths,
    cli,
    providers,
    newId: () => NEW,
    now: () => NOW,
    liveSessionsOf: () => Promise.resolve(options.live ?? []),
  });
  return { service, accounts, settings, log };
}

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
              },
              {
                id: A,
                provider: 'claude',
                name: 'Trabalho',
                isPrincipal: false,
                isDefault: true,
                state: 'connected',
                identity: 'trab@x.co',
              },
              {
                id: B,
                provider: 'claude',
                name: 'Pessoal',
                isPrincipal: false,
                isDefault: false,
                state: 'signed-out',
              },
            ],
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
              },
            ],
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

    const result = await service.add({ provider: 'codex', name: 'Trabalho' });

    expect(result).toEqual({
      ok: true,
      data: {
        id: NEW,
        provider: 'codex',
        name: 'Trabalho',
        isPrincipal: false,
        isDefault: false,
        state: 'signed-out',
      },
    });
    expect(accounts.get(NEW)).toEqual({
      id: NEW,
      provider: 'codex',
      name: 'Trabalho',
      createdAt: NOW,
    });
    expect(log).toEqual([`ensure codex ${NEW}`]);
  });

  it('recusa nome igual mudando só maiúsculas', async () => {
    const { service, accounts } = setup();
    const result = await service.add({ provider: 'claude', name: 'TRABALHO' });
    expect(result.ok).toBe(false);
    expect(accounts.rows).toHaveLength(2);
  });

  it('recusa o nome Principal', async () => {
    const { service } = setup();
    expect((await service.add({ provider: 'codex', name: 'principal' })).ok).toBe(false);
  });

  it('quando a pasta não pode ser criada, a conta não fica na lista', async () => {
    const { service, accounts } = setup({
      ensureFolder: () => Promise.reject(new Error('EPERM')),
    });
    const result = await service.add({ provider: 'codex', name: 'Trabalho' });
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
