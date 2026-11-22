import { useId, useRef, useState, type FormEvent, type KeyboardEvent } from 'react';
import type { AccountKind, VaultDto } from '@project-hub/contracts';
import { ACCOUNT_NAME_MAX } from '@project-hub/contracts/account-name';
import { Coins, ICON_PROPS, KeyRound, LogIn, ShieldAlert, type LucideIcon } from '../Icon';

const TEXT = {
  field: 'Nome da conta',
  placeholder: 'Trabalho, Pessoal, Cliente…',
  cancel: 'Cancelar',
} as const;

/**
 * O campo do nome de uma conta, para renomear. `onSubmit` devolve a mensagem da falha (o nome repetido, por exemplo),
 * que aparece junto do campo sem apagar o que foi digitado, ou `null` quando deu certo.
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

const ADD_TEXT = {
  title: (program: string) => `Nova conta do ${program}`,
  group: 'Tipo da conta',
  subscription: 'Assinatura',
  subscriptionNote: 'O login é feito no próprio programa e usa o limite do seu plano.',
  api: 'Chave de API',
  apiNote: 'Cobrança por uso. A chave fica cifrada no cofre deste computador.',
  unavailable: 'A proteção do Windows que cifra a chave não está disponível neste computador.',
  notes: 'Antes de usar uma chave de API',
  risk: 'O programa e os comandos que ele executa têm acesso à chave. Use uma chave só para este computador, com limite de gasto definido no site do serviço. Se suspeitar de vazamento, revogue a chave no site.',
  billing:
    'Esta conta cobra por uso, sem o teto de uma assinatura. Missões longas podem custar caro.',
} as const;

const ARROWS = new Set(['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown']);

/**
 * Criar uma conta, num painel próprio dentro do programa: o tipo (só no programa que aceita chave de API), o nome e as
 * ações. O tipo é um grupo de rádio em dois cartões, cada um dizendo o que significa; com chave de API, os dois avisos
 * aparecem antes do nome. O tipo não muda depois de criada. A opção de chave de API fica desligada enquanto o estado do
 * cofre não chega, e sem a proteção do Windows, com o motivo no lugar da descrição. A chave não é pedida aqui: ela
 * entra depois, pela área de transferência, na linha da conta.
 */
export function AddAccountForm({
  program,
  allowApi,
  vault,
  submitLabel,
  onSubmit,
  onCancel,
}: {
  /** O nome do programa, no título do painel. */
  program: string;
  /** O programa aceita conta por chave de API (hoje, só o Claude Code). */
  allowApi: boolean;
  vault: VaultDto | null;
  submitLabel: string;
  onSubmit: (name: string, kind: AccountKind) => Promise<string | null>;
  onCancel: () => void;
}) {
  const [kind, setKind] = useState<AccountKind>('subscription');
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const titleId = useId();
  const fieldId = useId();
  const errorId = useId();
  const labelIds = { subscription: useId(), api: useId() };
  const noteIds = { subscription: useId(), api: useId() };
  const options = useRef<Record<AccountKind, HTMLButtonElement | null>>({
    subscription: null,
    api: null,
  });
  const apiDisabled = vault?.available !== true;
  const unavailable = vault !== null && !vault.available;
  const chosen: AccountKind = allowApi ? kind : 'subscription';
  const trimmed = name.trim();

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (trimmed === '' || busy) return;
    setBusy(true);
    setError(null);
    const failure = await onSubmit(trimmed, chosen);
    setBusy(false);
    if (failure !== null) setError(failure);
  }

  /** As setas trocam o tipo, como num grupo de rádio; a opção desligada não é escolhida. */
  function onArrow(event: KeyboardEvent<HTMLDivElement>) {
    if (!ARROWS.has(event.key)) return;
    event.preventDefault();
    const next: AccountKind = kind === 'subscription' ? 'api' : 'subscription';
    if (next === 'api' && apiDisabled) return;
    setKind(next);
    options.current[next]?.focus();
  }

  function option(value: AccountKind, Icon: LucideIcon, label: string, note: string) {
    const checked = kind === value;
    return (
      <button
        ref={(element) => {
          options.current[value] = element;
        }}
        type="button"
        role="radio"
        aria-checked={checked}
        aria-labelledby={labelIds[value]}
        aria-describedby={noteIds[value]}
        tabIndex={checked ? 0 : -1}
        autoFocus={checked}
        disabled={value === 'api' && apiDisabled}
        className="acct-kind__option"
        onClick={() => setKind(value)}
      >
        <span className="acct-kind__mark" aria-hidden="true" />
        <span className="acct-kind__body">
          <span id={labelIds[value]} className="acct-kind__title">
            <Icon {...ICON_PROPS} />
            {label}
          </span>
          <span id={noteIds[value]} className="acct-kind__note">
            {note}
          </span>
        </span>
      </button>
    );
  }

  return (
    <form
      className="acct-add"
      aria-labelledby={titleId}
      onSubmit={(event) => void submit(event)}
      onKeyDown={(event) => {
        if (event.key === 'Escape' && !busy) onCancel();
      }}
    >
      <p id={titleId} className="acct-add__title">
        {ADD_TEXT.title(program)}
      </p>
      {allowApi ? (
        <div
          role="radiogroup"
          aria-label={ADD_TEXT.group}
          className="acct-kind"
          onKeyDown={onArrow}
        >
          {option('subscription', LogIn, ADD_TEXT.subscription, ADD_TEXT.subscriptionNote)}
          {option(
            'api',
            KeyRound,
            ADD_TEXT.api,
            unavailable ? ADD_TEXT.unavailable : ADD_TEXT.apiNote,
          )}
        </div>
      ) : null}
      {chosen === 'api' ? (
        <ul className="acct-add__notes" aria-label={ADD_TEXT.notes}>
          <li>
            <ShieldAlert {...ICON_PROPS} />
            <span>{ADD_TEXT.risk}</span>
          </li>
          <li>
            <Coins {...ICON_PROPS} />
            <span>{ADD_TEXT.billing}</span>
          </li>
        </ul>
      ) : null}
      <div className="acct-add__foot">
        <div className="acct-add__field">
          <label htmlFor={fieldId} className="acct-add__label">
            {TEXT.field}
          </label>
          <input
            id={fieldId}
            type="text"
            className="settings-row__input"
            placeholder={TEXT.placeholder}
            maxLength={ACCOUNT_NAME_MAX}
            autoFocus={!allowApi}
            value={name}
            aria-invalid={error === null ? undefined : true}
            aria-describedby={error === null ? undefined : errorId}
            onChange={(event) => setName(event.target.value)}
          />
        </div>
        <div className="acct-add__actions">
          <button type="button" className="btn-ghost" disabled={busy} onClick={onCancel}>
            {TEXT.cancel}
          </button>
          <button type="submit" className="btn-primary" disabled={trimmed === '' || busy}>
            {submitLabel}
          </button>
        </div>
      </div>
      {error === null ? null : (
        <p id={errorId} role="alert" className="acct-add__error settings__error">
          {error}
        </p>
      )}
    </form>
  );
}
