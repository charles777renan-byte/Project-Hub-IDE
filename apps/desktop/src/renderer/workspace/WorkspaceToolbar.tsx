import type { KeyboardEvent } from 'react';
import { useEffect, useRef, useState } from 'react';
import type { ProviderId, ProviderInfo } from '@project-hub/contracts';
import { ProviderIcon } from '../components/ProviderIcon';
import { Hint } from '../components/Hint';
import { ChevronDown, ICON_PROPS, LayoutGrid, Plus } from '../components/Icon';

export const LIMIT_HINT = 'Limite de 12 painéis';

/** Linha de apoio de cada programa no menu, abaixo do nome. */
const DESCRIPTION: Record<ProviderId, string> = {
  claude: 'Agente de código da Anthropic',
  codex: 'Agente de código da OpenAI',
  antigravity: 'Agente de linha de comando do Google',
  opencode: 'Agente de código open source',
  freebuff: 'Agente de código gratuito',
  shell: 'Terminal do sistema',
};

/**
 * Barra fina no topo do workspace, com um botão "Abrir terminal" que abre o menu dos programas. O menu tem
 * o mesmo jeito do menu de projetos da barra superior: setas percorrem os programas disponíveis (com volta),
 * Home e End vão às pontas, Esc fecha e devolve o foco ao botão, e clicar fora também fecha. Programa não
 * instalado aparece marcado como "Não instalado", com o motivo na dica, e não abre nada. Com o limite de
 * painéis, o botão fica desabilitado com a dica do limite. Com `unavailableReason` (a pasta do projeto sumiu), o
 * botão também fica desabilitado, e a dica é o motivo. Um bloqueio que chega com o menu aberto fecha o menu.
 * `focusToken` novo leva o foco ao botão, como quando o
 * último painel é fechado.
 */
export function WorkspaceToolbar({
  providers,
  busy,
  limitReached = false,
  unavailableReason,
  focusToken = 0,
  soloMode = false,
  canSolo = false,
  onToggleSolo,
  onOpen,
}: {
  providers: readonly ProviderInfo[];
  busy: boolean;
  /** Todos os painéis possíveis já estão abertos: o botão fica desabilitado, com a dica do limite. */
  limitReached?: boolean;
  /** Nada pode abrir (ex.: a pasta do projeto não está disponível): o botão fica desabilitado, com este motivo na dica. */
  unavailableReason?: string;
  /** Cada valor novo (maior que 0) leva o foco ao botão, ex.: depois de fechar o último painel. */
  focusToken?: number;
  /** O modo "um painel por vez" está ligado: o botão "Abas" fica apertado. */
  soloMode?: boolean;
  /** Há painel para mostrar sozinho; sem ele o botão fica desabilitado. */
  canSolo?: boolean;
  onToggleSolo?(): void;
  onOpen(provider: ProviderId): void;
}) {
  const [open, setOpen] = useState(false);
  const wrapper = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const blocked = busy || limitReached || unavailableReason !== undefined;
  // Com o motivo de indisponível, a dica é ele: sem a pasta, nenhum terminal abre, nem mesmo com espaço livre.
  const hint = unavailableReason ?? (limitReached ? LIMIT_HINT : undefined);

  const enabledItems = () =>
    Array.from(
      wrapper.current?.querySelectorAll<HTMLElement>(
        '[role="menuitem"]:not([aria-disabled="true"])',
      ) ?? [],
    );

  useEffect(() => {
    if (focusToken === 0) return;
    const target = button.current && !button.current.disabled ? button.current : wrapper.current;
    target?.focus();
  }, [focusToken]);

  // Bloqueio que chega com o menu aberto (limite de painéis, pasta que some) fecha o menu: nada abre enquanto bloqueado.
  useEffect(() => {
    if (blocked) setOpen(false);
  }, [blocked]);

  useEffect(() => {
    if (!open) return;
    enabledItems()[0]?.focus();
    const closeOnOutside = (event: PointerEvent) => {
      if (!wrapper.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', closeOnOutside);
    return () => document.removeEventListener('pointerdown', closeOnOutside);
  }, [open]);

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (!open) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      setOpen(false);
      button.current?.focus();
      return;
    }
    const all = enabledItems();
    const at = all.indexOf(document.activeElement as HTMLElement);
    const target = (index: number) => all[(index + all.length) % all.length];
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      target(at + 1)?.focus();
    } else if (event.key === 'ArrowUp') {
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

  function choose(provider: ProviderInfo) {
    if (blocked || provider.available === false) return;
    setOpen(false);
    onOpen(provider.id);
  }

  const trigger = (
    <button
      ref={button}
      type="button"
      className="btn-secondary workspace__open"
      disabled={blocked}
      aria-haspopup="menu"
      aria-expanded={open}
      onClick={() => setOpen((current) => !current)}
    >
      <Plus {...ICON_PROPS} />
      Abrir terminal
      <ChevronDown {...ICON_PROPS} />
    </button>
  );

  return (
    <div
      ref={wrapper}
      className="workspace__toolbar"
      tabIndex={-1}
      onKeyDown={onKeyDown}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false);
      }}
    >
      {hint !== undefined ? (
        <Hint label={hint}>
          <span className="workspace__open-wrap" role="group" aria-label={hint} tabIndex={0}>
            {trigger}
          </span>
        </Hint>
      ) : (
        trigger
      )}
      {onToggleSolo === undefined ? null : (
        <Hint label="Mostra um painel por vez, com uma aba para cada um (Ctrl+Alt+setas troca de aba)">
          <button
            type="button"
            className="btn-secondary workspace__open"
            aria-pressed={soloMode}
            disabled={!canSolo}
            onClick={onToggleSolo}
          >
            <LayoutGrid {...ICON_PROPS} />
            Abas
          </button>
        </Hint>
      )}
      {open ? (
        <ul role="menu" aria-label="Abrir terminal" className="workspace__menu">
          {providers.map((provider) => {
            const unavailable = provider.available === false;
            return (
              <li key={provider.id} role="none">
                <button
                  type="button"
                  role="menuitem"
                  className="workspace__menu-item"
                  aria-disabled={unavailable}
                  title={unavailable ? provider.reason : undefined}
                  onClick={() => choose(provider)}
                >
                  <span className="workspace__menu-icon">
                    <ProviderIcon provider={provider.id} />
                  </span>
                  <span className="workspace__menu-text">
                    <span className="workspace__menu-name">{provider.label}</span>
                    <small>{unavailable ? 'Não instalado' : DESCRIPTION[provider.id]}</small>
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      ) : null}
    </div>
  );
}
