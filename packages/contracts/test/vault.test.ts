import { describe, expect, it } from 'vitest';
import {
  CHANNELS,
  ERROR_CODES,
  unlockResultSchema,
  vaultDtoSchema,
  vaultResetInputSchema,
} from '../src';

describe('cofre: contratos', () => {
  it('o cofre trancado tem código de erro próprio, para os lançadores o distinguirem', () => {
    expect(ERROR_CODES).toContain('VAULT_LOCKED');
  });

  it('vaultDto é estrito', () => {
    expect(vaultDtoSchema.safeParse({ state: 'locked', available: true }).success).toBe(true);
    expect(
      vaultDtoSchema.safeParse({
        state: 'locked',
        available: true,
        retryAt: '2026-11-21T10:00:02.000Z',
      }).success,
    ).toBe(true);
    expect(vaultDtoSchema.safeParse({ state: 'aberto', available: true }).success).toBe(false);
    expect(
      vaultDtoSchema.safeParse({ state: 'unlocked', available: true, password: 'x' }).success,
    ).toBe(false);
  });

  it('o resultado de destrancar é destrancado ou cancelado, sem mais nada', () => {
    expect(unlockResultSchema.safeParse({ outcome: 'unlocked' }).success).toBe(true);
    expect(unlockResultSchema.safeParse({ outcome: 'cancelled' }).success).toBe(true);
    expect(unlockResultSchema.safeParse({ outcome: 'unlocked', key: 'x' }).success).toBe(false);
  });

  it('redefinir o cofre exige confirm: true, e nada mais', () => {
    expect(vaultResetInputSchema.safeParse({ confirm: true }).success).toBe(true);
    expect(vaultResetInputSchema.safeParse({}).success).toBe(false);
    expect(vaultResetInputSchema.safeParse({ confirm: false }).success).toBe(false);
    expect(vaultResetInputSchema.safeParse({ confirm: true, password: 'x' }).success).toBe(false);
  });

  it('os canais do cofre e da chave existem, e nenhum é da senha', () => {
    expect(CHANNELS).toMatchObject({
      accountsPasteKey: 'accounts:paste-key:v1',
      accountsRemoveKey: 'accounts:remove-key:v1',
      vaultGet: 'vault:get:v1',
      vaultUnlock: 'vault:unlock:v1',
      vaultLock: 'vault:lock:v1',
      vaultChangePassword: 'vault:change-password:v1',
      vaultReset: 'vault:reset:v1',
      vaultChanged: 'vault:changed:v1',
    });
    // A senha só passa pelos canais da janela própria do cofre, fora de CHANNELS.
    expect(Object.values(CHANNELS).some((channel) => channel.includes('password-submit'))).toBe(
      false,
    );
  });
});
