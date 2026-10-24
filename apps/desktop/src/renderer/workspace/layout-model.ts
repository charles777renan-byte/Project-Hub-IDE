import { LAYOUT_LIMITS } from '@project-hub/contracts/layout-limits';
import type { LayoutLeaf, LayoutNode } from '@project-hub/contracts';

/**
 * Edições puras da árvore de layout do workspace. Nenhuma função muda a entrada: quando nada muda
 * devolvem o mesmo objeto (quem chama compara por referência para saber se precisa gravar), e quando
 * algo muda devolvem uma árvore nova que reaproveita os ramos intocados.
 */

/** As folhas da esquerda/cima para a direita/baixo. */
export function leavesOf(node: LayoutNode | null): LayoutLeaf[] {
  if (node === null) return [];
  if (node.type === 'leaf') return [node];
  return [...leavesOf(node.first), ...leavesOf(node.second)];
}

export function findLeaf(node: LayoutNode | null, leafId: string): LayoutLeaf | undefined {
  return leavesOf(node).find((leaf) => leaf.id === leafId);
}

/** A folha que guarda a sessão de terminal, se alguma guarda. */
export function leafHolding(node: LayoutNode | null, terminalId: string): LayoutLeaf | undefined {
  return leavesOf(node).find((leaf) => leaf.terminalId === terminalId);
}

/** A primeira folha sem sessão aberta. */
export function firstFreeLeaf(node: LayoutNode | null): LayoutLeaf | undefined {
  return leavesOf(node).find((leaf) => leaf.terminalId === null);
}

/** Muda o `ratio` de uma divisão, limitado a `LAYOUT_LIMITS`. Divisão inexistente não muda nada. */
export function withRatio(node: LayoutNode, splitId: string, ratio: number): LayoutNode;
export function withRatio(node: null, splitId: string, ratio: number): null;
export function withRatio(
  node: LayoutNode | null,
  splitId: string,
  ratio: number,
): LayoutNode | null;
export function withRatio(
  node: LayoutNode | null,
  splitId: string,
  ratio: number,
): LayoutNode | null {
  if (node === null) return null;
  if (node.type === 'leaf') return node;

  if (node.id === splitId) {
    const clamped = Math.min(LAYOUT_LIMITS.maxRatio, Math.max(LAYOUT_LIMITS.minRatio, ratio));
    return clamped === node.ratio ? node : { ...node, ratio: clamped };
  }

  const first = withRatio(node.first, splitId, ratio);
  const second = withRatio(node.second, splitId, ratio);
  return first === node.first && second === node.second ? node : { ...node, first, second };
}

/**
 * Põe a sessão na folha (ou limpa, com `null`). Uma sessão só pode estar em um painel, então a
 * mesma sessão sai de qualquer outra folha. Folha inexistente não muda nada, e a sessão fica onde está.
 */
export function withTerminal(
  node: LayoutNode,
  leafId: string,
  terminalId: string | null,
): LayoutNode;
export function withTerminal(node: null, leafId: string, terminalId: string | null): null;
export function withTerminal(
  node: LayoutNode | null,
  leafId: string,
  terminalId: string | null,
): LayoutNode | null;
export function withTerminal(
  node: LayoutNode | null,
  leafId: string,
  terminalId: string | null,
): LayoutNode | null {
  if (node === null) return null;
  if (findLeaf(node, leafId) === undefined) return node;

  const apply = (current: LayoutNode): LayoutNode => {
    if (current.type === 'leaf') {
      if (current.id === leafId) {
        return current.terminalId === terminalId ? current : { ...current, terminalId };
      }
      return terminalId !== null && current.terminalId === terminalId
        ? { ...current, terminalId: null }
        : current;
    }
    const first = apply(current.first);
    const second = apply(current.second);
    return first === current.first && second === current.second
      ? current
      : { ...current, first, second };
  };

  return apply(node);
}
