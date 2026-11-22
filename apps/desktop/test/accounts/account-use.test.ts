import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import type { AppResult, KeyState } from '@project-hub/contracts';
import type { AccountRecord } from '@project-hub/database';
import { createAccountPaths } from '../../src/main/accounts/account-paths';
import { createAccountUse } from '../../src/main/accounts/account-use';
import { KEY_MISSING, VAULT_LOCKED } from '../../src/main/accounts/account-vault';
import { DEFAULT_ACCOUNT_KEY } from '../../src/main/accounts/accounts-service';

const A = '11111111-1111-4111-8111-111111111111';
const GONE = '22222222-2222-4222-8222-222222222222';
const CODEX = '33333333-3333-4333-8333-333333333333';
const NOBODY = '44444444-4444-4444-8444-444444444444';
const API = '55555555-5555-4555-8555-555555555555';
const KEY = 'sk-ant-api03-chave-falsa-0123456789-abcdefghijKLMNOPWXYZ';
const ROOT = join('C:', 'dados', 'accounts');
const T = '2026-11-21T10:00:00.000Z';

function setup(defaults: Record<string, string> = {}, keyState: KeyState = 'stored') {
  const rows: AccountRecord[] = [
    { id: A, provider: 'claude', name: 'Trabalho', createdAt: T, kind: 'subscription' },
    {
      id: GONE,
      provider: 'claude',
      name: 'Antiga',
      createdAt: T,
      removedAt: T,
      kind: 'subscription',
    },
    { id: CODEX, provider: 'codex', name: 'Estudo', createdAt: T, kind: 'subscription' },
    { id: API, provider: 'claude', name: 'Chave', createdAt: T, kind: 'api' },
  ];
  const accounts = {
    get: (id: string) => rows.find((row) => row.id === id),
    list: (provider: string) =>
      rows.filter((row) => row.provider === provider && row.removedAt === undefined),
  };
  const settings = { get: (key: string) => defaults[key] };
  const paths = createAccountPaths({ root: ROOT, accounts });
  const vault = {
    state: keyState,
    check: vi.fn((): KeyState => vault.state),
    reveal: vi.fn((): AppResult<string> =>
      vault.state === 'stored'
        ? { ok: true, data: KEY }
        : vault.state === 'locked'
          ? { ok: false, error: { code: 'VAULT_LOCKED', message: VAULT_LOCKED, retryable: true } }
          : {
              ok: false,
              error: { code: 'VALIDATION_FAILED', message: KEY_MISSING, retryable: false },
            },
    ),
  };
  const use = createAccountUse({
    accounts,
    settings,
    paths,
    vault,
    env: { CLAUDE_CONFIG_DIR: 'C:/pessoa/.claude', CODEX_HOME: 'C:/pessoa/.codex' },
  });
  return Object.assign(use, { vault, paths });
}

describe('conta em uso: a padrão', () => {
  it('sem a chave, a padrão é a Principal', () => {
    expect(setup().defaultOf('claude')).toBeNull();
  });

  it('com a chave, é a conta gravada', () => {
    expect(setup({ [DEFAULT_ACCOUNT_KEY('claude')]: A }).defaultOf('claude')).toBe(A);
  });

  it('conta padrão removida, desconhecida ou de outro programa volta para a Principal', () => {
    expect(setup({ [DEFAULT_ACCOUNT_KEY('claude')]: GONE }).defaultOf('claude')).toBeNull();
    expect(setup({ [DEFAULT_ACCOUNT_KEY('claude')]: NOBODY }).defaultOf('claude')).toBeNull();
    expect(setup({ [DEFAULT_ACCOUNT_KEY('claude')]: CODEX }).defaultOf('claude')).toBeNull();
  });
});

describe('conta em uso: o ambiente do lançamento', () => {
  it('a Principal não leva variável nenhuma', async () => {
    expect(await setup().launchEnv('claude', null)).toEqual({ ok: true, data: {} });
  });

  it('a conta extra leva a variável do programa apontando para a pasta dela', async () => {
    expect(await setup().launchEnv('claude', A)).toEqual({
      ok: true,
      data: { CLAUDE_CONFIG_DIR: join(ROOT, 'claude', A) },
    });
    expect(await setup().launchEnv('codex', CODEX)).toEqual({
      ok: true,
      data: { CODEX_HOME: join(ROOT, 'codex', CODEX) },
    });
  });

  it('conta removida, desconhecida, de outro programa ou com id inválido falha, e nunca devolve ambiente vazio', async () => {
    for (const id of [GONE, NOBODY, CODEX, 'x']) {
      const result = await setup().launchEnv('claude', id);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.message).toBe('A conta foi removida.');
    }
  });
});

describe('conta em uso: conta por chave de API', () => {
  it('conta API com chave: launchEnv traz a pasta e ANTHROPIC_API_KEY', async () => {
    expect(await setup().launchEnv('claude', API)).toEqual({
      ok: true,
      data: { CLAUDE_CONFIG_DIR: join(ROOT, 'claude', API), ANTHROPIC_API_KEY: KEY },
    });
  });

  it('conta de assinatura nunca recebe a variável da chave', async () => {
    const use = setup();
    for (const [provider, id] of [
      ['claude', null],
      ['claude', A],
      ['codex', CODEX],
    ] as const) {
      const result = await use.launchEnv(provider, id);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(Object.keys(result.data)).not.toContain('ANTHROPIC_API_KEY');
        expect(Object.keys(result.data)).not.toContain('OPENAI_API_KEY');
      }
    }
    expect(use.vault.reveal).not.toHaveBeenCalled();
  });

  it('envOf de conta API não traz a chave', () => {
    const use = setup();
    expect(use.paths.envOf('claude', API)).toEqual({
      ok: true,
      data: { CLAUDE_CONFIG_DIR: join(ROOT, 'claude', API) },
    });
  });

  it('conta API sem chave falha com KEY_MISSING e não devolve o ambiente da Principal', async () => {
    const result = await setup({}, 'missing').launchEnv('claude', API);

    expect(result).toEqual({
      ok: false,
      error: { code: 'VALIDATION_FAILED', message: KEY_MISSING, retryable: false },
    });
  });

  it('conta API com o cofre trancado falha com o código VAULT_LOCKED', async () => {
    const result = await setup({}, 'locked').launchEnv('claude', API);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('VAULT_LOCKED');
      expect(result.error.message).toBe(VAULT_LOCKED);
    }
  });

  it('a chave é lida do cofre a cada chamada', async () => {
    const use = setup();

    await use.launchEnv('claude', API);
    await use.launchEnv('claude', API);

    expect(use.vault.reveal).toHaveBeenCalledTimes(2);
  });

  it('defaultOf volta à Principal se a conta API padrão ficou sem chave', () => {
    const key = DEFAULT_ACCOUNT_KEY('claude');
    expect(setup({ [key]: API }, 'stored').defaultOf('claude')).toBe(API);
    // Trancado não troca de conta: a abertura pede a senha.
    expect(setup({ [key]: API }, 'locked').defaultOf('claude')).toBe(API);
    expect(setup({ [key]: API }, 'missing').defaultOf('claude')).toBeNull();
  });

  it('waitsForVault: só a conta API com a chave guardada e o cofre trancado espera a senha', () => {
    expect(setup({}, 'locked').waitsForVault('claude', API)).toBe(true);
    for (const state of ['missing', 'stored', 'unreadable'] as const) {
      expect(setup({}, state).waitsForVault('claude', API)).toBe(false);
    }
    expect(setup({}, 'locked').waitsForVault('claude', A)).toBe(false);
    expect(setup({}, 'locked').waitsForVault('claude', null)).toBe(false);
    expect(setup({}, 'locked').waitsForVault('claude', GONE)).toBe(false);
  });

  it('kindOf e usableOf', () => {
    const use = setup();
    expect(use.kindOf('claude', API)).toBe('api');
    expect(use.kindOf('claude', A)).toBe('subscription');
    expect(use.kindOf('claude', null)).toBe('subscription');
    expect(use.kindOf('claude', NOBODY)).toBe('subscription');
    expect(use.usableOf('claude', A)).toBe(true);
    expect(use.usableOf('claude', null)).toBe(true);
    expect(use.usableOf('claude', API)).toBe(true);
    expect(use.usableOf('claude', GONE)).toBe(false);
    expect(setup({}, 'locked').usableOf('claude', API)).toBe(false);
    expect(setup({}, 'missing').usableOf('claude', API)).toBe(false);
  });
});

describe('conta em uso: a pasta de dados', () => {
  it('a Principal lê a pasta que o ambiente dos terminais aponta', () => {
    expect(setup().dataRootOf('claude', null)).toBe('C:/pessoa/.claude');
    expect(setup().dataRootOf('codex', null)).toBe('C:/pessoa/.codex');
  });

  it('a conta extra lê a pasta dela', () => {
    expect(setup().dataRootOf('claude', A)).toBe(join(ROOT, 'claude', A));
  });

  it('conta removida, desconhecida ou de outro programa não tem pasta', () => {
    expect(setup().dataRootOf('claude', GONE)).toBeUndefined();
    expect(setup().dataRootOf('claude', NOBODY)).toBeUndefined();
    expect(setup().dataRootOf('claude', CODEX)).toBeUndefined();
  });

  it('lista a Principal primeiro e depois as extras que existem', () => {
    expect(setup().listRoots('claude')).toEqual([
      { accountId: null, root: 'C:/pessoa/.claude' },
      { accountId: A, root: join(ROOT, 'claude', A) },
      // A conta API também tem pasta: as sessões dela aparecem como as das outras.
      { accountId: API, root: join(ROOT, 'claude', API) },
    ]);
  });
});

describe('conta em uso: o nome', () => {
  it('a Principal, a extra, a removida e a desconhecida', () => {
    const use = setup();
    expect(use.labelOf('claude', null)).toEqual({ name: 'Principal', removed: false });
    expect(use.labelOf('claude', A)).toEqual({ name: 'Trabalho', removed: false });
    expect(use.labelOf('claude', GONE)).toEqual({ name: 'Antiga', removed: true });
    expect(use.labelOf('claude', NOBODY)).toEqual({ name: '', removed: true });
    expect(use.labelOf('claude', CODEX)).toEqual({ name: '', removed: true });
  });

  it('só o Claude Code e o Codex têm conta', () => {
    const use = setup();
    expect(use.isAccountProvider('claude')).toBe(true);
    expect(use.isAccountProvider('codex')).toBe(true);
    expect(use.isAccountProvider('shell')).toBe(false);
    expect(use.isAccountProvider('opencode')).toBe(false);
  });

  it('diz se o programa tem mais de uma conta', () => {
    const use = setup();
    expect(use.hasExtras('claude')).toBe(true);
  });
});
