import type { LayoutLeaf, LayoutNode } from '@project-hub/contracts';
import { arrangeLeaves } from '@project-hub/contracts/layout-arrange';
import { describe, expect, it } from 'vitest';
import type { MarkKind } from '../../src/renderer/state-mark';
import {
  columnsOf,
  dockOrder,
  gridFit,
  minExtent,
  PANE_MIN_HEIGHT,
  PANE_MIN_WIDTH,
  pickVisible,
  rowsOf,
} from '../../src/renderer/workspace/layout-fit';

function leaves(n: number): LayoutLeaf[] {
  return Array.from(
    { length: n },
    (_, i) => ({ type: 'leaf', id: `p${i}`, terminalId: `t${i}` }) as LayoutLeaf,
  );
}

function arranged(n: number): LayoutNode {
  let seq = 0;
  const node = arrangeLeaves(leaves(n), () => `s${seq++}`);
  if (node === null) throw new Error('sem layout');
  return node;
}

describe('gridFit', () => {
  it('em 1200 × 600 cabem 3 colunas e 2 linhas', () => {
    expect(gridFit(1200, 600)).toEqual({ mode: 'grid', columns: 3, rows: 2 });
  });

  it('em 1099 × 600 cabem 2 colunas (faixa de 2) e 2 linhas', () => {
    expect(gridFit(1099, 600)).toEqual({ mode: 'grid', columns: 2, rows: 2 });
  });

  it('em 720 × 300 cabem 2 colunas e 1 linha', () => {
    expect(gridFit(720, 300)).toEqual({ mode: 'grid', columns: 2, rows: 1 });
  });

  it('abaixo de 720 de largura é o modo Abas', () => {
    expect(gridFit(719, 900)).toEqual({ mode: 'solo' });
  });

  it('as linhas nunca ficam abaixo de 1', () => {
    expect(gridFit(1100, 259)).toEqual({ mode: 'grid', columns: 3, rows: 1 });
  });

  it('a faixa de 2 limita as colunas mesmo quando a conta daria 3', () => {
    // (1043 + 8) / 348 = 3,02: a conta daria 3, mas a faixa de 720 a 1099 só vai a 2.
    expect(gridFit(1043, 600)).toEqual({ mode: 'grid', columns: 2, rows: 2 });
  });

  it('em 1100 de largura a conta dá exatamente 3 colunas', () => {
    expect(Math.floor((1100 + 8) / 348)).toBe(3);
    expect(gridFit(1100, 600)).toMatchObject({ mode: 'grid', columns: 3 });
  });
});

describe('columnsOf e rowsOf', () => {
  it.each([
    [1, 1, 1],
    [3, 2, 2],
    [4, 2, 2],
    [6, 3, 2],
  ])('com %i folhas: %i colunas e %i linhas', (n, columns, rows) => {
    const tree = arranged(n);
    expect(columnsOf(tree)).toBe(columns);
    expect(rowsOf(tree)).toBe(rows);
  });
});

describe('minExtent', () => {
  it('uma folha pede o mínimo de um painel', () => {
    const tree = arranged(1);
    expect(minExtent(tree, 'width')).toBe(PANE_MIN_WIDTH);
    expect(minExtent(tree, 'height')).toBe(PANE_MIN_HEIGHT);
  });

  it('seis folhas (3 × 2) somam os mínimos e os vãos', () => {
    const tree = arranged(6);
    expect(minExtent(tree, 'width')).toBe(3 * 340 + 2 * 8);
    expect(minExtent(tree, 'height')).toBe(2 * 260 + 8);
  });

  it('com o mínimo de folha dado, usa esse valor no lugar do padrão', () => {
    const tree = arranged(6);
    expect(minExtent(tree, 'width', 100)).toBe(3 * 100 + 2 * 8);
    expect(minExtent(tree, 'height', 100)).toBe(2 * 100 + 8);
  });
});

describe('pickVisible', () => {
  const ids = ['a', 'b', 'c', 'd', 'e', 'f'];

  it('quando tudo cabe, mostra todos na ordem e não esconde ninguém', () => {
    expect(pickVisible(ids, [], 'c', 6)).toEqual({ shown: ids, hidden: [] });
    expect(pickVisible(ids, [], 'c', 10)).toEqual({ shown: ids, hidden: [] });
  });

  it('sem histórico, o ativo entra e o resto preenche pela ordem do layout', () => {
    expect(pickVisible(ids, [], 'f', 4)).toEqual({
      shown: ['a', 'b', 'c', 'f'],
      hidden: ['d', 'e'],
    });
  });

  it('mantém os já mostrados e, se o ativo era ficha, ele toma o lugar do último mostrado', () => {
    expect(pickVisible(ids, ['a', 'b', 'c', 'd'], 'f', 4)).toEqual({
      shown: ['a', 'b', 'c', 'f'],
      hidden: ['d', 'e'],
    });
  });

  it('o painel que deixou de ser ativo é tratado como qualquer outro', () => {
    // `d` era o ativo e estava mostrado; agora o ativo é `f`, que estava fora: sai o último mostrado, `d`.
    expect(pickVisible(ids, ['a', 'b', 'c', 'd'], 'f', 4)).toEqual({
      shown: ['a', 'b', 'c', 'f'],
      hidden: ['d', 'e'],
    });
  });

  it('com o ativo já mostrado, ninguém troca de lugar', () => {
    expect(pickVisible(ids, ['a', 'b', 'c', 'd'], 'b', 4)).toEqual({
      shown: ['a', 'b', 'c', 'd'],
      hidden: ['e', 'f'],
    });
  });

  it('quando a capacidade encolhe, sai do fim e nunca o ativo', () => {
    expect(pickVisible(ids, ['a', 'b', 'c', 'd'], 'c', 2)).toEqual({
      shown: ['a', 'c'],
      hidden: ['b', 'd', 'e', 'f'],
    });
  });

  it('fechar um mostrado faz a primeira ficha, na ordem do layout, entrar', () => {
    const semB = ['a', 'c', 'd', 'e', 'f'];
    expect(pickVisible(semB, ['a', 'b', 'c', 'd'], 'a', 4)).toEqual({
      shown: ['a', 'c', 'd', 'e'],
      hidden: ['f'],
    });
  });

  it('capacidade 0 vale 1', () => {
    expect(pickVisible(ids, [], 'c', 0)).toEqual({
      shown: ['c'],
      hidden: ['a', 'b', 'd', 'e', 'f'],
    });
  });

  it('ativo nulo ou fora da lista não quebra', () => {
    expect(pickVisible(ids, [], null, 2)).toEqual({
      shown: ['a', 'b'],
      hidden: ['c', 'd', 'e', 'f'],
    });
    expect(pickVisible(ids, [], 'zzz', 2)).toEqual({
      shown: ['a', 'b'],
      hidden: ['c', 'd', 'e', 'f'],
    });
  });

  it('ignora ids do histórico que não existem mais e sem folhas devolve vazio', () => {
    expect(pickVisible(['a', 'b'], ['x', 'b'], 'a', 2)).toEqual({ shown: ['a', 'b'], hidden: [] });
    expect(pickVisible([], ['x'], null, 3)).toEqual({ shown: [], hidden: [] });
  });

  it('o resultado sempre segue a ordem de leafIds, mesmo com histórico em outra ordem', () => {
    expect(pickVisible(ids, ['d', 'a'], 'f', 3)).toEqual({
      shown: ['a', 'd', 'f'],
      hidden: ['b', 'c', 'e'],
    });
  });
});

describe('dockOrder', () => {
  it('põe aguardando e erro primeiro, mantendo a ordem de cada grupo', () => {
    const items: { id: string; mark: MarkKind }[] = [
      { id: 'active', mark: 'active' },
      { id: 'waiting', mark: 'waiting' },
      { id: 'disconnected', mark: 'disconnected' },
      { id: 'error', mark: 'error' },
    ];
    expect(dockOrder(items).map((item) => item.id)).toEqual([
      'waiting',
      'error',
      'active',
      'disconnected',
    ]);
  });

  it('não altera a lista recebida', () => {
    const items: { mark: MarkKind }[] = [{ mark: 'done' }, { mark: 'error' }];
    dockOrder(items);
    expect(items.map((item) => item.mark)).toEqual(['done', 'error']);
  });
});
