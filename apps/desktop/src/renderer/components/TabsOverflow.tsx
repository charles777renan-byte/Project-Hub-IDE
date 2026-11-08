import { useEffect, useRef, useState, type RefObject } from 'react';
import { ChevronDown, ICON_PROPS } from './Icon';
import { MenuAcoes } from './MenuAcoes';

/** O atributo com que cada aba da faixa se identifica para o hook e para o menu. */
export const TAB_ID_ATTRIBUTE = 'data-tab-id';

/** Uma aba só conta como à vista se estiver quase inteira dentro da faixa (sobra de arredondamento de pixel). */
const VISIBLE_RATIO = 0.99;

export type TabsOverflowState = {
  /** Há aba escondida antes da primeira à vista (à esquerda). */
  start: boolean;
  /** Há aba escondida depois da última à vista (à direita). */
  end: boolean;
  /** Os ids das abas fora de vista, na ordem da faixa. */
  hidden: string[];
};

const NOTHING_HIDDEN: TabsOverflowState = { start: false, end: false, hidden: [] };

function tabsOf(strip: HTMLElement): HTMLElement[] {
  return Array.from(strip.querySelectorAll<HTMLElement>(`[${TAB_ID_ATTRIBUTE}]`));
}

function sameState(a: TabsOverflowState, b: TabsOverflowState): boolean {
  return (
    a.start === b.start &&
    a.end === b.end &&
    a.hidden.length === b.hidden.length &&
    a.hidden.every((id, index) => id === b.hidden[index])
  );
}

/**
 * Liga o observador numa faixa: cada aba (`data-tab-id`) é observada contra a própria faixa, e o último estado de
 * cada uma fica guardado (o navegador só avisa das que mudaram). Quando as abas entram, saem ou trocam de id, a
 * lista é observada de novo. Devolve a função que desfaz tudo.
 */
function watchStrip(strip: HTMLElement, publish: (state: TabsOverflowState) => void): () => void {
  const visibility = new Map<Element, boolean>();

  function compute() {
    const tabs = tabsOf(strip);
    // Aba que ainda não foi medida conta como à vista: o primeiro aviso chega logo depois de observar.
    const flags = tabs.map((tab) => visibility.get(tab) ?? true);
    const firstVisible = flags.indexOf(true);
    const lastVisible = flags.lastIndexOf(true);
    const hidden = tabs
      .filter((_, index) => !flags[index])
      .map((tab) => tab.getAttribute(TAB_ID_ATTRIBUTE) ?? '');
    publish({
      // Sem nenhuma aba à vista (faixa sem largura), a sobra é dita do lado do fim.
      start: firstVisible > 0,
      end: firstVisible === -1 ? hidden.length > 0 : lastVisible < tabs.length - 1,
      hidden,
    });
  }

  const observer = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        visibility.set(
          entry.target,
          entry.isIntersecting && entry.intersectionRatio >= VISIBLE_RATIO,
        );
      }
      compute();
    },
    { root: strip, threshold: [0, VISIBLE_RATIO] },
  );

  const observed = new Set<Element>();
  function sync() {
    const current = new Set<Element>(tabsOf(strip));
    for (const tab of observed) {
      if (current.has(tab)) continue;
      observer.unobserve(tab);
      observed.delete(tab);
      visibility.delete(tab);
    }
    for (const tab of current) {
      if (observed.has(tab)) continue;
      observer.observe(tab);
      observed.add(tab);
    }
    compute();
  }

  // Abas que entram, saem ou trocam de id (a ordem da faixa também muda por aqui).
  const mutations = new MutationObserver(sync);
  mutations.observe(strip, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: [TAB_ID_ATTRIBUTE],
  });
  sync();

  return () => {
    mutations.disconnect();
    observer.disconnect();
    visibility.clear();
    observed.clear();
  };
}

/**
 * Diz quais abas de uma faixa que rola estão fora de vista e de que lado: `start` e `end` pedem o esmaecimento da
 * borda (quem usa põe `data-fade-start` / `data-fade-end` na faixa, e a CSS esmaece só o lado que tem sobra);
 * `hidden` são os ids (`data-tab-id`) das abas que a faixa não mostra por inteiro, na ordem dela.
 *
 * A faixa pode aparecer depois da primeira pintura (ex.: só há faixa com abas): o hook confere o elemento a cada
 * pintura e liga o observador quando ele muda. Sem `IntersectionObserver` (jsdom puro), nada fica escondido.
 */
export function useTabsOverflow(ref: RefObject<HTMLElement | null>): TabsOverflowState {
  const [state, setState] = useState<TabsOverflowState>(NOTHING_HIDDEN);
  const bound = useRef<HTMLElement | null>(null);
  const unwatch = useRef<(() => void) | null>(null);

  // Sem lista de dependências de propósito: a faixa pode ser outro elemento a qualquer pintura. Só liga quando mudou.
  useEffect(() => {
    const strip = ref.current;
    if (strip === bound.current) return;
    unwatch.current?.();
    unwatch.current = null;
    bound.current = strip;
    if (strip === null) {
      setState(NOTHING_HIDDEN);
      return;
    }
    if (typeof IntersectionObserver === 'undefined') return;
    unwatch.current = watchStrip(strip, (next) =>
      setState((old) => (sameState(old, next) ? old : next)),
    );
  });

  useEffect(
    () => () => {
      unwatch.current?.();
      unwatch.current = null;
      bound.current = null;
    },
    [],
  );

  return state;
}

export type TabsOverflowItem = { id: string; label: string };

/** Traz a aba (o elemento com esse `data-tab-id`) para a vista da faixa, sem rolar a página. */
function scrollTabIntoView(id: string) {
  const tab = Array.from(document.querySelectorAll<HTMLElement>(`[${TAB_ID_ATTRIBUTE}]`)).find(
    (element) => element.getAttribute(TAB_ID_ATTRIBUTE) === id,
  );
  tab?.scrollIntoView({ inline: 'nearest', block: 'nearest' });
}

/**
 * O botão "⌄" ao lado de uma faixa de abas que rola: lista as abas fora de vista (`items`, só elas) e, ao escolher
 * uma, chama `onSelect(id)` e a traz para a vista. Sem abas escondidas, não aparece.
 */
export function TabsOverflow({
  items,
  onSelect,
}: {
  items: readonly TabsOverflowItem[];
  onSelect: (id: string) => void;
}) {
  // Escolher uma aba leva o foco a ela (quem usa o faz em `onSelect`): o menu não o devolve ao botão.
  const chose = useRef(false);
  if (items.length === 0) return null;
  return (
    <span className="tabs-overflow">
      <MenuAcoes
        rotulo="Abas fora de vista"
        icone={<ChevronDown {...ICON_PROPS} />}
        aoFecharDevolverFoco={(event) => {
          if (!chose.current) return;
          chose.current = false;
          event.preventDefault();
        }}
        acoes={items.map((item) => ({
          rotulo: item.label,
          onSelecionar: () => {
            chose.current = true;
            onSelect(item.id);
            scrollTabIntoView(item.id);
          },
        }))}
      />
    </span>
  );
}
