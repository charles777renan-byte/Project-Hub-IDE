import { useState, type FormEvent } from 'react';
import { ACCOUNT_NAME_MAX } from '@project-hub/contracts/account-name';

const TEXT = {
  field: 'Nome da conta',
  placeholder: 'Trabalho, Pessoal, Cliente…',
  cancel: 'Cancelar',
} as const;

/**
 * O campo do nome de uma conta, para criar ou renomear. `onSubmit` devolve a mensagem da falha (o nome repetido,
 * por exemplo), que aparece junto do campo sem apagar o que foi digitado, ou `null` quando deu certo.
 */
export function AccountNameForm({
  initial = '',
  submitLabel,
  onSubmit,
  onCancel,
}: {
  initial?: string;
  submitLabel: string;
  onSubmit: (name: string) => Promise<string | null>;
  onCancel: () => void;
}) {
  const [name, setName] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const trimmed = name.trim();

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (trimmed === '' || busy) return;
    setBusy(true);
    setError(null);
    const failure = await onSubmit(trimmed);
    setBusy(false);
    if (failure !== null) setError(failure);
  }

  return (
    <form className="acct-form" onSubmit={(event) => void submit(event)}>
      <input
        type="text"
        className="settings-row__input"
        aria-label={TEXT.field}
        placeholder={TEXT.placeholder}
        maxLength={ACCOUNT_NAME_MAX}
        autoFocus
        value={name}
        onChange={(event) => setName(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Escape') onCancel();
        }}
      />
      <button type="submit" className="btn-primary" disabled={trimmed === '' || busy}>
        {submitLabel}
      </button>
      <button type="button" className="btn-ghost" disabled={busy} onClick={onCancel}>
        {TEXT.cancel}
      </button>
      {error === null ? null : (
        <p role="alert" className="acct-form__error settings__error">
          {error}
        </p>
      )}
    </form>
  );
}
