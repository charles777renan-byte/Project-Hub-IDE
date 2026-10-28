import { describe, expect, it } from 'vitest';
import type { LayoutLeaf } from '@project-hub/contracts';
import { neighbourOf, stepSolo } from '../../src/renderer/workspace/solo';

// O modo "um painel por vez": as regras puras que a página usa para trocar de painel e para fechar o mostrado.

const leaf = (id: string): LayoutLeaf => ({
  type: 'leaf',
  id,
  provider: 'shell',
  terminalId: null,
});
const leaves = [leaf('a'), leaf('b'), leaf('c')];

describe('stepSolo', () => {
  it('anda para o painel anterior ou o seguinte', () => {
    expect(stepSolo(leaves, 'b', -1)).toBe('a');
    expect(stepSolo(leaves, 'b', 1)).toBe('c');
  });

  it('volta ao outro lado nas pontas', () => {
    expect(stepSolo(leaves, 'a', -1)).toBe('c');
    expect(stepSolo(leaves, 'c', 1)).toBe('a');
  });

  it('é null sem painéis', () => {
    expect(stepSolo([], 'a', 1)).toBeNull();
  });
});

describe('neighbourOf', () => {
  it('é o painel que ocupa a posição do fechado, o seguinte', () => {
    expect(neighbourOf(leaves, 'a')).toBe('b');
    expect(neighbourOf(leaves, 'b')).toBe('c');
  });

  it('para o último, é o anterior', () => {
    expect(neighbourOf(leaves, 'c')).toBe('b');
  });

  it('é null quando não sobra nenhum ou o painel não está na lista', () => {
    expect(neighbourOf([leaf('a')], 'a')).toBeNull();
    expect(neighbourOf(leaves, 'x')).toBeNull();
  });
});
