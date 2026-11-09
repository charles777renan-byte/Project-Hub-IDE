import type { CSSProperties, KeyboardEvent, ReactNode } from 'react';
import { Fragment, useEffect, useRef, useState } from 'react';
import type { ProviderId, ProviderInfo } from '@project-hub/contracts';
import { ProviderIcon } from '../components/ProviderIcon';
import { Hint } from '../components/Hint';
import { ChevronDown, ICON_PROPS, LayoutGrid, PanelTop, Plus, Search } from '../components/Icon';
import { providerShortcutKeys, providerShortcutLabel } from './provider-shortcuts';

export const LIMIT_HINT = 'Limite de 12 painéis';
const SOLO_AUTO_HINT = 'Janela estreita: um painel por vez';
const GRID_HINT = 'Grade: todos os painéis lado a lado';
const TABS_HINT = 'Abas: um painel por vez, com uma aba para cada um (Ctrl+Alt+setas troca de aba)';

/** Como os painéis aparecem: lado a lado ou um por vez. */
export type PaneLayoutMode = 'grade' | 'abas';

/** Linha de apoio de cada programa no menu, abaixo do nome (só a do item marcado aparece). */
const DESCRIPTION: Record<ProviderId, string> = {
  claude: 'Agente de código da Anthropic',
  codex: 'Agente de código da OpenAI',
  antigravity: 'Agente de linha de comando do Google',
  opencode: 'Agente de código open source',
  freebuff: 'Agente de código gratuito',
  shell: 'Terminal do sistema',
};

/** Texto sem acento e em minúsculas, para a busca não depender de como a pessoa digita. */
function plain(text: string): string {
  return text.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
}

/** O índice da linha na animação de entrada: cada linha espera um passo a mais que a de cima (motion.css). */
function rowStyle(index: number): CSSProperties {
  return { '--i': index } as CSSProperties;
}

/**
 * Ferramentas dos terminais, na faixa do projeto (o cabeçalho, à direita): "Fora da grade", o seletor de layout
 * (Grade e Abas, só ícones) e o botão "+ Terminal" (nome acessível "Abrir terminal"), que abre o menu dos programas
 * alinhado à direita. O menu abre
 * com o foco no campo de busca, que filtra os programas pelo nome (sem diferenciar maiúsculas nem acentos), e
 * Enter abre o item marcado. O item marcado é o que tem o mouse em cima ou o foco, e só ele mostra a descrição;
 * sem nenhum dos dois, vale o primeiro disponível. Cada linha traz o atalho Ctrl+Alt+posição no menu, que só
 * aparece com o mouse em cima ou o foco do teclado (o atalho em si vale também com o menu fechado: ver
 * provider-shortcuts.ts e a captura do WorkspacePage). Setas percorrem os programas disponíveis (descem da busca
 * ao primeiro, voltam do primeiro à busca, e dão a volta no fim), Home e End vão às pontas, digitar com um item
 * focado leva a tecla à busca, Esc fecha e devolve o foco ao botão, e clicar fora também fecha. Programa não
 * instalado aparece marcado como "Não instalado", com o motivo na dica, e não abre nada. Com o limite de
 * painéis, o botão fica desabilitado com a dica do limite. Com `unavailableReason` (a pasta do projeto sumiu), o
 * botão também fica desabilitado, e a dica é o motivo. Um bloqueio que chega com o menu aberto fecha o menu.
 * `focusToken` novo leva o foco ao botão, como quando o
 * último painel é fechado. `dock` (os terminais "Fora da grade") vai no começo, à esquerda do seletor. Com `soloAuto`
 * (a janela está estreita e o modo Abas valeu sozinho), "Abas" fica apertado, "Grade" fica desabilitado e as dicas
 * dizem isso; escolher "Abas" ainda vale, para quando a janela alargar.
 */
export function WorkspaceToolbar({
  providers,
  busy,
  limitReached = false,
  unavailableReason,
  focusToken = 0,
  soloMode = false,
  soloAuto = false,
  canSolo = false,
  dock,
  onLayout,
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
  /** O modo veio da largura da janela, não de um clique: "Abas" fica apertado e a dica avisa da janela estreita. */
  soloAuto?: boolean;
  /** Há painel para mostrar sozinho; sem ele o botão fica desabilitado. */
  canSolo?: boolean;
  /** O que vai no começo da barra, à esquerda do seletor (a faixa "Fora da grade"). */
  dock?: ReactNode;
  /** A pessoa escolheu como os painéis aparecem. Sem ele, o seletor não aparece. */
  onLayout?(mode: PaneLayoutMode): void;
  onOpen(provider: ProviderId): void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [marked, setMarked] = useState<ProviderId | null>(null);
  const wrapper = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const search = useRef<HTMLInputElement>(null);
  const blocked = busy || limitReached || unavailableReason !== undefined;
  // Com o motivo de indisponível, a dica é ele: sem a pasta, nenhum terminal abre, nem mesmo com espaço livre.
  const hint = unavailableReason ?? (limitReached ? LIMIT_HINT : undefined);

  // A posição no menu inteiro fica junto do programa: o atalho dele não muda quando a busca esconde os outros.
  const needle = plain(query.trim());
  const visible = providers
    .map((provider, index) => ({ provider, index }))
    .filter(({ provider }) => needle === '' || plain(provider.label).includes(needle));
  // O separador só existe antes do terminal do sistema, e só com agentes acima dele.
  const hasDivider = visible.some(({ provider }, at) => provider.id === 'shell' && at > 0);
  const markedProvider =
    visible.find(({ provider }) => provider.id === marked) ??
    visible.find(({ provider }) => provider.available !== false);

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

  // Fechado, o menu esquece a busca e a marca: o próximo abrir começa limpo.
  useEffect(() => {
    if (open) return;
    setQuery('');
    setMarked(null);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    search.current?.focus();
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
    const inSearch = event.target === search.current;
    const at = all.indexOf(document.activeElement as HTMLElement);
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      // Da busca desce ao primeiro item; do último dá a volta ao primeiro.
      all[inSearch || at < 0 ? 0 : (at + 1) % all.length]?.focus();
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      // Do primeiro item sobe à busca; da busca vai ao último.
      if (at === 0) search.current?.focus();
      else all[inSearch || at < 0 ? all.length - 1 : at - 1]?.focus();
    } else if (event.key === 'Enter' && inSearch) {
      event.preventDefault();
      if (markedProvider !== undefined) choose(markedProvider.provider);
    } else if (inSearch) {
      // Home, End e o resto são do campo (cursor e texto).
    } else if (event.key === 'Home') {
      event.preventDefault();
      all[0]?.focus();
    } else if (event.key === 'End') {
      event.preventDefault();
      all[all.length - 1]?.focus();
    } else if (
      event.key.length === 1 &&
      event.key !== ' ' &&
      !event.ctrlKey &&
      !event.altKey &&
      !event.metaKey
    ) {
      // Digitar com um item focado é buscar: a tecla segue para o campo.
      search.current?.focus();
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
      aria-label="Abrir terminal"
      aria-haspopup="menu"
      aria-expanded={open}
      onClick={() => setOpen((current) => !current)}
    >
      <Plus {...ICON_PROPS} />
      <span className="workspace__open-label">Terminal</span>
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
      {dock}
      {/* A cápsula: o seletor de layout e o gatilho, juntos, com um fio entre eles. */}
      <div className="workspace__controls">
        {onLayout === undefined ? null : (
          <div className="workspace__layout" role="group" aria-label="Layout dos painéis">
            <Hint label={soloAuto ? SOLO_AUTO_HINT : GRID_HINT}>
              {/* Desabilitado com a janela estreita, mas ainda focável (aria-disabled), para a dica explicar o porquê. */}
              <button
                type="button"
                className="workspace__layout-btn"
                aria-label="Grade"
                aria-pressed={!(soloMode || soloAuto)}
                aria-disabled={soloAuto}
                onClick={() => {
                  if (!soloAuto) onLayout('grade');
                }}
              >
                <LayoutGrid {...ICON_PROPS} />
              </button>
            </Hint>
            <Hint label={soloAuto ? SOLO_AUTO_HINT : TABS_HINT}>
              <button
                type="button"
                className="workspace__layout-btn"
                aria-label="Abas"
                aria-pressed={soloMode || soloAuto}
                disabled={!canSolo}
                onClick={() => onLayout('abas')}
              >
                <PanelTop {...ICON_PROPS} />
              </button>
            </Hint>
          </div>
        )}
        {onLayout === undefined ? null : (
          <span className="workspace__controls-sep" aria-hidden="true" />
        )}
        {hint !== undefined ? (
          <Hint label={hint}>
            <span className="workspace__open-wrap" role="group" aria-label={hint} tabIndex={0}>
              {trigger}
            </span>
          </Hint>
        ) : (
          trigger
        )}
      </div>
      {open ? (
        <div className="workspace__popup">
          <div className="workspace__menu-search" style={rowStyle(0)}>
            <Search {...ICON_PROPS} />
            <input
              ref={search}
              type="text"
              role="searchbox"
              aria-label="Buscar programa"
              placeholder="Buscar programa…"
              autoComplete="off"
              spellCheck={false}
              value={query}
              onChange={(event) => {
                setQuery(event.target.value);
                setMarked(null);
              }}
            />
          </div>
          {visible.length === 0 ? (
            <p className="workspace__menu-empty" role="status">
              Nenhum programa encontrado
            </p>
          ) : (
            <ul role="menu" aria-label="Abrir terminal" className="workspace__menu">
              {visible.map(({ provider, index }, position) => {
                const unavailable = provider.available === false;
                const isMarked = markedProvider?.provider.id === provider.id;
                // O separador leva uma entrada da sequência, logo antes da linha do terminal do sistema.
                const divided = hasDivider && provider.id === 'shell';
                // A busca é a primeira da sequência (0): as linhas começam em 1.
                const order = position + (divided ? 1 : 0) + 1;
                const shortcut = providerShortcutLabel(index);
                return (
                  <Fragment key={provider.id}>
                    {divided ? (
                      <li
                        role="separator"
                        className="workspace__menu-sep"
                        style={rowStyle(order - 1)}
                      />
                    ) : null}
                    <li role="none" className="workspace__menu-row" style={rowStyle(order)}>
                      <button
                        type="button"
                        role="menuitem"
                        className="workspace__menu-item"
                        data-marked={isMarked}
                        aria-disabled={unavailable}
                        aria-keyshortcuts={providerShortcutKeys(index)}
                        title={unavailable ? provider.reason : undefined}
                        onMouseEnter={(event) => {
                          setMarked(provider.id);
                          // Com outro item em foco (pelo teclado), o foco vai para o do mouse: um item só fica
                          // selecionado. A busca não perde o foco, para dar para digitar com o ponteiro na lista.
                          const focused = document.activeElement;
                          if (
                            focused !== event.currentTarget &&
                            focused?.getAttribute('role') === 'menuitem'
                          ) {
                            event.currentTarget.focus({ preventScroll: true });
                          }
                        }}
                        onFocus={() => setMarked(provider.id)}
                        onClick={() => choose(provider)}
                      >
                        <span className="workspace__menu-icon">
                          <ProviderIcon provider={provider.id} />
                        </span>
                        <span className="workspace__menu-text">
                          <span className="workspace__menu-head">
                            <span className="workspace__menu-name">{provider.label}</span>
                            {unavailable ? (
                              <span className="workspace__menu-state">Não instalado</span>
                            ) : null}
                            {shortcut === undefined ? null : (
                              <kbd className="workspace__menu-kbd" aria-hidden="true">
                                {shortcut}
                              </kbd>
                            )}
                          </span>
                          {isMarked ? (
                            <small>
                              {unavailable
                                ? (provider.reason ?? 'Não instalado')
                                : DESCRIPTION[provider.id]}
                            </small>
                          ) : null}
                        </span>
                      </button>
                    </li>
                  </Fragment>
                );
              })}
            </ul>
          )}
          <p
            className="workspace__menu-foot"
            aria-hidden="true"
            style={rowStyle(visible.length + (hasDivider ? 1 : 0) + 1)}
          >
            <kbd>↑↓</kbd> navegar · <kbd>↵</kbd> abrir · <kbd>Esc</kbd> fechar
          </p>
        </div>
      ) : null}
    </div>
  );
}
