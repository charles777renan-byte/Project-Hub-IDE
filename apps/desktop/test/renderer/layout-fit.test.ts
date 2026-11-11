import type { LayoutLeaf, LayoutNode } from '@project-hub/contracts';
import { arrangeLeaves } from '@project-hub/contracts/layout-ops';
import { describe, expect, it } from 'vitest';
import {
  bestPlacement,
  layoutFits,
  PANE_GAP,
  PANE_MIN_HEIGHT,
  PANE_MIN_WIDTH,
  pickVisible,
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

describe('layoutFits', () => {
  it('um painel cabe a partir do mínimo de largura e de altura', () => {
    expect(layoutFits(arranged(1), { width: PANE_MIN_WIDTH, height: PANE_MIN_HEIGHT })).toBe(true);
    expect(layoutFits(arranged(1), { width: PANE_MIN_WIDTH - 1, height: 900 })).toBe(false);
    expect(layoutFits(arranged(1), { width: 900, height: PANE_MIN_HEIGHT - 1 })).toBe(false);
  });

  it('lado a lado, soma as larguras mínimas e o vão', () => {
    const justo = 2 * PANE_MIN_WIDTH + PANE_GAP;
    expect(layoutFits(arranged(2), { width: justo, height: PANE_MIN_HEIGHT })).toBe(true);
    expect(layoutFits(arranged(2), { width: justo - 1, height: 900 })).toBe(false);
  });

  it('a grade de quatro pede duas colunas e duas linhas', () => {
    const largura = 2 * PANE_MIN_WIDTH + PANE_GAP;
    const altura = 2 * PANE_MIN_HEIGHT + PANE_GAP;
    expect(layoutFits(arranged(4), { width: largura, height: altura })).toBe(true);
    expect(layoutFits(arranged(4), { width: largura, height: altura - 1 })).toBe(false);
  });
});

describe('bestPlacement', () => {
  it('sem layout não há onde pôr', () => {
    expect(bestPlacement(null, { width: 1200, height: 700 })).toBeNull();
  });

  it('um painel sozinho numa área larga: o novo entra à direita', () => {
    expect(bestPlacement(arranged(1), { width: 1200, height: 700 })).toEqual({
      leafId: 'p0',
      side: 'right',
    });
  });

  it('dois lado a lado sem largura para três: o novo entra abaixo', () => {
    expect(bestPlacement(arranged(2), { width: 900, height: 700 })?.side).toBe('bottom');
  });

  it('prefere o lugar em que o layout continua cabendo, mesmo com painel menor', () => {
    // Uma coluna de dois numa área alta e estreita: à direita não cabe (2 × 340 + vão > 600); abaixo cabe.
    const coluna = arranged(1);
    expect(bestPlacement(coluna, { width: 600, height: 900 })).toEqual({
      leafId: 'p0',
      side: 'bottom',
    });
  });

  it('se nenhum lugar cabe, ainda devolve o maior', () => {
    expect(bestPlacement(arranged(4), { width: 700, height: 420 })).not.toBeNull();
  });

  it('sem medida da área, trata a área como mais larga que alta', () => {
    expect(bestPlacement(arranged(1), null)).toEqual({ leafId: 'p0', side: 'right' });
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

  it('mantém os já mostrados; o ativo que era ficha toma o lugar do último, e o ex-ativo é tratado como qualquer outro', () => {
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
