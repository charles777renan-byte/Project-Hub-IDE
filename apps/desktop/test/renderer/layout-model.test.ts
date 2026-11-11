import { describe, expect, it } from 'vitest';
import type { LayoutLeaf, LayoutNode, LayoutSplit } from '@project-hub/contracts';
import {
  findLeaf,
  firstFreeLeaf,
  leafHolding,
  leavesOf,
  restoreArrangement,
  withTerminal,
} from '../../src/renderer/workspace/layout-model';

const leaf = (id: string, provider: LayoutLeaf['provider'], terminalId: string | null = null) =>
  ({ type: 'leaf', id, provider, terminalId }) satisfies LayoutLeaf;

const split = (
  id: string,
  first: LayoutNode,
  second: LayoutNode,
  ratio = 0.5,
  direction: LayoutSplit['direction'] = 'row',
): LayoutSplit => ({
  type: 'split',
  id,
  direction,
  children: [first, second],
  sizes: [ratio, 1 - ratio],
});

const padrao = (): LayoutSplit =>
  split(
    'raiz',
    leaf('a', 'claude'),
    split('meio', leaf('b', 'codex'), leaf('c', 'shell'), 0.5, 'column'),
    0.52,
  );

const terminalOf = (node: LayoutNode, leafId: string) => {
  const found = findLeaf(node, leafId);
  return found === undefined ? 'inexistente' : found.terminalId;
};

describe('leavesOf', () => {
  it('lista as folhas da esquerda/cima para a direita/baixo', () => {
    expect(leavesOf(padrao()).map((item) => item.id)).toEqual(['a', 'b', 'c']);
  });

  it('devolve a própria folha quando a raiz é uma folha', () => {
    const so = leaf('so', 'antigravity');
    expect(leavesOf(so)).toEqual([so]);
  });
});

describe('findLeaf e leafHolding', () => {
  it('acha a folha pelo id', () => {
    expect(findLeaf(padrao(), 'b')?.provider).toBe('codex');
    expect(findLeaf(padrao(), 'meio')).toBeUndefined();
    expect(findLeaf(padrao(), 'nenhuma')).toBeUndefined();
  });

  it('acha a folha que guarda o terminal', () => {
    const layout = withTerminal(padrao(), 'c', 't9');
    expect(leafHolding(layout, 't9')?.id).toBe('c');
    expect(leafHolding(layout, 'outro')).toBeUndefined();
  });
});

describe('firstFreeLeaf', () => {
  it('devolve a primeira folha sem terminal', () => {
    expect(firstFreeLeaf(padrao())?.id).toBe('a');
  });

  it('pula a folha ocupada', () => {
    expect(firstFreeLeaf(withTerminal(padrao(), 'a', 't1'))?.id).toBe('b');
  });

  it('devolve undefined quando todas estão ocupadas', () => {
    let layout: LayoutNode = padrao();
    layout = withTerminal(layout, 'a', 't1');
    layout = withTerminal(layout, 'b', 't2');
    layout = withTerminal(layout, 'c', 't3');
    expect(firstFreeLeaf(layout)).toBeUndefined();
  });
});

describe('withTerminal', () => {
  it('põe o terminal na folha sem alterar o original', () => {
    const original = padrao();
    const snapshot = structuredClone(original);
    const next = withTerminal(original, 'a', 't1');

    expect(terminalOf(next, 'a')).toBe('t1');
    expect(original).toEqual(snapshot);
    expect(next).not.toBe(original);
  });

  it('compartilha as partes que não mudaram', () => {
    const original = padrao();
    const next = withTerminal(original, 'a', 't1') as LayoutSplit;
    expect(next.children[1]).toBe(original.children[1]);
  });

  it('tira o mesmo terminal de qualquer outra folha', () => {
    const comT1 = withTerminal(padrao(), 'a', 't1');
    const movido = withTerminal(comT1, 'b', 't1');

    expect(terminalOf(movido, 'a')).toBeNull();
    expect(terminalOf(movido, 'b')).toBe('t1');
    expect(terminalOf(comT1, 'a')).toBe('t1');
  });

  it('limpa o terminal da folha com null', () => {
    const comT1 = withTerminal(padrao(), 'a', 't1');
    expect(terminalOf(withTerminal(comT1, 'a', null), 'a')).toBeNull();
  });

  it('devolve o mesmo objeto quando a folha não existe', () => {
    const original = padrao();
    expect(withTerminal(original, 'nenhuma', 't1')).toBe(original);
    expect(withTerminal(original, 'meio', 't1')).toBe(original);
  });

  it('devolve o mesmo objeto quando nada muda', () => {
    const original = withTerminal(padrao(), 'a', 't1');
    expect(withTerminal(original, 'a', 't1')).toBe(original);
    const vazio = padrao();
    expect(withTerminal(vazio, 'a', null)).toBe(vazio);
  });
});

describe('restoreArrangement', () => {
  it('traz o arranjo de antes com as sessões de agora', () => {
    const antes = padrao();
    // Depois do movimento, `a` e `c` trocaram de lugar e `b` ganhou uma sessão.
    const agora = split(
      'raiz',
      leaf('c', 'shell'),
      split('meio', leaf('b', 'codex', 't7'), leaf('a', 'claude'), 0.5, 'column'),
      0.3,
    );
    const volta = restoreArrangement(antes, agora);
    expect(leavesOf(volta).map((item) => item.id)).toEqual(['a', 'b', 'c']);
    expect(terminalOf(volta as LayoutNode, 'b')).toBe('t7');
    expect((volta as LayoutSplit).sizes).toEqual([0.52, 0.48]);
  });

  it('não serve mais se um painel abriu ou fechou depois', () => {
    const antes = padrao();
    expect(
      restoreArrangement(antes, split('r', leaf('a', 'claude'), leaf('b', 'codex'))),
    ).toBeNull();
    expect(
      restoreArrangement(
        antes,
        split('r', leaf('a', 'claude'), split('m', leaf('b', 'codex'), leaf('x', 'shell'))),
      ),
    ).toBeNull();
  });
});

describe('layout vazio (null)', () => {
  it('leavesOf(null) é lista vazia', () => {
    expect(leavesOf(null)).toEqual([]);
  });

  it('findLeaf, leafHolding e firstFreeLeaf devolvem undefined', () => {
    expect(findLeaf(null, 'a')).toBeUndefined();
    expect(firstFreeLeaf(null)).toBeUndefined();
    expect(leafHolding(null, 't1')).toBeUndefined();
  });

  it('withTerminal devolve null', () => {
    expect(withTerminal(null, 'a', 't1')).toBeNull();
  });
});
