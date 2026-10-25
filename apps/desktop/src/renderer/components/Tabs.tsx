import * as RadixTabs from '@radix-ui/react-tabs';

/**
 * Contagem opcional de uma aba: `value` é o número curto ao lado do nome (escondido do leitor de tela)
 * e `label` é a frase que o leitor de tela lê como descrição da aba. O nome da aba não muda.
 */
export type TabCount = { value: string; label: string };

/** Uma aba: o `id` é o que a página guarda, o `label` é o que a pessoa lê. */
export type TabItem<T extends string> = { id: T; label: string; count?: TabCount };

/**
 * Abas de seção ou de missão, sobre o `@radix-ui/react-tabs`: só a aba ativa entra na ordem de
 * tabulação (o Tab sai da barra para o conteúdo) e as setas, Home e End andam a partir da aba focada.
 * O Radix cuida do foco e do `aria-selected`; a aparência e as classes continuam as de sempre. O `Tabs`
 * só desenha a barra: quem o usa monta os painéis. `filled` marca as sub-abas do workspace da missão
 * e do painel Diff (em mono). Cada aba ganha a classe `tab--<id>` (só um gancho de teste e de página:
 * todas as abas são pílulas uniformes, sem cor por tipo). `panelId` diz qual painel cada aba controla;
 * sem ele, o painel é o `tab-panel` (uma página com um painel só). Uma aba com `count` mostra o número
 * depois do nome e ganha a frase da contagem como descrição (`aria-describedby`).
 *
 * A raiz do Radix vira a própria barra (`asChild`), sem `div` extra: o CSS da missão depende de a barra
 * ser filha direta do contêiner (`.mission-tabs > .tabs`). Os ids `tab-<id>` e o `aria-controls` ficam
 * os mesmos de antes, porque os painéis apontam para eles por `aria-labelledby`.
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
  // O Radix entrega o valor como texto; devolvemos o `id` tipado da própria lista.
  function handleValueChange(value: string) {
    const target = tabs.find((tab) => tab.id === value);
    if (target !== undefined) onChange(target.id);
  }

  return (
    <RadixTabs.Root asChild value={active} onValueChange={handleValueChange}>
      <RadixTabs.List aria-label={label} className={filled ? 'tabs tabs--filled' : 'tabs'}>
        {tabs.map((tab) => {
          const countId = `tab-${tab.id}-count`;
          return (
            <RadixTabs.Trigger
              key={tab.id}
              value={tab.id}
              id={`tab-${tab.id}`}
              aria-controls={panelId === undefined ? 'tab-panel' : panelId(tab.id)}
              aria-describedby={tab.count === undefined ? undefined : countId}
              className={`tab tab--${tab.id}`}
            >
              {tab.label}
              {tab.count === undefined ? null : (
                <>
                  <span className="tab__count" aria-hidden="true">
                    {tab.count.value}
                  </span>
                  <span id={countId} hidden>
                    {tab.count.label}
                  </span>
                </>
              )}
            </RadixTabs.Trigger>
          );
        })}
      </RadixTabs.List>
    </RadixTabs.Root>
  );
}
