import { useId, useState } from 'react';
import type { AccountGroupDto, AutoSwitchOption } from '@project-hub/contracts';

const TEXT = {
  main: 'Trocar de conta quando o limite acabar',
  mainNoteClaude:
    'Quando o limite de uma conta acaba, a missão continua na próxima conta com limite, e painéis e missões novos não abrem na conta esgotada.',
  // No Codex a troca vale só na abertura: as missões são do Claude Code.
  mainNoteCodex: 'Quando o limite de uma conta acaba, painéis novos não abrem na conta esgotada.',
  api: 'Incluir contas de chave de API',
  apiNote: 'Elas cobram por uso, sem teto.',
  needsAnother: 'Adicione outra conta para usar a troca automática.',
  needsMain: 'Ligue antes a troca de conta.',
  on: 'Ligado',
  off: 'Desligado',
  failed: 'Não foi possível mudar a opção.',
} as const;

function Toggle({
  label,
  note,
  checked,
  disabled,
  reason,
  onToggle,
}: {
  label: string;
  note: string;
  checked: boolean;
  disabled: boolean;
  reason?: string;
  onToggle(): void;
}) {
  const labelId = useId();
  const noteId = useId();
  return (
    <div className="auto-switch__row">
      <div className="auto-switch__text">
        <span id={labelId} className="auto-switch__label">
          {label}
        </span>
        <p id={noteId} className="auto-switch__note">
          {note}
        </p>
        {reason === undefined ? null : <p className="auto-switch__reason">{reason}</p>}
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-labelledby={labelId}
        aria-describedby={noteId}
        disabled={disabled}
        className="toggle"
        onClick={onToggle}
      >
        <span className="toggle__track" aria-hidden="true">
          <span className="toggle__knob" />
        </span>
        <span className="toggle__state">{checked ? TEXT.on : TEXT.off}</span>
      </button>
    </div>
  );
}

/**
 * Os interruptores da troca automática de conta, no grupo do programa. O estado aparece em texto e na posição da
 * bolinha; desativado diz o motivo. Quem decide se a mudança vale é o processo principal: o erro dele aparece aqui.
 */
export function AutoSwitchToggles({
  group,
  onChanged,
}: {
  group: AccountGroupDto;
  onChanged(): void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const single = group.accounts.length < 2;
  const isClaude = group.provider === 'claude';
  const { enabled, includeApi } = group.autoSwitch;

  async function change(option: AutoSwitchOption, value: boolean): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      const result = await window.projectHub.accounts.setAutoSwitch({
        provider: group.provider,
        option,
        value,
      });
      if (!result.ok) {
        setError(result.error.message);
        return;
      }
      onChanged();
    } catch {
      setError(TEXT.failed);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="auto-switch">
      <Toggle
        label={TEXT.main}
        note={isClaude ? TEXT.mainNoteClaude : TEXT.mainNoteCodex}
        checked={enabled}
        disabled={busy || (single && !enabled)}
        onToggle={() => void change('enabled', !enabled)}
      />
      {isClaude ? (
        <Toggle
          label={TEXT.api}
          note={TEXT.apiNote}
          checked={includeApi}
          disabled={busy || (!includeApi && (single || !enabled))}
          {...(!single && !enabled && !includeApi ? { reason: TEXT.needsMain } : {})}
          onToggle={() => void change('includeApi', !includeApi)}
        />
      ) : null}
      {single && !enabled ? <p className="auto-switch__reason">{TEXT.needsAnother}</p> : null}
      {error === null ? null : (
        <p role="alert" className="auto-switch__error">
          {error}
        </p>
      )}
    </div>
  );
}
