import { useEffect, useState, type RefObject } from 'react';

/** Folga, em px, entre o fim do cabeçalho fixo e o topo do bloco quando o bloco é trazido à vista. */
const GAP = 8;

/** O corpo da missão, que é quem rola (`.mission-main`), visto a partir de um elemento dentro dele. */
function scrollerOf(element: HTMLElement): HTMLElement | null {
  return element.closest<HTMLElement>('.mission-main');
}

/**
 * Diz se o bloco "Sua decisão" rolou para trás do cabeçalho fixo, e então a barra de decisão aparece no
 * `slot` (o encaixe logo abaixo do cabeçalho, dentro do grupo fixo). A régua é o topo do encaixe: o fim
 * do cabeçalho, que não muda quando a barra entra e por isso não faz a barra piscar.
 *
 * Sem `slot` não há barra, e vale falso. Sem layout (o jsdom, ou um bloco escondido) não há o que medir, e
 * o bloco conta como à vista. `signal` refaz a medida quando o conteúdo do bloco muda de altura.
 */
export function useDecisionOutOfView(
  region: RefObject<HTMLElement | null>,
  slot: HTMLElement | null,
  signal: unknown,
): boolean {
  const [outOfView, setOutOfView] = useState(false);

  useEffect(() => {
    const block = region.current;
    const scroller = slot === null ? null : scrollerOf(slot);
    if (block === null || slot === null || scroller === null) return undefined;

    const measure = () => {
      const rect = block.getBoundingClientRect();
      setOutOfView(rect.height > 1 && rect.bottom <= slot.getBoundingClientRect().top + 1);
    };
    measure();
    scroller.addEventListener('scroll', measure, { passive: true });
    window.addEventListener('resize', measure);
    return () => {
      scroller.removeEventListener('scroll', measure);
      window.removeEventListener('resize', measure);
    };
  }, [region, slot, signal]);

  return slot !== null && outOfView;
}

/**
 * Leva o bloco para baixo do cabeçalho fixo: só rola quando o topo dele está escondido atrás do cabeçalho
 * (ou sempre, com `force`). O `scrollIntoView` do navegador não conta o cabeçalho fixo, então um bloco alto
 * ficaria com o título por baixo dele. Sem `scrollBy` (o jsdom), não faz nada.
 */
export function revealDecision(block: HTMLElement, slot: HTMLElement | null, force = false): void {
  const scroller = scrollerOf(slot ?? block);
  if (scroller === null || typeof scroller.scrollBy !== 'function') return;
  const rect = block.getBoundingClientRect();
  if (rect.height === 0) return;
  const top = (slot ?? scroller).getBoundingClientRect().top;
  if (!force && rect.top >= top) return;
  scroller.scrollBy({ top: rect.top - top - GAP });
}
