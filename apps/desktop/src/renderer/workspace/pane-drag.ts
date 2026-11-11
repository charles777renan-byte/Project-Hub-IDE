import { dockLeaf, rectsOf, type Side } from '@project-hub/contracts/layout-ops';
import type { LayoutNode } from '@project-hub/contracts';

/** Quanto o ponteiro precisa andar, em px, para o gesto virar arrasto (menos que isso é um clique). */
export const DRAG_THRESHOLD = 6;
/** A fatia central do painel de destino, em cada eixo, que troca os dois de lugar. */
export const SWAP_SHARE = 0.4;

export type Box = { left: number; top: number; width: number; height: number };

/** Onde o painel arrastado cai dentro do painel de destino: no meio (troca) ou junto de uma borda (encaixa). */
export type DropSpot = 'center' | Side;

/** O destino do arrasto: o painel sob o ponteiro e o ponto dele. */
export type DropZone = { targetId: string; spot: DropSpot };

/**
 * O ponto do painel de destino em que o ponteiro está. Os 40% centrais (nos dois eixos) trocam os painéis de lugar;
 * fora deles vale a borda mais próxima, medida em proporção do painel (num painel largo e baixo, o canto ainda vai
 * para o lado certo). Ponteiro fora da caixa não tem ponto.
 */
export function spotAt(box: Box, x: number, y: number): DropSpot | null {
  if (!(box.width > 0) || !(box.height > 0)) return null;
  const dx = (x - box.left) / box.width - 0.5;
  const dy = (y - box.top) / box.height - 0.5;
  if (Math.abs(dx) > 0.5 || Math.abs(dy) > 0.5) return null;
  const half = SWAP_SHARE / 2;
  if (Math.abs(dx) <= half && Math.abs(dy) <= half) return 'center';
  if (Math.abs(dx) >= Math.abs(dy)) return dx < 0 ? 'left' : 'right';
  return dy < 0 ? 'top' : 'bottom';
}

/** A área que o painel arrastado vai ocupar: o destino inteiro na troca, a metade daquele lado no encaixe. */
export function previewBox(box: Box, spot: DropSpot): Box {
  const halfWidth = box.width / 2;
  const halfHeight = box.height / 2;
  switch (spot) {
    case 'center':
      return box;
    case 'left':
      return { ...box, width: halfWidth };
    case 'right':
      return { ...box, left: box.left + halfWidth, width: halfWidth };
    case 'top':
      return { ...box, height: halfHeight };
    case 'bottom':
      return { ...box, top: box.top + halfHeight, height: halfHeight };
  }
}

/** O destino sob o ponteiro, entre as caixas dos painéis na tela; o próprio painel arrastado não é destino. */
export function zoneAt(
  boxes: readonly { id: string; box: Box }[],
  sourceId: string,
  x: number,
  y: number,
): DropZone | null {
  for (const { id, box } of boxes) {
    if (id === sourceId) continue;
    const spot = spotAt(box, x, y);
    if (spot !== null) return { targetId: id, spot };
  }
  return null;
}

const SAME = 0.0005;

/** Os dois layouts põem cada painel no mesmo lugar, com o mesmo tamanho? */
export function sameArrangement(first: LayoutNode, second: LayoutNode): boolean {
  const a = rectsOf(first);
  const b = rectsOf(second);
  if (a.size !== b.size) return false;
  for (const [id, rect] of a) {
    const other = b.get(id);
    if (other === undefined) return false;
    if (
      Math.abs(rect.x - other.x) > SAME ||
      Math.abs(rect.y - other.y) > SAME ||
      Math.abs(rect.width - other.width) > SAME ||
      Math.abs(rect.height - other.height) > SAME
    )
      return false;
  }
  return true;
}

/**
 * O layout depois de soltar o painel `sourceId` na borda `side` do painel `targetId`; `null` quando nada mudaria (o
 * painel já está ali, com aquele tamanho).
 */
export function dockedLayout(
  layout: LayoutNode,
  sourceId: string,
  targetId: string,
  side: Side,
  newId: () => string,
): LayoutNode | null {
  const next = dockLeaf(layout, sourceId, targetId, side, newId);
  return next === layout || sameArrangement(layout, next) ? null : next;
}
