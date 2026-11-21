import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { AccountRecord } from '@project-hub/database';
import { createAccountPaths } from '../../src/main/accounts/account-paths';
import { createAccountUse } from '../../src/main/accounts/account-use';
import { DEFAULT_ACCOUNT_KEY } from '../../src/main/accounts/accounts-service';

const A = '11111111-1111-4111-8111-111111111111';
const GONE = '22222222-2222-4222-8222-222222222222';
const CODEX = '33333333-3333-4333-8333-333333333333';
const NOBODY = '44444444-4444-4444-8444-444444444444';
const ROOT = join('C:', 'dados', 'accounts');
const T = '2026-11-21T10:00:00.000Z';

function setup(defaults: Record<string, string> = {}) {
  const rows: AccountRecord[] = [
    { id: A, provider: 'claude', name: 'Trabalho', createdAt: T },
    { id: GONE, provider: 'claude', name: 'Antiga', createdAt: T, removedAt: T },
    { id: CODEX, provider: 'codex', name: 'Estudo', createdAt: T },
  ];
  const accounts = {
    get: (id: string) => rows.find((row) => row.id === id),
    list: (provider: string) =>
      rows.filter((row) => row.provider === provider && row.removedAt === undefined),
  };
  const settings = { get: (key: string) => defaults[key] };
  const paths = createAccountPaths({ root: ROOT, accounts });
  return createAccountUse({
    accounts,
    settings,
    paths,
    env: { CLAUDE_CONFIG_DIR: 'C:/pessoa/.claude', CODEX_HOME: 'C:/pessoa/.codex' },
  });
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
  it('a Principal não leva variável nenhuma', () => {
    expect(setup().launchEnv('claude', null)).toEqual({ ok: true, data: {} });
  });

  it('a conta extra leva a variável do programa apontando para a pasta dela', () => {
    expect(setup().launchEnv('claude', A)).toEqual({
      ok: true,
      data: { CLAUDE_CONFIG_DIR: join(ROOT, 'claude', A) },
    });
    expect(setup().launchEnv('codex', CODEX)).toEqual({
      ok: true,
      data: { CODEX_HOME: join(ROOT, 'codex', CODEX) },
    });
  });

  it('conta removida, desconhecida, de outro programa ou com id inválido falha, e nunca devolve ambiente vazio', () => {
    for (const id of [GONE, NOBODY, CODEX, 'x']) {
      const result = setup().launchEnv('claude', id);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.message).toBe('A conta foi removida.');
    }
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
