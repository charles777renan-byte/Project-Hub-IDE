import { describe, expect, it } from 'vitest';
import {
  accountDtoSchema,
  accountTargetInputSchema,
  addAccountInputSchema,
  appInfoDtoSchema,
  loginDtoSchema,
  loginEventSchema,
  loginWriteInputSchema,
  pasteKeyResultSchema,
  removeAccountInputSchema,
  renameAccountInputSchema,
} from '../src';

const ID = '11111111-1111-4111-8111-111111111111';

describe('contas: entradas', () => {
  it('o nome é aparado e aceita 1 a 40 caracteres', () => {
    expect(
      addAccountInputSchema.parse({
        provider: 'claude',
        name: '  Trabalho  ',
        kind: 'subscription',
      }),
    ).toEqual({
      provider: 'claude',
      name: 'Trabalho',
      kind: 'subscription',
    });
    expect(
      addAccountInputSchema.safeParse({ provider: 'claude', name: '   ', kind: 'subscription' })
        .success,
    ).toBe(false);
    expect(
      addAccountInputSchema.safeParse({
        provider: 'claude',
        name: 'a'.repeat(41),
        kind: 'subscription',
      }).success,
    ).toBe(false);
    expect(
      addAccountInputSchema.safeParse({ provider: 'claude', name: 'a'.repeat(40), kind: 'api' })
        .success,
    ).toBe(true);
  });

  it('as entradas recusam campo a mais', () => {
    expect(
      addAccountInputSchema.safeParse({
        provider: 'claude',
        name: 'x',
        kind: 'subscription',
        path: 'C:/',
      }).success,
    ).toBe(false);
    expect(
      renameAccountInputSchema.safeParse({ accountId: ID, name: 'x', command: 'rm' }).success,
    ).toBe(false);
    expect(
      accountTargetInputSchema.safeParse({ provider: 'claude', accountId: null, env: {} }).success,
    ).toBe(false);
    expect(
      removeAccountInputSchema.safeParse({ accountId: ID, force: false, folder: 'x' }).success,
    ).toBe(false);
  });

  it('o programa só aceita os que têm contas', () => {
    expect(
      addAccountInputSchema.safeParse({ provider: 'shell', name: 'x', kind: 'subscription' })
        .success,
    ).toBe(false);
    expect(
      addAccountInputSchema.safeParse({ provider: 'codex', name: 'x', kind: 'subscription' })
        .success,
    ).toBe(true);
  });

  it('o tipo da conta é obrigatório e só assinatura ou API', () => {
    expect(addAccountInputSchema.safeParse({ provider: 'claude', name: 'x' }).success).toBe(false);
    expect(
      addAccountInputSchema.safeParse({ provider: 'claude', name: 'x', kind: 'token' }).success,
    ).toBe(false);
  });

  it('a entrada de colar leva só programa e id; campo a mais é recusado', () => {
    expect(
      accountTargetInputSchema.safeParse({ provider: 'claude', accountId: ID, key: 'sk-ant-x' })
        .success,
    ).toBe(false);
  });

  it('o alvo aceita conta nula e recusa id que não é UUID', () => {
    expect(accountTargetInputSchema.safeParse({ provider: 'codex', accountId: null }).success).toBe(
      true,
    );
    expect(accountTargetInputSchema.safeParse({ provider: 'codex', accountId: ID }).success).toBe(
      true,
    );
    expect(
      accountTargetInputSchema.safeParse({ provider: 'codex', accountId: '../../x' }).success,
    ).toBe(false);
    expect(removeAccountInputSchema.safeParse({ accountId: null, force: false }).success).toBe(
      false,
    );
  });

  it('a digitação no terminal do login tem teto', () => {
    expect(loginWriteInputSchema.safeParse({ data: 'a'.repeat(16_384) }).success).toBe(true);
    expect(loginWriteInputSchema.safeParse({ data: 'a'.repeat(16_385) }).success).toBe(false);
  });
});

describe('contas: saídas', () => {
  const login = {
    provider: 'claude',
    accountId: ID,
    phase: 'browser',
    host: 'claude.ai',
    expiresAt: '2026-11-21T10:10:00.000Z',
  };

  it('o DTO de login não tem campo de endereço', () => {
    expect(loginDtoSchema.safeParse(login).success).toBe(true);
    expect(loginDtoSchema.safeParse({ ...login, url: 'https://claude.ai/x' }).success).toBe(false);
  });

  it('o evento de login é o estado ou um trecho da saída', () => {
    expect(loginEventSchema.safeParse({ type: 'state', login }).success).toBe(true);
    expect(loginEventSchema.safeParse({ type: 'state', login: null }).success).toBe(true);
    expect(loginEventSchema.safeParse({ type: 'data', data: 'abc' }).success).toBe(true);
    expect(loginEventSchema.safeParse({ type: 'outro' }).success).toBe(false);
  });

  it('a conta recusa campo a mais, como um caminho', () => {
    const account = {
      id: null,
      provider: 'claude',
      name: 'Principal',
      isPrincipal: true,
      isDefault: true,
      state: 'connected',
      identity: 'voce@exemplo.com',
      kind: 'subscription',
    };
    expect(accountDtoSchema.safeParse(account).success).toBe(true);
    expect(accountDtoSchema.safeParse({ ...account, folder: 'C:/x' }).success).toBe(false);
  });

  const api = {
    id: ID,
    provider: 'claude',
    name: 'API',
    isPrincipal: false,
    isDefault: false,
    state: 'connected',
    kind: 'api',
  };

  it('conta de assinatura não aceita keyState nem keyLast4', () => {
    const subscription = { ...api, kind: 'subscription' };
    expect(accountDtoSchema.safeParse(subscription).success).toBe(true);
    expect(accountDtoSchema.safeParse({ ...subscription, keyState: 'stored' }).success).toBe(false);
    expect(accountDtoSchema.safeParse({ ...subscription, keyLast4: 'ab12' }).success).toBe(false);
  });

  it('conta API aceita keyState e keyLast4 de 4 caracteres', () => {
    expect(
      accountDtoSchema.safeParse({ ...api, keyState: 'stored', keyLast4: 'ab12' }).success,
    ).toBe(true);
    expect(accountDtoSchema.safeParse({ ...api, keyState: 'missing' }).success).toBe(true);
    expect(accountDtoSchema.safeParse({ ...api, keyState: 'outro' }).success).toBe(false);
    expect(accountDtoSchema.safeParse({ ...api, keyLast4: 'ab123' }).success).toBe(false);
    expect(accountDtoSchema.safeParse({ ...api, kind: undefined }).success).toBe(false);
  });

  it('o resultado de colar não aceita mais que 4 caracteres', () => {
    expect(pasteKeyResultSchema.safeParse({ last4: 'ab12' }).success).toBe(true);
    expect(pasteKeyResultSchema.safeParse({ last4: 'sk-ant-ab12' }).success).toBe(false);
    expect(pasteKeyResultSchema.safeParse({ last4: 'ab12', key: 'x' }).success).toBe(false);
  });

  it('as informações do app têm versão e pasta de dados', () => {
    expect(appInfoDtoSchema.safeParse({ version: '0.1.0', dataDir: 'C:/dados' }).success).toBe(
      true,
    );
    expect(appInfoDtoSchema.safeParse({ version: '0.1.0' }).success).toBe(false);
  });
});
