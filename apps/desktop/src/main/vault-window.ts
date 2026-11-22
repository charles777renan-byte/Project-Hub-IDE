import type { ChangePasswordResult } from '@project-hub/contracts';
import { z } from 'zod';
import type { AccountVault } from './accounts/account-vault';
import { VAULT_PROMPT_CHANNELS, type VaultPromptMode } from './vault-prompt-channels';

export { VAULT_PROMPT_CHANNELS, type VaultPromptMode } from './vault-prompt-channels';

export type VaultWindow = {
  /** Abre a janela no modo certo e resolve quando o cofre destranca ou a pessoa cancela. Uma janela por vez. */
  ensureUnlocked(): Promise<'unlocked' | 'cancelled'>;
  changePassword(): Promise<ChangePasswordResult>;
};

/** A janela aberta, vista daqui: quem é o remetente dela, como fechá-la e o aviso de que fechou. */
export type PromptWindowHandle = {
  webContentsId: number;
  close(): void;
  onClosed(listener: () => void): void;
};

type PromptEvent = { sender: { id: number } };

export type VaultWindowDeps = {
  vault: Pick<AccountVault, 'status' | 'create' | 'unlock' | 'changePassword'>;
  /** Abre a janela de verdade, já com a página e o preload do cofre. Injetável para os testes. */
  open(mode: VaultPromptMode): PromptWindowHandle;
  ipc: {
    handle(channel: string, listener: (event: PromptEvent, payload: unknown) => unknown): void;
    removeHandler(channel: string): void;
  };
};

export type VaultPromptReply = { ok: true } | { ok: false; message: string };

const PASSWORD_MAX = 1024;
const passwordSchema = z.string().min(1).max(PASSWORD_MAX);
const submitSchema = z.strictObject({ password: passwordSchema, next: passwordSchema.optional() });

type Outcome = 'done' | 'cancelled';
/** `lost`: na troca de senha, as contas cuja chave não abria e foi apagada. */
type Session = { mode: VaultPromptMode; done: Promise<Outcome>; lost?: string[] };

export function createVaultWindow(deps: VaultWindowDeps): VaultWindow {
  let current: Session | undefined;

  function run(mode: VaultPromptMode): Session {
    let settle: (outcome: Outcome) => void = () => undefined;
    const done = new Promise<Outcome>((resolve) => {
      settle = resolve;
    });
    const session: Session = { mode, done };
    current = session;

    const handle = deps.open(mode);
    let finished = false;
    let busy = false;

    const finish = (outcome: Outcome): void => {
      if (finished) return;
      finished = true;
      for (const channel of Object.values(VAULT_PROMPT_CHANNELS)) deps.ipc.removeHandler(channel);
      if (current === session) current = undefined;
      settle(outcome);
      handle.close();
    };

    /** Só a janela do cofre fala nestes canais; qualquer outro remetente é recusado. */
    const fromPrompt = (event: PromptEvent): void => {
      if (finished || event.sender.id !== handle.webContentsId) {
        throw new Error('Pedido recusado.');
      }
    };

    deps.ipc.handle(VAULT_PROMPT_CHANNELS.state, (event) => {
      fromPrompt(event);
      const { retryAt } = deps.vault.status();
      return { mode, ...(retryAt !== undefined ? { retryAt } : {}) };
    });

    deps.ipc.handle(
      VAULT_PROMPT_CHANNELS.submit,
      async (event, payload): Promise<VaultPromptReply> => {
        fromPrompt(event);
        const input = submitSchema.parse(payload);
        if ((mode === 'change') !== (input.next !== undefined)) throw new Error('Pedido recusado.');
        if (busy) throw new Error('Pedido recusado.');
        busy = true;
        try {
          if (mode === 'change') {
            const changed = await deps.vault.changePassword(input.password, input.next ?? '');
            if (!changed.ok) return { ok: false, message: changed.error.message };
            session.lost = changed.data.lost;
          } else {
            const result =
              mode === 'create'
                ? await deps.vault.create(input.password)
                : await deps.vault.unlock(input.password);
            if (!result.ok) return { ok: false, message: result.error.message };
          }
          finish('done');
          return { ok: true };
        } finally {
          busy = false;
        }
      },
    );

    deps.ipc.handle(VAULT_PROMPT_CHANNELS.cancel, (event) => {
      fromPrompt(event);
      finish('cancelled');
    });

    handle.onClosed(() => finish('cancelled'));
    return session;
  }

  /**
   * Destrancar: junta-se à janela de destrancar ou criar que já está aberta. Com a janela de troca aberta, espera
   * ela fechar e decide de novo. A decisão e a abertura acontecem na mesma volta: duas chamadas seguidas nunca
   * abrem duas janelas.
   */
  function ensureUnlocked(): Promise<'unlocked' | 'cancelled'> {
    if (current !== undefined) {
      const { mode, done } = current;
      if (mode !== 'change')
        return done.then((outcome) => (outcome === 'done' ? 'unlocked' : 'cancelled'));
      return done.then(() => ensureUnlocked());
    }
    const { state } = deps.vault.status();
    if (state === 'unlocked') return Promise.resolve('unlocked');
    return run(state === 'empty' ? 'create' : 'unlock').done.then((outcome) =>
      outcome === 'done' ? 'unlocked' : 'cancelled',
    );
  }

  /** O desfecho da troca, com as contas que ficaram sem chave. */
  function changeOutcome(session: Session): Promise<ChangePasswordResult> {
    return session.done.then((outcome) =>
      outcome === 'done'
        ? { outcome: 'changed', lost: session.lost ?? [] }
        : { outcome: 'cancelled' },
    );
  }

  function changePassword(): Promise<ChangePasswordResult> {
    if (current !== undefined) {
      if (current.mode === 'change') return changeOutcome(current);
      return current.done.then(() => changePassword());
    }
    // Sem cofre criado não há senha para trocar.
    if (deps.vault.status().state === 'empty') return Promise.resolve({ outcome: 'cancelled' });
    return changeOutcome(run('change'));
  }

  return { ensureUnlocked, changePassword };
}
