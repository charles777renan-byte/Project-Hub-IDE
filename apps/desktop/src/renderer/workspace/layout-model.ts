import { findLeaf, leavesOf, mapLeaves } from '@project-hub/contracts/layout-ops';
import type { LayoutLeaf, LayoutNode } from '@project-hub/contracts';

/**
 * As consultas e a edição de sessão da árvore de layout do workspace. As operações de estrutura (dividir, fechar,
 * trocar, encaixar, redimensionar) ficam em `@project-hub/contracts/layout-ops`, que o processo principal também usa.
 * Nenhuma função muda a entrada: quando nada muda devolvem o mesmo objeto (quem chama compara por referência para
 * saber se precisa gravar).
 */

export { findLeaf, leavesOf };

/** A folha que guarda a sessão de terminal, se alguma guarda. */
export function leafHolding(node: LayoutNode | null, terminalId: string): LayoutLeaf | undefined {
  return leavesOf(node).find((leaf) => leaf.terminalId === terminalId);
}

/** A primeira folha sem sessão aberta. */
export function firstFreeLeaf(node: LayoutNode | null): LayoutLeaf | undefined {
  return leavesOf(node).find((leaf) => leaf.terminalId === null);
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
  return mapLeaves(node, (leaf) => {
    if (leaf.id === leafId) return leaf.terminalId === terminalId ? leaf : { ...leaf, terminalId };
    return terminalId !== null && leaf.terminalId === terminalId
      ? { ...leaf, terminalId: null }
      : leaf;
  });
}

/**
 * Um layout guardado de antes (`previous`) trazido para as sessões de agora (`current`), para desfazer um movimento:
 * vale só se os dois têm exatamente as mesmas folhas, e cada folha fica com a sessão que tem hoje. `null` se as folhas
 * mudaram (um painel abriu ou fechou depois): aquele layout não serve mais.
 */
export function restoreArrangement(previous: LayoutNode, current: LayoutNode): LayoutNode | null {
  const now = new Map(leavesOf(current).map((leaf) => [leaf.id, leaf]));
  const before = leavesOf(previous);
  if (before.length !== now.size || before.some((leaf) => !now.has(leaf.id))) return null;
  return mapLeaves(previous, (leaf) => now.get(leaf.id) ?? leaf);
}
