// Sem zod: o processo principal e o renderer (`showTerminal` do hook do workspace) importam este arquivo
// direto (ver `layout-limits.ts`). Dos contratos só entram tipos.
import type { LayoutLeaf, LayoutNode } from './workspace';
import { LAYOUT_LIMITS } from './layout-limits';

const limitarRatio = (ratio: number): number =>
  Math.min(LAYOUT_LIMITS.maxRatio, Math.max(LAYOUT_LIMITS.minRatio, ratio));

/** Árvore equilibrada: divide a lista ao meio e dá ao lado esquerdo a fração das folhas que ele tem. */
function equilibrar(
  itens: { no: LayoutNode; peso: number }[],
  direction: 'row' | 'column',
  newId: () => string,
): LayoutNode {
  const [unico] = itens;
  if (itens.length === 1 && unico !== undefined) return unico.no;
  const meio = Math.ceil(itens.length / 2);
  const esquerda = itens.slice(0, meio);
  const direita = itens.slice(meio);
  const pesoEsq = esquerda.reduce((soma, i) => soma + i.peso, 0);
  const pesoDir = direita.reduce((soma, i) => soma + i.peso, 0);
  return {
    type: 'split',
    id: newId(),
    direction,
    first: equilibrar(esquerda, direction, newId),
    second: equilibrar(direita, direction, newId),
    ratio: limitarRatio(pesoEsq / (pesoEsq + pesoDir)),
  };
}

/**
 * Reconstrói o layout a partir das folhas, na ordem da lista: sem folhas não há layout (`null`);
 * com 3, uma à esquerda e duas empilhadas à direita; com 4 ou mais, uma grade de `ceil(sqrt(n))`
 * colunas, preenchida de cima para baixo. `newId` dá o id de cada divisão nova.
 */
export function arrangeLeaves(leaves: LayoutLeaf[], newId: () => string): LayoutNode | null {
  const n = leaves.length;
  const [primeira, segunda, terceira] = leaves;
  if (primeira === undefined) return null;
  if (n === 1) return primeira;

  if (n === 3 && segunda !== undefined && terceira !== undefined) {
    return {
      type: 'split',
      id: newId(),
      direction: 'row',
      first: primeira,
      second: {
        type: 'split',
        id: newId(),
        direction: 'column',
        first: segunda,
        second: terceira,
        ratio: 0.5,
      },
      ratio: 0.5,
    };
  }

  const porLinha = Math.ceil(Math.sqrt(n));
  const linhas: { no: LayoutNode; peso: number }[] = [];
  for (let i = 0; i < n; i += porLinha) {
    const grupo = leaves.slice(i, i + porLinha);
    linhas.push({
      no: equilibrar(
        grupo.map((no) => ({ no, peso: 1 })),
        'row',
        newId,
      ),
      peso: grupo.length,
    });
  }
  return equilibrar(linhas, 'column', newId);
}

/** Quantas colunas o `arrangeLeaves` usa para `n` folhas (1 com 1; 2 com 2 e com 3; `ceil(sqrt(n))` de 4 em diante). */
function colunasDaArrumacao(n: number): number {
  if (n <= 1) return 1;
  if (n <= 3) return 2;
  return Math.ceil(Math.sqrt(n));
}

/**
 * Como `arrangeLeaves`, mas com no máximo `maxColumns` colunas (menos de 1 vale 1), para janelas estreitas.
 * Se a arrumação normal já cabe, devolve exatamente ela; senão monta linhas de `maxColumns` folhas, na ordem
 * da lista, empilhadas de cima para baixo (com uma coluna, só divisões `column`). Sem folhas, `null`.
 */
export function arrangeLeavesCapped(
  leaves: LayoutLeaf[],
  maxColumns: number,
  newId: () => string,
): LayoutNode | null {
  const colunas = Math.max(1, Math.floor(maxColumns));
  if (colunasDaArrumacao(leaves.length) <= colunas) return arrangeLeaves(leaves, newId);

  const linhas: { no: LayoutNode; peso: number }[] = [];
  for (let i = 0; i < leaves.length; i += colunas) {
    const grupo = leaves.slice(i, i + colunas);
    linhas.push({
      no: equilibrar(
        grupo.map((no) => ({ no, peso: 1 })),
        'row',
        newId,
      ),
      peso: grupo.length,
    });
  }
  return equilibrar(linhas, 'column', newId);
}
