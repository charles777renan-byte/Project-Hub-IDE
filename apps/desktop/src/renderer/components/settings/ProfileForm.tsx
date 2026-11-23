import { useId, useRef, useState, type FormEvent, type KeyboardEvent } from 'react';
import {
  PROFILE_EFFORTS,
  PROFILE_MODELS,
  PROFILE_PERMISSION_MODES,
  type ProfileEffort,
  type ProfileModel,
  type ProfilePermissionMode,
} from '@project-hub/contracts/agent-options';
import { ACCOUNT_NAME_MAX } from '@project-hub/contracts/account-name';
import {
  EFFORT_LABELS,
  MODEL_LABELS,
  PERMISSION_MODE_LABELS,
  PROGRAM_DEFAULT_LABEL,
} from '../../agent-profile-text';

const TEXT = {
  name: 'Nome do perfil',
  placeholder: 'Rápido, Cuidadoso, Revisão…',
  model: 'Modelo',
  effort: 'Esforço',
  mode: 'Modo de permissão',
  modeNote: {
    default: 'O Claude Code usa o modo que estiver configurado nele.',
    manual: 'O agente pede aprovação para editar arquivos e para rodar comandos.',
    acceptEdits: 'O agente edita arquivos sem perguntar e pede aprovação para rodar comandos.',
    auto: 'O agente decide sozinho o que é seguro rodar e bloqueia o resto.',
  },
  cancel: 'Cancelar',
} as const;

const NEXT = new Set(['ArrowRight', 'ArrowDown']);
const PREVIOUS = new Set(['ArrowLeft', 'ArrowUp']);

/** O que o formulário devolve: as opções que a pessoa fixou. Opção em "Padrão" não vem. */
export type ProfileDraft = {
  name: string;
  model?: ProfileModel;
  effort?: ProfileEffort;
  permissionMode?: ProfilePermissionMode;
};

/**
 * Uma opção do perfil, como grupo de rádio numa linha: "Padrão" (o programa decide) e os valores da lista. As setas
 * trocam a escolha e levam o foco junto; o Tab entra e sai do grupo por uma parada só.
 */
function OptionGroup<Value extends string>({
  label,
  values,
  labels,
  value,
  onChange,
}: {
  label: string;
  values: readonly Value[];
  labels: Record<Value, string>;
  value: Value | undefined;
  onChange: (value: Value | undefined) => void;
}) {
  const labelId = useId();
  const options: Array<Value | undefined> = [undefined, ...values];
  const buttons = useRef<Array<HTMLButtonElement | null>>([]);
  const current = options.indexOf(value);

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const step = NEXT.has(event.key) ? 1 : PREVIOUS.has(event.key) ? -1 : 0;
    if (step === 0) return;
    event.preventDefault();
    const next = (current + step + options.length) % options.length;
    onChange(options[next]);
    buttons.current[next]?.focus();
  }

  return (
    <div className="agent-opt">
      <span id={labelId} className="agent-opt__label">
        {label}
      </span>
      <div
        role="radiogroup"
        aria-labelledby={labelId}
        className="agent-opt__group"
        onKeyDown={onKeyDown}
      >
        {options.map((option, index) => (
          <button
            key={option ?? 'padrao'}
            ref={(element) => {
              buttons.current[index] = element;
            }}
            type="button"
            role="radio"
            aria-checked={index === current}
            tabIndex={index === current ? 0 : -1}
            className="agent-opt__choice"
            onClick={() => onChange(option)}
          >
            {option === undefined ? PROGRAM_DEFAULT_LABEL : labels[option]}
          </button>
        ))}
      </div>
    </div>
  );
}

/**
 * Criar ou editar um perfil de execução: o nome e as três opções. `onSubmit` devolve a mensagem da falha (o nome
 * repetido, por exemplo), que aparece junto do nome sem apagar o que foi escolhido, ou `null` quando deu certo.
 */
export function ProfileForm({
  title,
  initial,
  submitLabel,
  onSubmit,
  onCancel,
}: {
  title: string;
  initial?: ProfileDraft;
  submitLabel: string;
  onSubmit: (draft: ProfileDraft) => Promise<string | null>;
  onCancel: () => void;
}) {
  const [name, setName] = useState(initial?.name ?? '');
  const [model, setModel] = useState(initial?.model);
  const [effort, setEffort] = useState(initial?.effort);
  const [mode, setMode] = useState(initial?.permissionMode);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const nameField = useRef<HTMLInputElement>(null);
  const titleId = useId();
  const fieldId = useId();
  const errorId = useId();
  const trimmed = name.trim();

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (trimmed === '' || busy) return;
    setBusy(true);
    setError(null);
    const failure = await onSubmit({
      name: trimmed,
      ...(model === undefined ? {} : { model }),
      ...(effort === undefined ? {} : { effort }),
      ...(mode === undefined ? {} : { permissionMode: mode }),
    });
    setBusy(false);
    if (failure === null) return;
    setError(failure);
    // O botão ficou desativado durante o envio e perdeu o foco: ele volta ao nome, onde a falha é dita.
    nameField.current?.focus();
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
        {title}
      </p>
      <div className="acct-add__field">
        <label htmlFor={fieldId} className="acct-add__label">
          {TEXT.name}
        </label>
        <input
          id={fieldId}
          ref={nameField}
          type="text"
          className="settings-row__input"
          placeholder={TEXT.placeholder}
          maxLength={ACCOUNT_NAME_MAX}
          autoFocus
          value={name}
          aria-invalid={error === null ? undefined : true}
          aria-describedby={error === null ? undefined : errorId}
          onChange={(event) => setName(event.target.value)}
        />
      </div>
      <OptionGroup
        label={TEXT.model}
        values={PROFILE_MODELS}
        labels={MODEL_LABELS}
        value={model}
        onChange={setModel}
      />
      <OptionGroup
        label={TEXT.effort}
        values={PROFILE_EFFORTS}
        labels={EFFORT_LABELS}
        value={effort}
        onChange={setEffort}
      />
      <OptionGroup
        label={TEXT.mode}
        values={PROFILE_PERMISSION_MODES}
        labels={PERMISSION_MODE_LABELS}
        value={mode}
        onChange={setMode}
      />
      <p className="agent-opt__note">{TEXT.modeNote[mode ?? 'default']}</p>
      {error === null ? null : (
        <p id={errorId} role="alert" className="acct-add__error settings__error">
          {error}
        </p>
      )}
      <div className="acct-add__actions">
        <button type="button" className="btn-ghost" disabled={busy} onClick={onCancel}>
          {TEXT.cancel}
        </button>
        <button type="submit" className="btn-primary" disabled={trimmed === '' || busy}>
          {submitLabel}
        </button>
      </div>
    </form>
  );
}
