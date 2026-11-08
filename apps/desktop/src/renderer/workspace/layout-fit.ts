import type { LayoutNode } from '@project-hub/contracts';
import type { MarkKind } from '../state-mark';

/**
 * As decisões puras da grade responsiva: quantas colunas e linhas cabem na área, quem fica na grade quando não cabem
 * todos e em que ordem as fichas do dock aparecem. Nada daqui toca no layout guardado; a página deriva a árvore da tela
 * a partir destes números.
 */

/** Mínimo de cada terminal mostrado, em px. */
export const PANE_MIN_WIDTH = 340;
export const PANE_MIN_HEIGHT = 260;
/** Vão entre painéis, em px. */
export const PANE_GAP = 8;
/** Abaixo desta largura da área, o workspace vira o modo Abas. */
export const SOLO_BELOW = 720;
/** A partir desta largura da área, a grade vai a 3 colunas (antes disso, a 2). */
export const THREE_FROM = 1100;

export type GridFit = { mode: 'grid'; columns: number; rows: number } | { mode: 'solo' };

/**
 * O que cabe numa área de `width` × `height`: o modo Abas abaixo de 720 px; senão colunas = menor entre o máximo da
 * faixa (2, ou 3 a partir de 1100 px) e `floor((largura + vão) / (mínimo + vão))`, e linhas = `floor((altura + vão) /
 * (mínimo + vão))`, nunca abaixo de 1.
 */
export function gridFit(width: number, height: number): GridFit {
  if (width < SOLO_BELOW) return { mode: 'solo' };
  const bandMax = width >= THREE_FROM ? 3 : 2;
  const columns = Math.max(
    1,
    Math.min(bandMax, Math.floor((width + PANE_GAP) / (PANE_MIN_WIDTH + PANE_GAP))),
  );
  const rows = Math.max(1, Math.floor((height + PANE_GAP) / (PANE_MIN_HEIGHT + PANE_GAP)));
  return { mode: 'grid', columns, rows };
}

/** Quantas colunas a árvore ocupa: folha 1; `row` soma os lados; `column` fica com o maior. */
export function columnsOf(node: LayoutNode): number {
  if (node.type === 'leaf') return 1;
  const first = columnsOf(node.first);
  const second = columnsOf(node.second);
  return node.direction === 'row' ? first + second : Math.max(first, second);
}

/** Quantas linhas a árvore ocupa: o inverso de `columnsOf`. */
export function rowsOf(node: LayoutNode): number {
  if (node.type === 'leaf') return 1;
  const first = rowsOf(node.first);
  const second = rowsOf(node.second);
  return node.direction === 'column' ? first + second : Math.max(first, second);
}

/**
 * O menor tamanho, no eixo dado, que a árvore pede: uma folha pede o mínimo de um painel; uma divisão no próprio eixo
 * soma os dois lados e o vão; no outro eixo, vale o maior dos lados.
 */
export function minExtent(node: LayoutNode, axis: 'width' | 'height'): number {
  if (node.type === 'leaf') return axis === 'width' ? PANE_MIN_WIDTH : PANE_MIN_HEIGHT;
  const first = minExtent(node.first, axis);
  const second = minExtent(node.second, axis);
  const splitsThisAxis = (axis === 'width') === (node.direction === 'row');
  return splitsThisAxis ? first + second + PANE_GAP : Math.max(first, second);
}

/**
 * Quem fica na grade quando há mais painéis que `capacity` (menos de 1 vale 1). Mantém os já mostrados que ainda
 * existem; se o ativo não estava entre eles, ele toma o lugar do último mostrado; se a capacidade encolheu, sai do fim
 * (nunca o ativo); os lugares livres são preenchidos pela ordem de `leafIds`. `shown` e `hidden` seguem sempre a ordem
 * de `leafIds`, para a grade nunca trocar painéis de lugar.
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

/** A ordem das fichas do dock: quem espera por você (aguardando e erro) vem primeiro; o resto segue depois. Estável. */
export function dockOrder<T extends { mark: MarkKind }>(items: readonly T[]): T[] {
  const needsYou = (item: T): boolean => item.mark === 'waiting' || item.mark === 'error';
  return [...items.filter(needsYou), ...items.filter((item) => !needsYou(item))];
}
