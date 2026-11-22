import { failure } from '@project-hub/application';
import {
  CHANNELS,
  vaultResetInputSchema,
  type AppResult,
  type VaultDto,
} from '@project-hub/contracts';
import type { AccountVault } from '../accounts/account-vault';
import type { VaultWindow } from '../vault-window';
import {
  registerTrustedHandler,
  validated,
  type IpcRegistry,
  type SenderCheck,
} from './trusted-handler';

export type VaultIpcDeps = {
  vault: Pick<AccountVault, 'status' | 'lock' | 'reset'>;
  window: VaultWindow;
};

const DONE: AppResult<undefined> = { ok: true, data: undefined };
const NO_INPUT = 'Este pedido não recebe dados da tela.';

/** O estado do cofre na forma do contrato: nada além do estado, da disponibilidade e da espera. */
export function vaultDtoOf(status: ReturnType<AccountVault['status']>): VaultDto {
  return {
    state: status.state,
    available: status.available,
    ...(status.retryAt === undefined ? {} : { retryAt: status.retryAt }),
  };
}

/**
 * Liga os canais do cofre. Nenhum leva senha nem chave: destrancar e trocar a senha só abrem a janela do cofre e
 * devolvem o desfecho, e por isso recusam qualquer dado da tela. Redefinir exige `{ confirm: true }` estrito. Todos
 * recusam remetente de outra origem (R65).
 */
export function registerVaultHandlers(
  registry: IpcRegistry,
  isTrusted: SenderCheck,
  deps: VaultIpcDeps,
): void {
  const { vault, window } = deps;
  const on = (
    channel: string,
    run: (event: unknown, payload: unknown) => Promise<AppResult<unknown>>,
  ): void => registerTrustedHandler(registry, channel, isTrusted, run);
  /** Pedido sem dado da tela: qualquer coisa no lugar do vazio é recusada. */
  const bare =
    (run: () => Promise<AppResult<unknown>>) =>
    (_event: unknown, payload: unknown): Promise<AppResult<unknown>> =>
      payload === undefined ? run() : Promise.resolve(failure('VALIDATION_FAILED', NO_INPUT));

  on(
    CHANNELS.vaultGet,
    bare(() => Promise.resolve({ ok: true, data: vaultDtoOf(vault.status()) })),
  );
  on(
    CHANNELS.vaultUnlock,
    bare(async () => ({ ok: true, data: { outcome: await window.ensureUnlocked() } })),
  );
  on(
    CHANNELS.vaultLock,
    bare(() => {
      vault.lock();
      return Promise.resolve(DONE);
    }),
  );
  on(
    CHANNELS.vaultChangePassword,
    bare(async () => ({ ok: true, data: await window.changePassword() })),
  );
  on(
    CHANNELS.vaultReset,
    validated(vaultResetInputSchema, () => {
      vault.reset();
      return Promise.resolve(DONE);
    }),
  );
}
