import type { KeyboardEvent } from 'react';
import { useRef } from 'react';
import type { ProviderId, ProviderInfo } from '@project-hub/contracts';
import { Hint } from '../components/Hint';
import { ICON_PROPS, Plus } from '../components/Icon';

/**
 * Barra para abrir um terminal novo: um botão por programa. Setas, Home e End movem o foco entre os botões
 * habilitados (mesmo padrão do menu "+" da barra superior). O motivo de um programa indisponível vai numa dica
 * no invólucro do botão, porque botão desabilitado não recebe foco nem mouse.
 */
export function WorkspaceToolbar({
  providers,
  busy,
  onOpen,
}: {
  providers: readonly ProviderInfo[];
  busy: boolean;
  onOpen(provider: ProviderId): void;
}) {
  const bar = useRef<HTMLDivElement>(null);

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const all = Array.from(bar.current?.querySelectorAll<HTMLButtonElement>('button') ?? []).filter(
      (button) => !button.disabled,
    );
    if (all.length === 0) return;
    const at = all.indexOf(document.activeElement as HTMLButtonElement);
    const target = (index: number) => all[(index + all.length) % all.length];
    if (event.key === 'ArrowRight') {
      event.preventDefault();
      target(at + 1)?.focus();
    } else if (event.key === 'ArrowLeft') {
      event.preventDefault();
      target(at < 0 ? -1 : at - 1)?.focus();
    } else if (event.key === 'Home') {
      event.preventDefault();
      all[0]?.focus();
    } else if (event.key === 'End') {
      event.preventDefault();
      all[all.length - 1]?.focus();
    }
  }

  return (
    <div
      ref={bar}
      role="toolbar"
      aria-label="Abrir terminal"
      aria-orientation="horizontal"
      className="workspace__toolbar"
      onKeyDown={onKeyDown}
    >
      {providers.map((provider) => {
        const unavailable = provider.available === false;
        const button = (
          <button
            type="button"
            className="btn-secondary workspace__open"
            disabled={busy || unavailable}
            onClick={() => onOpen(provider.id)}
          >
            <Plus {...ICON_PROPS} />
            {provider.label}
          </button>
        );
        if (!unavailable) return <span key={provider.id}>{button}</span>;
        return (
          <Hint key={provider.id} label={provider.reason ?? 'Programa indisponível.'}>
            <span className="workspace__open-wrap" tabIndex={0}>
              {button}
            </span>
          </Hint>
        );
      })}
    </div>
  );
}
