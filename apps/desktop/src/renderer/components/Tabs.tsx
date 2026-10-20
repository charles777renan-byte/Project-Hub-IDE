/** Uma aba: o `id` é o que a página guarda, o `label` é o que a pessoa lê. */
export type TabItem<T extends string> = { id: T; label: string };

/**
 * Abas de seção ou de missão. Cada aba é um botão com `aria-selected`, então o Tab e o Enter do
 * teclado funcionam sem código extra. `filled` deixa a aba ativa como botão âmbar cheio (sub-abas
 * do workspace da missão, seção 10.7).
 */
export function Tabs<T extends string>({
  label,
  tabs,
  active,
  onChange,
  filled = false,
}: {
  label: string;
  tabs: readonly TabItem<T>[];
  active: T;
  onChange: (id: T) => void;
  filled?: boolean;
}) {
  return (
    <div role="tablist" aria-label={label} className={filled ? 'tabs tabs--filled' : 'tabs'}>
      {tabs.map((tab) => {
        const selected = tab.id === active;
        return (
          <button
            key={tab.id}
            type="button"
            role="tab"
            id={`tab-${tab.id}`}
            aria-selected={selected}
            aria-controls="tab-panel"
            className="tab"
            onClick={() => onChange(tab.id)}
          >
            {tab.label}
          </button>
        );
      })}
    </div>
  );
}
