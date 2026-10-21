import type { KeyboardEvent } from 'react';

/** Uma aba: o `id` é o que a página guarda, o `label` é o que a pessoa lê. */
export type TabItem<T extends string> = { id: T; label: string };

/**
 * Abas de seção ou de missão. Cada aba é um botão com `aria-selected`, então o Tab e o Enter do
 * teclado funcionam sem código extra; as setas (e Home e End) também trocam de aba. `filled` deixa a
 * aba ativa como botão cheio (sub-abas do workspace da missão, seção 10.7). Cada aba ganha a classe
 * `tab--<id>`, e é o CSS que dá a cor dela. `panelId` diz qual painel cada aba controla; sem ele, o
 * painel é o `tab-panel` (uma página com um painel só).
 */
export function Tabs<T extends string>({
  label,
  tabs,
  active,
  onChange,
  filled = false,
  panelId,
}: {
  label: string;
  tabs: readonly TabItem<T>[];
  active: T;
  onChange: (id: T) => void;
  filled?: boolean;
  panelId?: (id: T) => string;
}) {
  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const current = tabs.findIndex((tab) => tab.id === active);
    let next: number;
    if (event.key === 'ArrowRight') next = (current + 1) % tabs.length;
    else if (event.key === 'ArrowLeft') next = (current - 1 + tabs.length) % tabs.length;
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = tabs.length - 1;
    else return;
    const target = tabs[next];
    if (target === undefined) return;
    event.preventDefault();
    onChange(target.id);
    event.currentTarget.querySelectorAll<HTMLElement>('[role="tab"]')[next]?.focus();
  }

  return (
    <div
      role="tablist"
      aria-label={label}
      className={filled ? 'tabs tabs--filled' : 'tabs'}
      onKeyDown={handleKeyDown}
    >
      {tabs.map((tab) => {
        const selected = tab.id === active;
        return (
          <button
            key={tab.id}
            type="button"
            role="tab"
            id={`tab-${tab.id}`}
            aria-selected={selected}
            aria-controls={panelId === undefined ? 'tab-panel' : panelId(tab.id)}
            className={`tab tab--${tab.id}`}
            onClick={() => onChange(tab.id)}
          >
            {tab.label}
          </button>
        );
      })}
    </div>
  );
}
