import { describe, expect, it } from 'vitest';
import type { KeyState } from '@project-hub/contracts';
import type { AccountRecord } from '@project-hub/database';
import type { AccountStatus } from '../../src/main/accounts/account-cli';
import {
  AUTO_SWITCH_API_KEY,
  AUTO_SWITCH_KEY,
  autoSwitchSettingsOf,
  candidateOrder,
  createAccountSwitch,
  eligibilityOf,
  preferredAccount,
  type AutoSwitchSettings,
  type CandidateFacts,
} from '../../src/main/accounts/account-switch';

const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';
const API = '33333333-3333-4333-8333-333333333333';
const T = '2026-11-22T10:00:00.000Z';
const LATER = '2026-11-22T20:10:00.000Z';
const SOONER = '2026-11-22T15:00:00.000Z';

const ON: AutoSwitchSettings = { enabled: true, includeApi: false };

describe('candidateOrder', () => {
  it('ordena a padrão, a Principal e as extras, sem repetir', () => {
    expect(candidateOrder('b', ['a', 'b', 'c'])).toEqual(['b', null, 'a', 'c']);
    expect(candidateOrder(null, ['a', 'b'])).toEqual([null, 'a', 'b']);
  });
});

describe('eligibilityOf', () => {
  const base: CandidateFacts = { accountId: A, removed: false, kind: 'subscription' };

  it.each([
    [{ kind: 'api', keyState: 'stored' }, { includeApi: false }, 'api-excluded'],
    [{ kind: 'api', keyState: 'locked' }, { includeApi: true }, 'vault-locked'],
    [{ kind: 'api', keyState: 'missing' }, { includeApi: true }, 'no-key'],
    [{ kind: 'api', keyState: 'unreadable' }, { includeApi: true }, 'no-key'],
    [{ kind: 'api', keyState: 'stored' }, { includeApi: true }, 'eligible'],
    [{ kind: 'subscription', connected: false }, {}, 'signed-out'],
    [{ kind: 'subscription' }, {}, 'signed-out'],
    [{ kind: 'subscription', connected: true, exhaustedUntil: LATER }, {}, 'exhausted'],
    [{ kind: 'subscription', connected: true }, {}, 'eligible'],
    [{ removed: true, kind: 'subscription', connected: true }, {}, 'removed'],
  ] as const)('elegibilidade %j', (facts, settings, expected) => {
    expect(eligibilityOf({ ...base, ...facts }, { ...ON, ...settings })).toBe(expected);
  });
});

describe('autoSwitchSettingsOf', () => {
  it('lê a opção: falta e outro valor são desligado; includeApi só no Claude Code', () => {
    const values: Record<string, string> = {};
    const settings = { get: (key: string) => values[key] };
    expect(autoSwitchSettingsOf(settings, 'claude')).toEqual({ enabled: false, includeApi: false });

    values[AUTO_SWITCH_KEY('claude')] = 'sim';
    expect(autoSwitchSettingsOf(settings, 'claude').enabled).toBe(false);

    values[AUTO_SWITCH_KEY('claude')] = 'true';
    values[AUTO_SWITCH_API_KEY] = 'true';
    expect(autoSwitchSettingsOf(settings, 'claude')).toEqual({ enabled: true, includeApi: true });

    values[AUTO_SWITCH_KEY('codex')] = 'true';
    expect(autoSwitchSettingsOf(settings, 'codex')).toEqual({ enabled: true, includeApi: false });
  });
});

describe('preferredAccount', () => {
  const order = [A, null, B];
  function facts(entries: CandidateFacts[]): Map<string | null, CandidateFacts> {
    return new Map(entries.map((entry) => [entry.accountId, entry]));
  }
  const exhaustedA: CandidateFacts = {
    accountId: A,
    removed: false,
    kind: 'subscription',
    connected: true,
    exhaustedUntil: LATER,
  };
  const principal: CandidateFacts = {
    accountId: null,
    removed: false,
    kind: 'subscription',
    connected: true,
  };

  it('prefere a padrão quando ela não está esgotada, mesmo com a opção ligada', () => {
    const freshA: CandidateFacts = { accountId: A, removed: false, kind: 'subscription', connected: true };
    const map = facts([freshA, principal]);
    expect(preferredAccount({ defaultId: A, order, facts: map, settings: ON })).toBe(A);
  });

  it('prefere a primeira elegível quando a padrão está esgotada', () => {
    const map = facts([exhaustedA, principal]);
    expect(preferredAccount({ defaultId: A, order, facts: map, settings: ON })).toBeNull();
  });

  it('com a opção desligada, fica na padrão mesmo esgotada', () => {
    const map = facts([exhaustedA, principal]);
    expect(
      preferredAccount({ defaultId: A, order, facts: map, settings: { ...ON, enabled: false } }),
    ).toBe(A);
  });

  it('sem nenhuma elegível, fica na padrão', () => {
    const map = facts([exhaustedA, { ...principal, connected: false }]);
    expect(preferredAccount({ defaultId: A, order, facts: map, settings: ON })).toBe(A);
  });
});

describe('createAccountSwitch', () => {
  function setup(options: {
    defaultId?: string | null;
    exhausted?: Partial<Record<string, string>>;
    statuses?: Partial<Record<string, AccountStatus['state']>>;
    keyState?: KeyState;
    includeApi?: boolean;
  }) {
    const rows: AccountRecord[] = [
      { id: A, provider: 'claude', name: 'Trabalho', createdAt: T, kind: 'subscription' },
      { id: B, provider: 'claude', name: 'Pessoal', createdAt: T, kind: 'subscription' },
      { id: API, provider: 'claude', name: 'Chave', createdAt: T, kind: 'api' },
    ];
    const values: Record<string, string> = { [AUTO_SWITCH_KEY('claude')]: 'true' };
    if (options.includeApi === true) values[AUTO_SWITCH_API_KEY] = 'true';
    const asked: (string | null)[] = [];
    const nameOf = (id: string | null) => id ?? 'principal';
    const service = createAccountSwitch({
      accounts: {
        get: (id) => rows.find((row) => row.id === id),
        list: (provider) => rows.filter((row) => row.provider === provider),
      },
      settings: { get: (key) => values[key] },
      use: { defaultOf: () => options.defaultId ?? null },
      vault: { check: () => options.keyState ?? 'stored' },
      status: (_provider, id) => {
        asked.push(id);
        return Promise.resolve({ state: options.statuses?.[nameOf(id)] ?? 'connected' });
      },
      exhaustedUntil: (_provider, id) => options.exhausted?.[nameOf(id)],
    });
    return { service, asked };
  }

  it('pick pula a esgotada e a sem login, e não pergunta o estado de quem já caiu antes', async () => {
    const { service, asked } = setup({
      defaultId: A,
      exhausted: { principal: LATER },
      statuses: { [B]: 'connected' },
    });
    // A está excluída (acabou de esgotar); a Principal está esgotada; B é a primeira que serve.
    expect(await service.pick('claude', { exclude: A })).toEqual({ kind: 'account', accountId: B });
    expect(asked).toEqual([B]);
  });

  it('pick pula a assinatura sem login', async () => {
    const { service, asked } = setup({
      defaultId: A,
      statuses: { principal: 'signed-out', [B]: 'connected' },
    });
    expect(await service.pick('claude', { exclude: A })).toEqual({ kind: 'account', accountId: B });
    expect(asked).toEqual([null, B]);
  });

  it('pick sem nenhuma devolve a renovação mais próxima, a excluída inclusive', async () => {
    const { service } = setup({
      defaultId: A,
      exhausted: { [A]: SOONER, principal: LATER, [B]: LATER },
    });
    expect(await service.pick('claude', { exclude: A })).toEqual({
      kind: 'none',
      resetsAt: SOONER,
    });
  });

  it('pick sem nenhuma e sem hora conhecida devolve nenhuma, sem resetsAt', async () => {
    const { service } = setup({
      defaultId: A,
      statuses: { principal: 'signed-out', [B]: 'unknown' },
    });
    expect(await service.pick('claude', { exclude: A })).toEqual({ kind: 'none' });
  });

  it('pick nunca escolhe conta API com o cofre trancado', async () => {
    const { service, asked } = setup({
      defaultId: A,
      includeApi: true,
      keyState: 'locked',
      exhausted: { principal: LATER, [B]: LATER },
    });
    expect(await service.pick('claude', { exclude: A })).toEqual({
      kind: 'none',
      resetsAt: LATER,
    });
    expect(asked).toEqual([]);
  });

  it('pick escolhe a conta API com a chave guardada, se a opção a inclui', async () => {
    const { service } = setup({
      defaultId: A,
      includeApi: true,
      exhausted: { principal: LATER, [B]: LATER },
    });
    expect(await service.pick('claude', { exclude: A })).toEqual({
      kind: 'account',
      accountId: API,
    });
  });

  it('settingsOf lê a opção do programa', () => {
    expect(setup({}).service.settingsOf('claude')).toEqual({ enabled: true, includeApi: false });
  });
});
