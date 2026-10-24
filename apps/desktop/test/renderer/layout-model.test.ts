import { describe, expect, it } from 'vitest';
import type { LayoutLeaf, LayoutNode, LayoutSplit } from '@project-hub/contracts';
import {
  findLeaf,
  firstFreeLeaf,
  leafHolding,
  leavesOf,
  withRatio,
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
): LayoutSplit => ({ type: 'split', id, direction, first, second, ratio });

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
    const so = leaf('so', 'gemini');
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
    expect(next.second).toBe(original.second);
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

describe('withRatio', () => {
  it('muda só a divisão pedida', () => {
    const original = padrao();
    const next = withRatio(original, 'raiz', 0.3) as LayoutSplit;

    expect(next.ratio).toBe(0.3);
    expect((next.second as LayoutSplit).ratio).toBe(0.5);
    expect(next.second).toBe(original.second);
    expect(original.ratio).toBe(0.52);
  });

  it('muda uma divisão aninhada', () => {
    const next = withRatio(padrao(), 'meio', 0.7) as LayoutSplit;
    expect(next.ratio).toBe(0.52);
    expect((next.second as LayoutSplit).ratio).toBe(0.7);
  });

  it('limita o valor ao intervalo permitido', () => {
    expect((withRatio(padrao(), 'raiz', 0.99) as LayoutSplit).ratio).toBe(0.9);
    expect((withRatio(padrao(), 'raiz', 0.01) as LayoutSplit).ratio).toBe(0.1);
  });

  it('devolve o mesmo objeto para id inexistente, para folha ou para ratio igual', () => {
    const original = padrao();
    expect(withRatio(original, 'nenhuma', 0.3)).toBe(original);
    expect(withRatio(original, 'a', 0.3)).toBe(original);
    expect(withRatio(original, 'raiz', 0.52)).toBe(original);
    expect(withRatio(original, 'raiz', 0.99)).not.toBe(original);
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

  it('withRatio e withTerminal devolvem null', () => {
    expect(withRatio(null, 'raiz', 0.3)).toBeNull();
    expect(withTerminal(null, 'a', 't1')).toBeNull();
  });
});
