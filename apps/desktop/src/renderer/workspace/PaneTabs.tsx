import type { KeyboardEvent } from 'react';
import type { LayoutLeaf, ProviderInfo, TerminalSummary } from '@project-hub/contracts';
import { ICON_PROPS, LayoutGrid } from '../components/Icon';
import { ProviderIcon } from '../components/ProviderIcon';
import { StateMark } from '../components/StateMark';
import { markOfTerminal } from '../state-mark';

/** Id da aba de um painel: o painel mostrado aponta para ela (`aria-labelledby`). */
export const paneTabId = (leafId: string) => `pane-tab-${leafId}`;

/**
 * A faixa de abas do modo "um painel por vez": uma aba por painel, com a posição, o ícone do programa, o nome e o
 * estado da sessão. Clicar numa aba mostra aquele painel. Setas, Home e End percorrem as abas (a aba ativa é a
 * única parada de Tab), e "Grade" volta a mostrar todos os painéis.
 */
export function PaneTabs({
  leaves,
  activeId,
  terminals,
  providers,
  onSelect,
  onGrid,
}: {
  leaves: readonly LayoutLeaf[];
  activeId: string;
  terminals: readonly TerminalSummary[];
  providers: readonly ProviderInfo[];
  onSelect(leafId: string): void;
  onGrid(): void;
}) {
  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const at = leaves.findIndex((leaf) => leaf.id === activeId);
    let next: number | null = null;
    if (event.key === 'ArrowRight') next = (at + 1) % leaves.length;
    else if (event.key === 'ArrowLeft') next = (at - 1 + leaves.length) % leaves.length;
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = leaves.length - 1;
    const target = next === null ? undefined : leaves[next];
    if (target === undefined) return;
    event.preventDefault();
    onSelect(target.id);
    // A aba nova ainda não está ativa no DOM: o foco vai para ela na próxima pintura.
    requestAnimationFrame(() => document.getElementById(paneTabId(target.id))?.focus());
  }

  return (
    <div className="pane-tabs">
      <div
        role="tablist"
        aria-label="Painéis abertos"
        className="pane-tabs__list"
        onKeyDown={onKeyDown}
      >
        {leaves.map((leaf, index) => {
          const terminal =
            leaf.terminalId === null
              ? undefined
              : terminals.find((item) => item.id === leaf.terminalId);
          const providerId = terminal?.provider ?? leaf.provider;
          const label = providers.find((item) => item.id === providerId)?.label ?? providerId;
          const selected = leaf.id === activeId;
          return (
            <button
              key={leaf.id}
              id={paneTabId(leaf.id)}
              type="button"
              role="tab"
              aria-selected={selected}
              tabIndex={selected ? 0 : -1}
              className="pane-tabs__tab"
              onClick={() => onSelect(leaf.id)}
            >
              <span className="pane-tabs__number">{index + 1}</span>
              <ProviderIcon provider={providerId} />
              <span className="pane-tabs__label">{label}</span>
              {terminal !== undefined && terminal.state !== 'exited' ? (
                <StateMark kind={markOfTerminal(terminal.state)} />
              ) : null}
            </button>
          );
        })}
      </div>
      <button type="button" className="btn-secondary pane-tabs__grid" onClick={onGrid}>
        <LayoutGrid {...ICON_PROPS} />
        Grade
      </button>
    </div>
  );
}
