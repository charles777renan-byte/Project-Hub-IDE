import type { BrowserTabDto } from '@project-hub/contracts';
import { useRef, type KeyboardEvent } from 'react';
import { Hint } from '../Hint';
import { ICON_PROPS, LoaderCircle, Plus, X } from '../Icon';

/** O nome de uma aba: o título da página; sem título, o endereço sem o esquema; sem nada, "Nova aba". */
export function pageTabLabel(tab: BrowserTabDto): string {
  if (tab.title !== '') return tab.title;
  if (tab.url !== '') return tab.url.replace(/^[a-z][a-z0-9+.-]*:\/\//i, '');
  return 'Nova aba';
}

/**
 * A faixa de abas do navegador de um projeto: um `tablist` com uma aba por página, o botão de fechar de cada uma e
 * "Nova aba". Só a aba ativa entra na ordem do Tab; as setas, Home e End andam entre elas e já selecionam. O botão
 * de fechar é irmão da aba (um botão dentro de outro não é HTML válido) e diz no nome qual aba fecha.
 */
export function BrowserPageTabs({
  tabs,
  activeTabId,
  onSelect,
  onClose,
  onNew,
}: {
  tabs: BrowserTabDto[];
  activeTabId: string | null;
  onSelect: (tabId: string) => void;
  onClose: (tabId: string) => void;
  onNew: () => void;
}) {
  const tabRefs = useRef(new Map<string, HTMLButtonElement>());

  function go(index: number) {
    const target = tabs[(index + tabs.length) % tabs.length];
    if (target === undefined) return;
    tabRefs.current.get(target.id)?.focus();
    onSelect(target.id);
  }

  function onKeyDown(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    switch (event.key) {
      case 'ArrowRight':
        event.preventDefault();
        go(index + 1);
        break;
      case 'ArrowLeft':
        event.preventDefault();
        go(index - 1);
        break;
      case 'Home':
        event.preventDefault();
        go(0);
        break;
      case 'End':
        event.preventDefault();
        go(tabs.length - 1);
        break;
      default:
    }
  }

  return (
    <div className="browser__tabs">
      <div role="tablist" aria-label="Abas do navegador" className="browser__tablist">
        {tabs.map((tab, index) => {
          const label = pageTabLabel(tab);
          const selected = tab.id === activeTabId;
          return (
            <div
              key={tab.id}
              className={selected ? 'browser__tab browser__tab--active' : 'browser__tab'}
            >
              <button
                type="button"
                role="tab"
                ref={(node) => {
                  if (node === null) tabRefs.current.delete(tab.id);
                  else tabRefs.current.set(tab.id, node);
                }}
                className="browser__tab-button"
                aria-selected={selected}
                tabIndex={selected ? 0 : -1}
                onClick={() => onSelect(tab.id)}
                onKeyDown={(event) => onKeyDown(event, index)}
              >
                {tab.loading ? (
                  <>
                    <LoaderCircle {...ICON_PROPS} size={12} className="browser__spinner" />
                    <span className="visually-hidden">carregando </span>
                  </>
                ) : null}
                <span className="browser__tab-label">{label}</span>
              </button>
              <button
                type="button"
                className="browser__tab-close"
                aria-label={`Fechar aba ${label}`}
                onClick={() => onClose(tab.id)}
              >
                <X {...ICON_PROPS} size={12} />
              </button>
            </div>
          );
        })}
      </div>
      <Hint label="Nova aba">
        <button
          type="button"
          className="browser__icon-button"
          aria-label="Nova aba"
          onClick={onNew}
        >
          <Plus {...ICON_PROPS} />
        </button>
      </Hint>
    </div>
  );
}
