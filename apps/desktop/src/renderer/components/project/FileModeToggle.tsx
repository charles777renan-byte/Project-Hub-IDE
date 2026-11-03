import { useId, useRef, type KeyboardEvent } from 'react';
import { RIGHT_PANEL_TEXT } from '../../mission-text';
import type { FileMode } from '../../open-files';

const TEXT = RIGHT_PANEL_TEXT.editor.mode;

const MODES: ReadonlyArray<{ mode: FileMode; label: string }> = [
  { mode: 'arquivo', label: TEXT.file },
  { mode: 'alteracoes', label: TEXT.changes },
];

/**
 * O par "Arquivo | Alterações" da barra do caminho: dois botões com `aria-pressed`, os dois alcançáveis por Tab (não
 * há tabindex móvel), e as setas trocam o modo e levam o foco junto. Sem base para comparar (`canDiff` falso),
 * "Alterações" fica `aria-disabled` (focável, para o leitor de tela ouvir o motivo) e o motivo aparece em texto, ligado
 * ao botão por `aria-describedby`; clique e setas não o ativam.
 */
export function FileModeToggle({
  mode,
  canDiff,
  onChange,
}: {
  mode: FileMode;
  canDiff: boolean;
  onChange: (mode: FileMode) => void;
}) {
  const buttons = useRef<Array<HTMLButtonElement | null>>([]);
  const reasonId = useId();

  function choose(index: number) {
    const target = MODES[(index + MODES.length) % MODES.length];
    if (target === undefined) return;
    if (target.mode === 'alteracoes' && !canDiff) return;
    onChange(target.mode);
    buttons.current[MODES.indexOf(target)]?.focus();
  }

  function onKeyDown(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    if (event.key === 'ArrowRight' || event.key === 'ArrowDown') choose(index + 1);
    else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') choose(index - 1);
    else return;
    event.preventDefault();
  }

  return (
    <div className="file-mode">
      <div role="group" aria-label={TEXT.group} className="file-mode__buttons">
        {MODES.map(({ mode: id, label }, index) => {
          const unavailable = id === 'alteracoes' && !canDiff;
          return (
            <button
              key={id}
              ref={(node) => {
                buttons.current[index] = node;
              }}
              type="button"
              className="file-mode__button"
              aria-pressed={mode === id}
              aria-disabled={unavailable ? true : undefined}
              aria-describedby={unavailable ? reasonId : undefined}
              onClick={() => choose(index)}
              onKeyDown={(event) => onKeyDown(event, index)}
            >
              {label}
            </button>
          );
        })}
      </div>
      {canDiff ? null : (
        <span id={reasonId} className="file-mode__reason">
          {TEXT.noBase}
        </span>
      )}
    </div>
  );
}
