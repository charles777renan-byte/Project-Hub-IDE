// Sem zod: o processo principal e o renderer importam este arquivo direto (ver `layout-limits.ts`).
// Dos contratos só entram tipos.
import type { LayoutLeaf, LayoutNode, LayoutSplit } from './workspace';
import { LAYOUT_LIMITS } from './layout-limits';

/**
 * As operações puras da árvore de layout. Nenhuma muda a entrada. As que não acham o que procuram (folha ou divisão
 * inexistente) devolvem a mesma árvore, e quem chama compara por referência para saber se algo mudou.
 *
 * Toda árvore devolvida está normalizada: nenhuma divisão tem um filho só, nenhuma divisão tem como filho outra da
 * mesma direção (ela é desfeita no pai) e os tamanhos de cada divisão somam 1.
 */

export type Direction = LayoutSplit['direction'];
/** O lado de uma folha em que outra entra. */
export type Side = 'left' | 'right' | 'top' | 'bottom';

const directionOf = (side: Side): Direction =>
  side === 'left' || side === 'right' ? 'row' : 'column';
const comesBefore = (side: Side): boolean => side === 'left' || side === 'top';

/** As folhas da esquerda/cima para a direita/baixo. */
export function leavesOf(node: LayoutNode | null): LayoutLeaf[] {
  if (node === null) return [];
  if (node.type === 'leaf') return [node];
  return node.children.flatMap(leavesOf);
}

export function findLeaf(node: LayoutNode | null, leafId: string): LayoutLeaf | undefined {
  return leavesOf(node).find((leaf) => leaf.id === leafId);
}

export function findSplit(node: LayoutNode | null, splitId: string): LayoutSplit | undefined {
  if (node === null || node.type === 'leaf') return undefined;
  if (node.id === splitId) return node;
  for (const child of node.children) {
    const found = findSplit(child, splitId);
    if (found !== undefined) return found;
  }
  return undefined;
}

/** Uma cópia em que cada folha passa por `change` (devolver a mesma folha a mantém, e ramos intocados são reaproveitados). */
export function mapLeaves(node: LayoutNode, change: (leaf: LayoutLeaf) => LayoutLeaf): LayoutNode {
  if (node.type === 'leaf') return change(node);
  let changed = false;
  const children = node.children.map((child) => {
    const next = mapLeaves(child, change);
    if (next !== child) changed = true;
    return next;
  });
  return changed ? { ...node, children } : node;
}

/** Os tamanhos, positivos e somando 1. Valores inválidos viram partes iguais. */
export function normalizeSizes(sizes: readonly number[]): number[] {
  const safe = sizes.map((size) => (Number.isFinite(size) && size > 0 ? size : 0));
  const total = safe.reduce((sum, size) => sum + size, 0);
  if (!(total > 0) || safe.some((size) => size === 0)) return sizes.map(() => 1 / sizes.length);
  return safe.map((size) => size / total);
}

/**
 * Como `normalizeSizes`, mas nenhum tamanho fica abaixo de `LAYOUT_LIMITS.minSize`: quem ficaria vai ao mínimo e os
 * outros repartem o resto na proporção que tinham.
 */
export function clampSizes(sizes: readonly number[]): number[] {
  const floor = LAYOUT_LIMITS.minSize;
  const wanted = normalizeSizes(sizes);
  if (floor * wanted.length >= 1) return wanted.map(() => 1 / wanted.length);
  const pinned = new Set<number>();
  for (;;) {
    const free = 1 - floor * pinned.size;
    const freeTotal = wanted.reduce((sum, size, i) => (pinned.has(i) ? sum : sum + size), 0);
    const next = wanted.map((size, i) => (pinned.has(i) ? floor : (size / freeTotal) * free));
    const low = next.findIndex((size, i) => !pinned.has(i) && size < floor);
    if (low < 0) return next;
    pinned.add(low);
  }
}

/** Desfaz as divisões de um filho só e as de mesma direção dentro de outra, e acerta os tamanhos. */
export function normalize(node: LayoutNode): LayoutNode {
  if (node.type === 'leaf') return node;
  const children: LayoutNode[] = [];
  const sizes: number[] = [];
  const own = normalizeSizes(node.children.map((_, index) => node.sizes[index] ?? 0));
  node.children.forEach((raw, index) => {
    const child = normalize(raw);
    const size = own[index] ?? 1 / node.children.length;
    if (child.type === 'split' && child.direction === node.direction) {
      child.children.forEach((inner, innerIndex) => {
        children.push(inner);
        sizes.push(size * (child.sizes[innerIndex] ?? 0));
      });
    } else {
      children.push(child);
      sizes.push(size);
    }
  });
  const [only] = children;
  if (children.length === 1 && only !== undefined) return only;
  return { ...node, children, sizes: normalizeSizes(sizes) };
}

/** Troca um nó (pelo id) por outro, ou o tira com `null`. O pai que perde um filho passa o tamanho dele ao vizinho. */
function replaceNode(
  node: LayoutNode,
  id: string,
  replacement: LayoutNode | null,
): LayoutNode | null {
  if (node.id === id) return replacement;
  if (node.type === 'leaf') return node;
  const index = node.children.findIndex((child) => child.id === id);
  if (index >= 0) {
    if (replacement !== null) {
      return { ...node, children: node.children.map((c, i) => (i === index ? replacement : c)) };
    }
    // O vizinho absorve o espaço: o anterior, ou o seguinte quando quem sai é o primeiro.
    const heir = index === 0 ? 1 : index - 1;
    const sizes = node.sizes.map((size, i) =>
      i === heir ? size + (node.sizes[index] ?? 0) : size,
    );
    return {
      ...node,
      children: node.children.filter((_, i) => i !== index),
      sizes: sizes.filter((_, i) => i !== index),
    };
  }
  let changed = false;
  const children = node.children.map((child) => {
    const next = replaceNode(child, id, replacement);
    if (next !== child) changed = true;
    // Só um filho direto some (tratado acima): aqui o filho sempre continua existindo.
    return next ?? child;
  });
  return changed ? { ...node, children } : node;
}

/**
 * Põe `added` ao lado da folha `leafId`. Se a folha já está numa divisão da mesma direção, a nova entra como irmã e
 * as duas repartem ao meio o espaço que era da folha; senão a folha vira uma divisão de duas partes iguais.
 */
export function splitLeaf(
  root: LayoutNode,
  leafId: string,
  side: Side,
  added: LayoutLeaf,
  newId: () => string,
): LayoutNode {
  const target = findLeaf(root, leafId);
  if (target === undefined || findLeaf(root, added.id) !== undefined) return root;
  const direction = directionOf(side);
  const pair = comesBefore(side) ? [added, target] : [target, added];

  const insert = (node: LayoutNode): LayoutNode => {
    if (node.type === 'leaf') {
      return node.id === leafId
        ? { type: 'split', id: newId(), direction, children: pair, sizes: [0.5, 0.5] }
        : node;
    }
    const index = node.children.findIndex((child) => child.id === leafId);
    if (index >= 0 && node.direction === direction) {
      const half = (node.sizes[index] ?? 0) / 2;
      return {
        ...node,
        children: [...node.children.slice(0, index), ...pair, ...node.children.slice(index + 1)],
        sizes: [...node.sizes.slice(0, index), half, half, ...node.sizes.slice(index + 1)],
      };
    }
    let changed = false;
    const children = node.children.map((child) => {
      const next = insert(child);
      if (next !== child) changed = true;
      return next;
    });
    return changed ? { ...node, children } : node;
  };

  return normalize(insert(root));
}

/** Tira a folha. O vizinho absorve o espaço e a divisão que ficar com um filho só é trocada por ele. `null` sem folhas. */
export function removeLeaf(root: LayoutNode | null, leafId: string): LayoutNode | null {
  if (root === null || findLeaf(root, leafId) === undefined) return root;
  const next = replaceNode(root, leafId, null);
  return next === null ? null : normalize(next);
}

/** Troca as duas folhas de lugar. Os tamanhos ficam com os lugares, não com as folhas. */
export function swapLeaves(root: LayoutNode, firstId: string, secondId: string): LayoutNode {
  const first = findLeaf(root, firstId);
  const second = findLeaf(root, secondId);
  if (first === undefined || second === undefined || firstId === secondId) return root;
  return mapLeaves(root, (leaf) =>
    leaf.id === firstId ? second : leaf.id === secondId ? first : leaf,
  );
}

/** Tira a folha `sourceId` de onde está e a encaixa no lado `side` da folha `targetId`, que cede metade do espaço. */
export function dockLeaf(
  root: LayoutNode,
  sourceId: string,
  targetId: string,
  side: Side,
  newId: () => string,
): LayoutNode {
  const source = findLeaf(root, sourceId);
  if (source === undefined || sourceId === targetId || findLeaf(root, targetId) === undefined) {
    return root;
  }
  const without = removeLeaf(root, sourceId);
  if (without === null) return root;
  return splitLeaf(without, targetId, side, source, newId);
}

/**
 * Os tamanhos novos de uma divisão, nunca abaixo do mínimo. Divisão inexistente ou lista de outro comprimento não
 * muda nada.
 */
export function withSizes(root: LayoutNode, splitId: string, sizes: readonly number[]): LayoutNode {
  const split = findSplit(root, splitId);
  if (split === undefined || sizes.length !== split.children.length) return root;
  const next = clampSizes(sizes);
  if (next.every((size, index) => Math.abs(size - (split.sizes[index] ?? 0)) < 1e-6)) return root;
  const apply = (node: LayoutNode): LayoutNode => {
    if (node.type === 'leaf') return node;
    if (node.id === splitId) return { ...node, sizes: next };
    let changed = false;
    const children = node.children.map((child) => {
      const replaced = apply(child);
      if (replaced !== child) changed = true;
      return replaced;
    });
    return changed ? { ...node, children } : node;
  };
  return apply(root);
}

/**
 * Move a divisória entre os filhos `index` e `index + 1` de uma divisão: `fraction` é quanto do espaço dos dois fica
 * com o primeiro. `minFirst` e `minSecond` são as menores frações (do espaço da divisão inteira) que cada lado aceita:
 * a divisória para nesses limites. Se os dois mínimos não cabem juntos, nada muda.
 */
export function moveDivider(
  root: LayoutNode,
  splitId: string,
  index: number,
  fraction: number,
  minFirst: number = LAYOUT_LIMITS.minSize,
  minSecond: number = LAYOUT_LIMITS.minSize,
): LayoutNode {
  const split = findSplit(root, splitId);
  const first = split?.sizes[index];
  const second = split?.sizes[index + 1];
  if (split === undefined || first === undefined || second === undefined) return root;
  const pair = first + second;
  if (minFirst + minSecond > pair + 1e-9) return root;
  const wanted = Math.min(pair - minSecond, Math.max(minFirst, fraction * pair));
  return withSizes(
    root,
    splitId,
    split.sizes.map((size, i) => (i === index ? wanted : i === index + 1 ? pair - wanted : size)),
  );
}

/** Iguala os dois lados de uma divisória (o duplo clique nela). */
export function equalizeDivider(root: LayoutNode, splitId: string, index: number): LayoutNode {
  return moveDivider(root, splitId, index, 0.5);
}

/**
 * O menor tamanho, no eixo dado, que a árvore pede: uma folha pede `leafMin`; uma divisão no próprio eixo soma os
 * filhos e os vãos entre eles; no outro eixo, vale o maior dos filhos.
 */
export function minExtent(
  node: LayoutNode,
  axis: 'width' | 'height',
  leafMin: number,
  gap: number,
): number {
  if (node.type === 'leaf') return leafMin;
  const parts = node.children.map((child) => minExtent(child, axis, leafMin, gap));
  const along = (axis === 'width') === (node.direction === 'row');
  return along
    ? parts.reduce((sum, part) => sum + part, 0) + gap * (parts.length - 1)
    : Math.max(...parts);
}

export type LeafRect = { x: number; y: number; width: number; height: number };

/** O retângulo de cada folha num quadrado de lado 1 (sem os vãos). */
export function rectsOf(root: LayoutNode | null): Map<string, LeafRect> {
  const rects = new Map<string, LeafRect>();
  const visit = (node: LayoutNode, rect: LeafRect) => {
    if (node.type === 'leaf') {
      rects.set(node.id, rect);
      return;
    }
    let offset = 0;
    node.children.forEach((child, index) => {
      const size = node.sizes[index] ?? 0;
      visit(
        child,
        node.direction === 'row'
          ? {
              x: rect.x + offset * rect.width,
              y: rect.y,
              width: size * rect.width,
              height: rect.height,
            }
          : {
              x: rect.x,
              y: rect.y + offset * rect.height,
              width: rect.width,
              height: size * rect.height,
            },
      );
      offset += size;
    });
  };
  if (root !== null) visit(root, { x: 0, y: 0, width: 1, height: 1 });
  return rects;
}

/**
 * A folha vizinha de `leafId` no lado `side`: a que encosta naquela borda e mais se sobrepõe a ela no outro eixo
 * (no empate, a primeira da esquerda/de cima). `null` na borda da área.
 */
export function neighbourAt(root: LayoutNode | null, leafId: string, side: Side): string | null {
  const rects = rectsOf(root);
  const from = rects.get(leafId);
  if (from === undefined) return null;
  const EPS = 1e-6;
  let best: string | null = null;
  let bestOverlap = EPS;
  for (const [id, rect] of rects) {
    if (id === leafId) continue;
    const touches =
      side === 'left'
        ? Math.abs(rect.x + rect.width - from.x) < EPS
        : side === 'right'
          ? Math.abs(rect.x - (from.x + from.width)) < EPS
          : side === 'top'
            ? Math.abs(rect.y + rect.height - from.y) < EPS
            : Math.abs(rect.y - (from.y + from.height)) < EPS;
    if (!touches) continue;
    const overlap =
      side === 'left' || side === 'right'
        ? Math.min(rect.y + rect.height, from.y + from.height) - Math.max(rect.y, from.y)
        : Math.min(rect.x + rect.width, from.x + from.width) - Math.max(rect.x, from.x);
    if (overlap > bestOverlap + EPS) {
      best = id;
      bestOverlap = overlap;
    }
  }
  return best;
}

const even = (count: number): number[] => Array.from({ length: count }, () => 1 / count);

function group(
  direction: Direction,
  children: LayoutNode[],
  newId: () => string,
): LayoutNode | null {
  const [only] = children;
  if (only === undefined) return null;
  if (children.length === 1) return only;
  return { type: 'split', id: newId(), direction, children, sizes: even(children.length) };
}

function chunks<T>(items: readonly T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/** Uma grade de `columns` colunas, preenchida de cima para baixo: uma divisão em coluna com uma linha por faixa. */
function gridOf(
  leaves: readonly LayoutLeaf[],
  columns: number,
  newId: () => string,
): LayoutNode | null {
  const rows = chunks(leaves, Math.max(1, columns)).flatMap(
    (row) => group('row', row, newId) ?? [],
  );
  return group('column', rows, newId);
}

export const LAYOUT_PRESETS = ['side-by-side', 'main-stack', 'grid', 'three-columns'] as const;
export type LayoutPreset = (typeof LAYOUT_PRESETS)[number];

/** Quantos painéis o layout pronto mostra quando há menos que isso (os que faltam entram vazios). */
export const PRESET_SLOTS: Record<LayoutPreset, number> = {
  'side-by-side': 2,
  'main-stack': 3,
  grid: 4,
  'three-columns': 3,
};

/**
 * Um layout pronto montado com as folhas dadas, na ordem: `side-by-side` põe todas numa linha; `main-stack`, a
 * primeira grande à esquerda (60%) e as outras empilhadas à direita; `grid`, uma grade (2×2 com quatro);
 * `three-columns`, três colunas, com as folhas a mais empilhadas dentro das colunas. Quem chama completa a lista até
 * `PRESET_SLOTS` com folhas vazias, se quiser todos os lugares.
 */
export function presetLayout(
  preset: LayoutPreset,
  leaves: readonly LayoutLeaf[],
  newId: () => string,
): LayoutNode | null {
  const [first, ...rest] = leaves;
  if (first === undefined) return null;
  if (rest.length === 0) return first;
  if (preset === 'side-by-side') return group('row', [...leaves], newId);
  if (preset === 'grid') {
    return gridOf(leaves, Math.max(2, Math.ceil(Math.sqrt(leaves.length))), newId);
  }
  if (preset === 'main-stack') {
    const stack = group('column', rest, newId);
    if (stack === null) return first;
    return {
      type: 'split',
      id: newId(),
      direction: 'row',
      children: [first, stack],
      sizes: [0.6, 0.4],
    };
  }
  const columns: LayoutLeaf[][] = [[], [], []];
  leaves.forEach((leaf, index) => columns[index % 3]?.push(leaf));
  return group(
    'row',
    columns.flatMap((column) => group('column', column, newId) ?? []),
    newId,
  );
}

/**
 * A arrumação automática das folhas, na ordem da lista: sem folhas não há layout (`null`); com 2, lado a lado; com 3,
 * uma à esquerda e duas empilhadas à direita (meio a meio); com 4 ou mais, uma grade de `ceil(sqrt(n))` colunas.
 */
export function arrangeLeaves(
  leaves: readonly LayoutLeaf[],
  newId: () => string,
): LayoutNode | null {
  const [first, ...rest] = leaves;
  if (first !== undefined && rest.length === 2) {
    const stack = group('column', rest, newId);
    return group('row', stack === null ? [first] : [first, stack], newId);
  }
  return gridOf(leaves, Math.ceil(Math.sqrt(leaves.length)), newId);
}

/**
 * Converte o formato antigo de divisão (`first`, `second` e `ratio`) no atual (`children` e `sizes`), na árvore
 * inteira. O que já está no formato atual, ou não é um layout, passa como veio: quem valida é o esquema.
 */
export function upgradeLegacyLayout(value: unknown, depth = 0): unknown {
  if (typeof value !== 'object' || value === null || depth > LAYOUT_LIMITS.maxDepth * 4) {
    return value;
  }
  const item = value as Record<string, unknown>;
  if (item['type'] !== 'split') return value;
  if (Array.isArray(item['children'])) {
    return {
      ...item,
      children: item['children'].map((child) => upgradeLegacyLayout(child, depth + 1)),
    };
  }
  if (!('first' in item) || !('second' in item)) return value;
  const { first, second, ratio, ...kept } = item;
  const share = typeof ratio === 'number' && ratio > 0 && ratio < 1 ? ratio : 0.5;
  return {
    ...kept,
    children: [upgradeLegacyLayout(first, depth + 1), upgradeLegacyLayout(second, depth + 1)],
    sizes: [share, 1 - share],
  };
}
