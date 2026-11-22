import { z } from 'zod';
import { accountIdSchema } from './accounts';

/**
 * O cofre das chaves de API. `empty`: nenhuma senha criada ainda. Nasce trancado a cada abertura do app. A senha
 * nunca passa por estes contratos: ela é digitada numa janela própria, com canais próprios.
 */
export const VAULT_STATES = ['empty', 'locked', 'unlocked'] as const;
export type VaultState = (typeof VAULT_STATES)[number];

/**
 * O estado do cofre na tela. `available`: a proteção do Windows funciona (sem ela, conta API não é criada).
 * `retryAt`: depois de erros seguidos de senha, quando a próxima tentativa é aceita (ISO).
 */
export const vaultDtoSchema = z.strictObject({
  state: z.enum(VAULT_STATES),
  available: z.boolean(),
  retryAt: z.string().optional(),
});
export type VaultDto = z.infer<typeof vaultDtoSchema>;

/** Resultado de pedir para destrancar: a pessoa digitou a senha certa, ou fechou a janela. */
export const unlockResultSchema = z.strictObject({ outcome: z.enum(['unlocked', 'cancelled']) });
export type UnlockResult = z.infer<typeof unlockResultSchema>;

/**
 * Resultado de trocar a senha: trocada, ou a pessoa fechou a janela. `lost`: as contas cuja chave não abria e foi
 * apagada na troca.
 */
export const changePasswordResultSchema = z.discriminatedUnion('outcome', [
  z.strictObject({ outcome: z.literal('changed'), lost: z.array(accountIdSchema).max(256) }),
  z.strictObject({ outcome: z.literal('cancelled') }),
]);
export type ChangePasswordResult = z.infer<typeof changePasswordResultSchema>;

/** Entrada de `vault:reset:v1`: apaga a senha e todas as chaves. Só com a confirmação explícita. */
export const vaultResetInputSchema = z.strictObject({ confirm: z.literal(true) });
export type VaultResetInput = z.infer<typeof vaultResetInputSchema>;
