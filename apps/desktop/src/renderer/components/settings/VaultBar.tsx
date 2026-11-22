import { useRef, useState } from 'react';
import type { AccountDto, AppResult, VaultDto } from '@project-hub/contracts';
import { ConfirmInline } from '../ConfirmButton';
import { Ellipsis, ICON_PROPS, Lock, LockOpen } from '../Icon';
import { MenuAcoes, type AcaoMenu } from '../MenuAcoes';

const TEXT = {
  label: 'Cofre das chaves de API',
  locked: 'Cofre trancado',
  unlocked: 'Cofre destrancado',
  empty: 'Cofre sem senha',
  note: 'As chaves de API ficam cifradas neste computador, com a proteção do Windows e a senha do cofre.',
  emptyNote: 'A senha do cofre é criada ao colar a primeira chave.',
  unavailable:
    'A proteção do Windows que cifra a chave não está disponível neste computador: as chaves guardadas não abrem.',
  unlock: 'Destrancar',
  lock: 'Trancar cofre',
  menu: 'Mais ações do cofre',
  changePassword: 'Trocar senha',
  reset: 'Redefinir cofre',
  resetQuestion: (names: string[]) =>
    names.length === 0
      ? 'Redefinir o cofre apaga a senha. Nenhuma conta tem chave guardada.'
      : `Redefinir o cofre apaga a senha e todas as chaves guardadas. Ficam sem chave: ${names.join(', ')}. Depois, crie uma senha nova e cole as chaves de novo.`,
  changed: 'Senha trocada.',
  lost: (names: string[]) =>
    `Senha trocada. Ficaram sem chave: ${names.join(', ')}. Cole as chaves de novo.`,
  failed: 'Não foi possível concluir a ação.',
} as const;

/**
 * A barra do cofre, no alto da seção Contas quando existe conta API: o estado, Destrancar ou Trancar cofre, e no
 * menu Trocar senha e Redefinir cofre. A senha nunca passa pela tela: Destrancar e Trocar senha pedem ao processo
 * principal, que abre a janela do cofre e devolve só o desfecho. Redefinir pede confirmação na linha, com as contas
 * que ficam sem chave.
 */
export function VaultBar({
  vault,
  accounts,
  onChanged,
}: {
  vault: VaultDto;
  /** As contas API, para dizer quais ficam sem chave ao redefinir. */
  accounts: AccountDto[];
  /** O cofre mudou: a lista das contas é relida. */
  onChanged: () => void;
}) {
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  /** O item do menu abriu a pergunta nesta barra: o foco fica nela, e não volta ao botão do menu. */
  const keepFocus = useRef(false);

  async function run<T>(action: () => Promise<AppResult<T>>): Promise<AppResult<T> | null> {
    setBusy(true);
    setError(null);
    setNotice(null);
    let result: AppResult<T>;
    try {
      result = await action();
    } catch {
      result = { ok: false, error: { code: 'UNKNOWN', message: TEXT.failed, retryable: false } };
    }
    setBusy(false);
    if (!result.ok) {
      setError(result.error.message);
      return null;
    }
    return result;
  }

  async function unlock() {
    const result = await run(() => window.projectHub.vault.unlock());
    if (result?.ok && result.data.outcome === 'unlocked') onChanged();
  }

  async function lock() {
    const result = await run(() => window.projectHub.vault.lock());
    if (result !== null) onChanged();
  }

  async function changePassword() {
    const result = await run(() => window.projectHub.vault.changePassword());
    if (result?.ok && result.data.outcome === 'changed') {
      const lost = result.data.lost;
      const names = accounts.filter((account) => account.id !== null && lost.includes(account.id));
      setNotice(
        names.length === 0 ? TEXT.changed : TEXT.lost(names.map((account) => account.name)),
      );
      // As contas que perderam a chave mudam de estado na lista.
      if (lost.length > 0) onChanged();
    }
  }

  async function reset() {
    setConfirming(false);
    const result = await run(() => window.projectHub.vault.reset({ confirm: true }));
    if (result !== null) onChanged();
  }

  const affected = accounts
    .filter((account) => account.keyState !== undefined && account.keyState !== 'missing')
    .map((account) => account.name);
  const empty = vault.state === 'empty';
  const unlocked = vault.state === 'unlocked';
  const StateIcon = unlocked ? LockOpen : Lock;

  const actions: AcaoMenu[] = [
    { rotulo: TEXT.changePassword, onSelecionar: () => void changePassword() },
    {
      rotulo: TEXT.reset,
      perigosa: true,
      onSelecionar: () => {
        keepFocus.current = true;
        setError(null);
        setNotice(null);
        setConfirming(true);
      },
    },
  ];

  return (
    <div role="group" aria-label={TEXT.label} className="vault-bar">
      <div className="vault-bar__main">
        <span className={`acct__state vault-bar__state vault-bar__state--${vault.state}`}>
          <StateIcon {...ICON_PROPS} />
          {empty ? TEXT.empty : unlocked ? TEXT.unlocked : TEXT.locked}
        </span>
        <p className="vault-bar__note">{empty ? TEXT.emptyNote : TEXT.note}</p>
        {empty ? null : (
          <div className="acct__actions">
            {unlocked ? (
              <button
                type="button"
                className="btn-secondary"
                disabled={busy}
                onClick={() => void lock()}
              >
                {TEXT.lock}
              </button>
            ) : (
              <button
                type="button"
                className="btn-primary"
                disabled={busy}
                onClick={() => void unlock()}
              >
                {TEXT.unlock}
              </button>
            )}
            <MenuAcoes
              rotulo={TEXT.menu}
              icone={<Ellipsis {...ICON_PROPS} size={16} />}
              acoes={actions}
              aoFecharDevolverFoco={(event) => {
                if (!keepFocus.current) return;
                keepFocus.current = false;
                event.preventDefault();
              }}
            />
          </div>
        )}
      </div>
      {vault.available ? null : <p className="vault-bar__warn">{TEXT.unavailable}</p>}
      {confirming ? (
        <ConfirmInline
          question={TEXT.resetQuestion(affected)}
          confirmLabel={TEXT.reset}
          disabled={busy}
          focusBack
          onConfirm={() => void reset()}
          onCancel={() => setConfirming(false)}
        />
      ) : null}
      {notice === null ? null : (
        <p role="status" className="vault-bar__note">
          {notice}
        </p>
      )}
      {error === null ? null : (
        <p role="alert" className="acct__error settings__error">
          {error}
        </p>
      )}
    </div>
  );
}
