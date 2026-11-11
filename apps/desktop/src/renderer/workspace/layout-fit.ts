import {
  leavesOf,
  minExtent,
  rectsOf,
  splitLeaf,
  type Side,
} from '@project-hub/contracts/layout-ops';
import type { LayoutLeaf, LayoutNode } from '@project-hub/contracts';

/**
 * As decisões puras de tamanho da área dos terminais: se o layout da pessoa cabe na área, onde um painel novo entra e
 * quem o modo foco guarda montado. Nada daqui toca no layout guardado.
 */

/** Mínimo de cada terminal mostrado, em px. */
export const PANE_MIN_WIDTH = 340;
export const PANE_MIN_HEIGHT = 200;
/** Vão entre painéis (a divisória), em px. */
export const PANE_GAP = 8;

export type AreaSize = { width: number; height: number };

/** Se a árvore cabe na área com todo painel no tamanho mínimo. Sem cabimento, a página entra no modo foco. */
export function layoutFits(layout: LayoutNode, area: AreaSize): boolean {
  return (
    minExtent(layout, 'width', PANE_MIN_WIDTH, PANE_GAP) <= area.width &&
    minExtent(layout, 'height', PANE_MIN_HEIGHT, PANE_GAP) <= area.height
  );
}

/**
 * Onde um painel novo entra quando a pessoa não escolhe: ao lado de uma folha, à direita ou abaixo. Entre os lugares em
 * que o layout continua cabendo na área, vale o que deixa o painel novo maior (em px²); se nenhum cabe, vale o maior
 * mesmo assim (a página passa ao modo foco). Sem medida da área, o quadrado de lado 1 serve de régua. `null` sem folhas.
 */
export function bestPlacement(
  layout: LayoutNode | null,
  area: AreaSize | null,
): { leafId: string; side: Side } | null {
  if (layout === null) return null;
  const rects = rectsOf(layout);
  // Sem medida, a área costuma ser mais larga que alta.
  const width = area?.width ?? 1.6;
  const height = area?.height ?? 1;
  const probe: LayoutLeaf = { type: 'leaf', id: ' probe', provider: 'shell', terminalId: null };
  let best: { leafId: string; side: Side; fits: boolean; size: number } | null = null;
  for (const leaf of leavesOf(layout)) {
    const rect = rects.get(leaf.id);
    if (rect === undefined) continue;
    for (const side of ['right', 'bottom'] as const) {
      const size =
        rect.width *
        width *
        (side === 'right' ? 0.5 : 1) *
        (rect.height * height * (side === 'bottom' ? 0.5 : 1));
      const fits =
        area !== null &&
        layoutFits(
          splitLeaf(layout, leaf.id, side, probe, () => ' split'),
          area,
        );
      const better =
        best === null || (fits && !best.fits) || (fits === best.fits && size > best.size * 1.001);
      if (better) best = { leafId: leaf.id, side, fits, size };
    }
  }
  return best === null ? null : { leafId: best.leafId, side: best.side };
}

/**
 * Quem o modo foco guarda montado quando há mais painéis que `capacity` (menos de 1 vale 1). Mantém os já montados que
 * ainda existem; se o ativo não estava entre eles, ele toma o lugar do último; se a capacidade encolheu, sai do fim
 * (nunca o ativo); os lugares livres são preenchidos pela ordem de `leafIds`. `shown` e `hidden` seguem a ordem de
 * `leafIds`.
 */
export function pickVisible(
  leafIds: readonly string[],
  previous: readonly string[],
  activeId: string | null,
  capacity: number,
): { shown: string[]; hidden: string[] } {
  const room = Math.max(1, Math.floor(capacity));
  const existing = new Set(leafIds);
  const active = activeId !== null && existing.has(activeId) ? activeId : null;

  const keptSet = new Set(previous.filter((id) => existing.has(id)));
  let kept = leafIds.filter((id) => keptSet.has(id));

  if (active !== null && !keptSet.has(active)) {
    if (kept.length >= room) kept = kept.slice(0, room - 1);
    kept = [...kept, active];
  }
  // Acima da capacidade: sai do fim, poupando o ativo.
  for (let i = kept.length - 1; i >= 0 && kept.length > room; i -= 1) {
    if (kept[i] !== active) kept.splice(i, 1);
  }
  for (const id of leafIds) {
    if (kept.length >= room) break;
    if (!kept.includes(id)) kept.push(id);
  }

  const shownSet = new Set(kept);
  return {
    shown: leafIds.filter((id) => shownSet.has(id)),
    hidden: leafIds.filter((id) => !shownSet.has(id)),
  };
}
