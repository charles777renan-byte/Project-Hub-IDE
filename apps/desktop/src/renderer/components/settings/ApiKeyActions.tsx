import { useState } from 'react';
import type { AccountDto, AppResult } from '@project-hub/contracts';
import { ConfirmInline } from '../ConfirmButton';

const TEXT = {
  paste: 'Colar chave da área de transferência',
  replace: 'Trocar chave',
  remove: 'Remover chave',
  savedBefore: 'Chave guardada, terminada em ',
  savedAfter: '. Confira se é a chave certa.',
  winV: 'Apague a chave do histórico da área de transferência do Windows (Win+V), se ele estiver ligado.',
  replaceQuestion: 'Copie a chave nova no site do serviço e confirme: ela entra no lugar desta.',
  removeQuestion: 'Remover a chave apaga a chave guardada desta conta neste computador.',
  panels: (names: string[]) =>
    `Os painéis abertos desta conta continuam com a chave antiga até serem fechados: ${names.join(', ')}.`,
  panelsUnknown: 'Os painéis abertos desta conta continuam com a chave antiga até serem fechados.',
  revoke: 'Para a chave antiga parar de valer, revogue-a no site do serviço.',
  defaultBack: (program: string) =>
    `Esta é a conta padrão do ${program}. A padrão volta a ser a Principal.`,
  failed: 'Não foi possível concluir a ação.',
} as const;

type Mode = 'idle' | 'replace' | 'remove';

/** Os nomes dos painéis abertos (não encerrados) desta conta, ou `null` quando a lista não pôde ser lida. */
async function openPanels(account: AccountDto): Promise<string[] | null> {
  try {
    const result = await window.projectHub.terminals.list();
    if (!result.ok) return null;
    return result.data
      .filter(
        (item) =>
          item.provider === account.provider &&
          item.accountId === account.id &&
          item.state !== 'exited',
      )
      .map((item) => item.title);
  } catch {
    return null;
  }
}

/** A pergunta de trocar ou remover: o que acontece, os painéis que seguem com a chave antiga e o lembrete de revogar. */
function questionOf(mode: 'replace' | 'remove', panels: string[] | null, extra: string | null) {
  const parts: string[] = [mode === 'replace' ? TEXT.replaceQuestion : TEXT.removeQuestion];
  if (panels === null) parts.push(TEXT.panelsUnknown);
  else if (panels.length > 0) parts.push(TEXT.panels(panels));
  parts.push(TEXT.revoke);
  if (extra !== null) parts.push(extra);
  return parts.join(' ');
}

/**
 * As ações da chave de uma conta API. A chave nunca passa pela tela: colar manda só o programa e o id da conta; o
 * processo principal lê a área de transferência, guarda a chave cifrada e devolve só os 4 últimos caracteres. Sem
 * chave (ou com uma que não abre), colar não pede confirmação. Trocar e remover pedem, e não são bloqueados por
 * painéis abertos: a pergunta diz quais seguem com a chave antiga.
 */
export function ApiKeyActions({
  account,
  program,
  onChanged,
}: {
  account: AccountDto;
  /** Nome do programa ("Claude Code"). */
  program: string;
  /** A chave mudou: a lista é relida. */
  onChanged: () => void;
}) {
  const [mode, setMode] = useState<Mode>('idle');
  const [question, setQuestion] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);

  const id = account.id;
  if (id === null) return null;
  const target = { provider: account.provider, accountId: id };
  const keyState = account.keyState ?? 'missing';
  const hasKey = keyState === 'stored' || keyState === 'locked';

  async function run<T>(action: () => Promise<AppResult<T>>): Promise<AppResult<T>> {
    setBusy(true);
    setError(null);
    let result: AppResult<T>;
    try {
      result = await action();
    } catch {
      result = { ok: false, error: { code: 'UNKNOWN', message: TEXT.failed, retryable: false } };
    }
    setBusy(false);
    setMode('idle');
    return result;
  }

  async function paste() {
    const result = await run(() => window.projectHub.accounts.pasteKey(target));
    if (result.ok) {
      setSaved(result.data.last4);
      onChanged();
    } else {
      setError(result.error.message);
    }
  }

  async function remove() {
    const result = await run(() => window.projectHub.accounts.removeKey(target));
    if (result.ok) {
      setSaved(null);
      onChanged();
    } else {
      setError(result.error.message);
    }
  }

  async function ask(next: 'replace' | 'remove') {
    setBusy(true);
    setError(null);
    const panels = await openPanels(account);
    const extra = next === 'remove' && account.isDefault ? TEXT.defaultBack(program) : null;
    setQuestion(questionOf(next, panels, extra));
    setBusy(false);
    setMode(next);
  }

  return (
    <div className="acct-key">
      {mode === 'idle' ? (
        <div className="acct-key__actions">
          {hasKey ? (
            <button
              type="button"
              className="btn-secondary"
              disabled={busy}
              onClick={() => void ask('replace')}
            >
              {TEXT.replace}
            </button>
          ) : (
            <button
              type="button"
              className="btn-primary"
              disabled={busy}
              onClick={() => void paste()}
            >
              {TEXT.paste}
            </button>
          )}
          {keyState === 'missing' ? null : (
            <button
              type="button"
              className="btn-ghost"
              disabled={busy}
              onClick={() => void ask('remove')}
            >
              {TEXT.remove}
            </button>
          )}
        </div>
      ) : null}
      {mode === 'replace' ? (
        <ConfirmInline
          question={question}
          confirmLabel={TEXT.replace}
          confirmTone="primary"
          disabled={busy}
          focusBack
          onConfirm={() => void paste()}
          onCancel={() => setMode('idle')}
        />
      ) : null}
      {mode === 'remove' ? (
        <ConfirmInline
          question={question}
          confirmLabel={TEXT.remove}
          disabled={busy}
          focusBack
          onConfirm={() => void remove()}
          onCancel={() => setMode('idle')}
        />
      ) : null}
      {saved === null ? null : (
        <div role="status" className="acct-key__saved">
          <p>
            {TEXT.savedBefore}
            <span className="acct-key__end">{`…${saved}`}</span>
            {TEXT.savedAfter}
          </p>
          <p>{TEXT.winV}</p>
        </div>
      )}
      {error === null ? null : (
        <p role="alert" className="acct__error settings__error">
          {error}
        </p>
      )}
    </div>
  );
}
