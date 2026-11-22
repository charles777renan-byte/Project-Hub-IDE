import { describe, expect, it, vi } from 'vitest';
import type { AppResult } from '@project-hub/contracts';
import type { AccountRecord } from '@project-hub/database';
import { DEFAULT_ACCOUNT_KEY } from '../../src/main/accounts/accounts-service';
import { VAULT_LOCKED, VAULT_UNAVAILABLE } from '../../src/main/accounts/account-vault';
import {
  API_KEY_ONLY_CLAUDE,
  createApiKeyService,
  NOT_API_ACCOUNT,
} from '../../src/main/accounts/api-key-service';

const API = '11111111-1111-4111-8111-111111111111';
const SUB = '22222222-2222-4222-8222-222222222222';
const GONE = '33333333-3333-4333-8333-333333333333';
const UNKNOWN = '44444444-4444-4444-8444-444444444444';
const T = '2026-11-21T10:00:00.000Z';
const KEY = 'sk-ant-api03-chave-falsa-0123456789-abcdefghijKLMNOPWXYZ';

const records: AccountRecord[] = [
  { id: API, provider: 'claude', name: 'API', createdAt: T, kind: 'api' },
  { id: SUB, provider: 'claude', name: 'Assinatura', createdAt: T, kind: 'subscription' },
  { id: GONE, provider: 'claude', name: 'Antiga', createdAt: T, removedAt: T, kind: 'api' },
];

function setup(
  options: {
    clipboard?: string | (() => string);
    vaultState?: 'empty' | 'locked' | 'unlocked';
    available?: boolean;
    unlockAnswer?: 'unlocked' | 'cancelled';
    defaultAccount?: string;
  } = {},
) {
  const state = { vault: options.vaultState ?? 'unlocked' };
  const reads: string[] = [];
  // Como a do Electron 44: a leitura da área de transferência é assíncrona, e uma falha rejeita.
  const readText = vi.fn((): Promise<string> => {
    try {
      const value = options.clipboard ?? KEY;
      const text = typeof value === 'function' ? value() : value;
      reads.push(text);
      return Promise.resolve(text);
    } catch (error) {
      return Promise.reject(error instanceof Error ? error : new Error('falha ao ler'));
    }
  });
  const clipboard = { readText, clear: vi.fn() };
  const vault = {
    status: () => ({ state: state.vault, available: options.available ?? true }),
    put: vi.fn((_id: string, key: string): AppResult<{ last4: string }> => ({
      ok: true,
      data: { last4: key.slice(-4) },
    })),
    remove: vi.fn(),
  };
  const ensureUnlocked = vi.fn(() => {
    const answer = options.unlockAnswer ?? 'unlocked';
    if (answer === 'unlocked') state.vault = 'unlocked';
    return Promise.resolve(answer);
  });
  const settings = {
    get: vi.fn((key: string) =>
      key === DEFAULT_ACCOUNT_KEY('claude') ? options.defaultAccount : undefined,
    ),
    remove: vi.fn(),
  };
  const approval = {
    grant: vi.fn(() => Promise.resolve(true)),
    revoke: vi.fn(() => Promise.resolve(true)),
  };
  const service = createApiKeyService({
    accounts: { get: (id) => records.find((record) => record.id === id) },
    settings,
    vault,
    clipboard,
    ensureUnlocked,
    approval,
  });
  return { service, clipboard, vault, ensureUnlocked, settings, approval, reads };
}

function messageOf(result: AppResult<unknown>): string {
  if (result.ok) throw new Error('esperava falha');
  return result.error.message;
}

describe('colar a chave de API', () => {
  it('forma certa: guarda aparada e devolve só os 4 últimos', async () => {
    const h = setup({ clipboard: `  ${KEY}\r\n` });

    const result = await h.service.paste({ provider: 'claude', accountId: API });

    expect(result).toEqual({ ok: true, data: { last4: 'WXYZ' } });
    expect(h.vault.put).toHaveBeenCalledWith(API, KEY);
    expect(h.approval.grant).toHaveBeenCalledWith(API, KEY);
    expect(h.clipboard.clear).toHaveBeenCalledTimes(1);
  });

  it('forma errada: nada é guardado e a área de transferência fica como estava', async () => {
    const h = setup({ clipboard: 'sk-proj-' + 'a'.repeat(40) });

    const result = await h.service.paste({ provider: 'claude', accountId: API });

    expect(messageOf(result)).toBe(
      'A área de transferência não tem uma chave de API da Anthropic.',
    );
    expect(h.vault.put).not.toHaveBeenCalled();
    expect(h.approval.grant).not.toHaveBeenCalled();
    expect(h.clipboard.clear).not.toHaveBeenCalled();
  });

  it('limpa a área de transferência só se ela ainda tem a mesma chave', async () => {
    let calls = 0;
    const h = setup({
      clipboard: () => {
        calls += 1;
        return calls === 1 ? KEY : 'outra coisa que a pessoa copiou';
      },
    });

    const result = await h.service.paste({ provider: 'claude', accountId: API });

    expect(result.ok).toBe(true);
    expect(h.clipboard.clear).not.toHaveBeenCalled();
  });

  it('área de transferência vazia ou sem texto: mesma recusa, sem exceção', async () => {
    const empty = setup({ clipboard: '' });
    const failing = setup({
      clipboard: () => {
        throw new Error('formato sem texto');
      },
    });

    const fromEmpty = await empty.service.paste({ provider: 'claude', accountId: API });
    const fromFailing = await failing.service.paste({ provider: 'claude', accountId: API });

    expect(messageOf(fromEmpty)).toBe(messageOf(fromFailing));
    expect(empty.vault.put).not.toHaveBeenCalled();
    expect(failing.vault.put).not.toHaveBeenCalled();
  });

  it('conta de assinatura, removida, desconhecida ou de outro programa é recusada', async () => {
    const h = setup();

    expect(messageOf(await h.service.paste({ provider: 'claude', accountId: SUB }))).toBe(
      NOT_API_ACCOUNT,
    );
    expect(messageOf(await h.service.paste({ provider: 'claude', accountId: GONE }))).toBe(
      'A conta foi removida.',
    );
    expect(messageOf(await h.service.paste({ provider: 'claude', accountId: UNKNOWN }))).toBe(
      'A conta foi removida.',
    );
    expect(messageOf(await h.service.paste({ provider: 'codex', accountId: API }))).toBe(
      API_KEY_ONLY_CLAUDE,
    );
    // Nada disso lê a área de transferência.
    expect(h.clipboard.readText).not.toHaveBeenCalled();
    expect(h.vault.put).not.toHaveBeenCalled();
  });

  it('cofre vazio ou trancado: pede para destrancar; cancelado não guarda nada', async () => {
    const cancelled = setup({ vaultState: 'locked', unlockAnswer: 'cancelled' });
    const empty = setup({ vaultState: 'empty' });

    const fromCancelled = await cancelled.service.paste({ provider: 'claude', accountId: API });
    const fromEmpty = await empty.service.paste({ provider: 'claude', accountId: API });

    expect(messageOf(fromCancelled)).toBe(VAULT_LOCKED);
    expect(cancelled.clipboard.readText).not.toHaveBeenCalled();
    expect(cancelled.vault.put).not.toHaveBeenCalled();
    expect(empty.ensureUnlocked).toHaveBeenCalledTimes(1);
    expect(fromEmpty).toEqual({ ok: true, data: { last4: 'WXYZ' } });
  });

  it('sem a proteção do Windows, recusa antes de ler a área de transferência', async () => {
    const h = setup({ available: false });

    expect(messageOf(await h.service.paste({ provider: 'claude', accountId: API }))).toBe(
      VAULT_UNAVAILABLE,
    );
    expect(h.clipboard.readText).not.toHaveBeenCalled();
    expect(h.ensureUnlocked).not.toHaveBeenCalled();
  });

  it('a aprovação que não pôde ser gravada não desfaz a chave guardada', async () => {
    const h = setup();
    h.approval.grant.mockResolvedValueOnce(false);

    const result = await h.service.paste({ provider: 'claude', accountId: API });

    expect(result).toEqual({ ok: true, data: { last4: 'WXYZ' } });
  });

  it('nenhum erro carrega o texto lido', async () => {
    const admin = 'sk-ant-admin01-segredo-' + 'x'.repeat(30);
    const messages: string[] = [];
    for (const clipboard of [
      admin,
      'sk-proj-segredo-' + 'y'.repeat(30),
      'texto qualquer secreto',
    ]) {
      const h = setup({ clipboard });
      const result = await h.service.paste({ provider: 'claude', accountId: API });
      messages.push(JSON.stringify(result));
    }

    for (const message of messages) {
      expect(message).not.toContain('segredo');
      expect(message).not.toContain('secreto');
    }
  });
});

describe('remover a chave de API', () => {
  it('apaga a chave e tira a aprovação', async () => {
    const h = setup();

    const result = await h.service.remove({ provider: 'claude', accountId: API });

    expect(result).toEqual({ ok: true, data: undefined });
    expect(h.vault.remove).toHaveBeenCalledWith(API);
    expect(h.approval.revoke).toHaveBeenCalledWith(API);
    expect(h.settings.remove).not.toHaveBeenCalled();
  });

  it('remover a chave da conta padrão devolve a padrão à Principal', async () => {
    const h = setup({ defaultAccount: API });

    await h.service.remove({ provider: 'claude', accountId: API });

    expect(h.settings.remove).toHaveBeenCalledWith(DEFAULT_ACCOUNT_KEY('claude'));
  });

  it('não precisa destrancar o cofre, e recusa conta que não é API', async () => {
    const h = setup({ vaultState: 'locked' });

    expect((await h.service.remove({ provider: 'claude', accountId: API })).ok).toBe(true);
    expect(messageOf(await h.service.remove({ provider: 'claude', accountId: SUB }))).toBe(
      NOT_API_ACCOUNT,
    );
    expect(h.ensureUnlocked).not.toHaveBeenCalled();
  });
});
