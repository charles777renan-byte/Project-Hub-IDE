import { useId, useRef, type KeyboardEvent } from 'react';
import type { ExecutionProfileDto } from '@project-hub/contracts';
import { NO_OPTIONS_SUMMARY, profileSummary } from '../agent-profile-text';

const NEXT = new Set(['ArrowRight', 'ArrowDown']);
const PREVIOUS = new Set(['ArrowLeft', 'ArrowUp']);

/**
 * Escolha única do perfil de execução, como grupo de rádio numa linha, com o resumo do perfil marcado embaixo. O
 * perfil marcado é a única parada do Tab; as setas trocam a escolha e levam o foco junto. Só o id sai daqui.
 */
export function ProfileChoice({
  label,
  profiles,
  value,
  disabled = false,
  onChange,
}: {
  /** O nome acessível do grupo, ex.: "Perfil de execução". */
  label: string;
  profiles: readonly ExecutionProfileDto[];
  /** O id do perfil marcado. */
  value: string;
  disabled?: boolean;
  onChange(profileId: string): void;
}) {
  const summaryId = useId();
  const buttons = useRef<Array<HTMLButtonElement | null>>([]);
  const found = profiles.findIndex((profile) => profile.id === value);
  // Sem perfil com o id marcado (ele saiu da lista), o primeiro entra na ordem do Tab.
  const tabStop = found < 0 ? 0 : found;
  const selected = found < 0 ? undefined : profiles[found];

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const step = NEXT.has(event.key) ? 1 : PREVIOUS.has(event.key) ? -1 : 0;
    if (step === 0 || disabled || profiles.length === 0) return;
    event.preventDefault();
    const next = (tabStop + step + profiles.length) % profiles.length;
    const profile = profiles[next];
    if (profile === undefined) return;
    if (profile.id !== value) onChange(profile.id);
    buttons.current[next]?.focus();
  }

  return (
    <>
      <div
        role="radiogroup"
        aria-label={label}
        aria-describedby={selected === undefined ? undefined : summaryId}
        aria-disabled={disabled ? true : undefined}
        className="agent-opt__group"
        onKeyDown={onKeyDown}
      >
        {profiles.map((profile, index) => (
          <button
            key={profile.id}
            ref={(element) => {
              buttons.current[index] = element;
            }}
            type="button"
            role="radio"
            aria-checked={index === found}
            tabIndex={index === tabStop ? 0 : -1}
            disabled={disabled}
            className="agent-opt__choice"
            onClick={() => {
              if (profile.id !== value) onChange(profile.id);
            }}
          >
            {profile.name}
          </button>
        ))}
      </div>
      {selected === undefined ? null : (
        <p id={summaryId} className="profile-choice__summary">
          {selected.builtIn ? NO_OPTIONS_SUMMARY : profileSummary(selected)}
        </p>
      )}
    </>
  );
}
