import { describe, expect, it } from 'vitest';
import { previewDrop, stepId, type TabSlot } from '../../src/renderer/workspace-order';

// Ordem das abas: as funções puras que a barra usa para arrastar e para mover pelo teclado.

const ids = ['a', 'b', 'c', 'd'];

// Quatro abas de larguras diferentes, com 2px de folga: a 0-100, b 102-182, c 184-304, d 306-366.
const slots: TabSlot[] = [
  { id: 'a', left: 0, width: 100 },
  { id: 'b', left: 102, width: 80 },
  { id: 'c', left: 184, width: 120 },
  { id: 'd', left: 306, width: 60 },
];

describe('previewDrop', () => {
  it('não muda nada com a aba no lugar dela', () => {
    const { order, shifts } = previewDrop(slots, 'b', 102);
    expect(order).toEqual(ids);
    expect([...shifts.values()]).toEqual([0, 0, 0, 0]);
  });

  it('a arrastada passa uma aba quando a borda da frente passa do meio dela', () => {
    // Para a esquerda, vale a borda esquerda (meio de a: 50; de b: 142).
    expect(previewDrop(slots, 'd', 49).order).toEqual(['d', 'a', 'b', 'c']);
    expect(previewDrop(slots, 'd', 51).order).toEqual(['a', 'd', 'b', 'c']);
    // Para a direita, vale a borda direita: a mede 100, então a direita de a em 43 é 143 e passa do meio de b.
    expect(previewDrop(slots, 'a', 41).order).toEqual(['a', 'b', 'c', 'd']);
    expect(previewDrop(slots, 'a', 43).order).toEqual(['b', 'a', 'c', 'd']);
    expect(previewDrop(slots, 'a', 300).order).toEqual(['b', 'c', 'd', 'a']);
  });

  it('uma aba mais larga que a primeira, no limite da esquerda, passa a primeira', () => {
    const wide: TabSlot[] = [
      { id: 'a', left: 0, width: 60 },
      { id: 'b', left: 62, width: 100 },
    ];
    // O meio de b com a borda em 0 seria 50, depois do meio de a (30): errava. A borda esquerda em 0 vale.
    expect(previewDrop(wide, 'b', 0).order).toEqual(['b', 'a']);
  });

  it('as abas ocupam os mesmos lugares na ordem nova, e cada uma anda a diferença', () => {
    const { shifts } = previewDrop(slots, 'd', 0);
    // d vai para o início, e as outras andam a largura de d mais a folga.
    expect(shifts.get('d')).toBe(-306);
    expect(shifts.get('a')).toBe(62);
    expect(shifts.get('b')).toBe(62);
    expect(shifts.get('c')).toBe(62);
  });

  it('com larguras diferentes, a ordem nova ocupa o mesmo espaço total', () => {
    const { order, shifts } = previewDrop(slots, 'a', 400);
    expect(order).toEqual(['b', 'c', 'd', 'a']);
    // b, c e d andam a largura de a (100) mais a folga (2) para a esquerda; a vai para depois de d (266).
    expect(shifts.get('b')).toBe(-102);
    expect(shifts.get('c')).toBe(-102);
    expect(shifts.get('d')).toBe(-102);
    expect(shifts.get('a')).toBe(266);
  });

  it('devolve a ordem de antes quando a arrastada não está na lista ou a lista é vazia', () => {
    expect(previewDrop(slots, 'x', 10).order).toEqual(ids);
    expect(previewDrop([], 'a', 10)).toEqual({ order: [], shifts: new Map() });
  });
});

describe('stepId', () => {
  it('troca a aba com a vizinha da esquerda (-1) ou da direita (1)', () => {
    expect(stepId(ids, 'b', -1)).toEqual(['b', 'a', 'c', 'd']);
    expect(stepId(ids, 'b', 1)).toEqual(['a', 'c', 'b', 'd']);
    expect(ids).toEqual(['a', 'b', 'c', 'd']);
  });

  it('é null na ponta que o passo pede e para um id que não está na lista', () => {
    expect(stepId(ids, 'a', -1)).toBeNull();
    expect(stepId(ids, 'd', 1)).toBeNull();
    expect(stepId(ids, 'x', 1)).toBeNull();
  });
});
