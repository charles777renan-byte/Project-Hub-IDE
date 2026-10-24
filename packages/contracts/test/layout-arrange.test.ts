import { describe, expect, it } from 'vitest';
import {
  layoutIssue,
  saveLayoutInputSchema,
  workspaceLayoutSchema,
  type LayoutLeaf,
  type LayoutNode,
} from '../src';
import { arrangeLeaves } from '../src/layout-arrange';

const folha = (id: string): LayoutLeaf => ({
  type: 'leaf',
  id,
  provider: 'shell',
  terminalId: null,
});
const folhas = (n: number): LayoutLeaf[] => Array.from({ length: n }, (_, i) => folha(`f${i + 1}`));
const gerador = () => {
  let n = 0;
  return () => `s${++n}`;
};
const organizar = (n: number): LayoutNode | null => arrangeLeaves(folhas(n), gerador());

const ordem = (no: LayoutNode): string[] =>
  no.type === 'leaf' ? [no.id] : [...ordem(no.first), ...ordem(no.second)];
const todosIds = (no: LayoutNode): string[] =>
  no.type === 'leaf' ? [no.id] : [no.id, ...todosIds(no.first), ...todosIds(no.second)];

const divisao = (no: LayoutNode | null) => {
  if (no === null || no.type !== 'split') throw new Error('esperava uma divisão');
  return no;
};

describe('arrangeLeaves', () => {
  it('lista vazia devolve null', () => {
    expect(organizar(0)).toBeNull();
  });

  it('uma folha devolve a própria folha', () => {
    const f = folha('a');
    expect(arrangeLeaves([f], gerador())).toBe(f);
  });

  it('duas folhas: row com ratio 0,5 na ordem da lista', () => {
    const r = divisao(organizar(2));
    expect(r.direction).toBe('row');
    expect(r.ratio).toBe(0.5);
    expect(ordem(r)).toEqual(['f1', 'f2']);
  });

  it('três folhas: a primeira à esquerda e as outras empilhadas à direita', () => {
    const r = divisao(organizar(3));
    expect(r.direction).toBe('row');
    expect(r.first).toMatchObject({ type: 'leaf', id: 'f1' });
    const dir = divisao(r.second);
    expect(dir.direction).toBe('column');
    expect(ordem(dir)).toEqual(['f2', 'f3']);
  });

  it('quatro folhas: grade 2x2 (column de duas row)', () => {
    const r = divisao(organizar(4));
    expect(r.direction).toBe('column');
    expect(divisao(r.first).direction).toBe('row');
    expect(divisao(r.second).direction).toBe('row');
    expect(ordem(r)).toEqual(['f1', 'f2', 'f3', 'f4']);
  });

  it('cinco folhas: linhas de 3 e 2, ratio proporcional à contagem', () => {
    const r = divisao(organizar(5));
    expect(r.direction).toBe('column');
    expect(ordem(r.first)).toHaveLength(3);
    expect(ordem(r.second)).toHaveLength(2);
    expect(r.ratio).toBeCloseTo(3 / 5);
    expect(r.ratio).toBeGreaterThanOrEqual(0.1);
    expect(r.ratio).toBeLessThanOrEqual(0.9);
  });

  it('doze folhas respeitam os limites do layout', () => {
    expect(layoutIssue(organizar(12) as LayoutNode)).toBeNull();
  });

  it.each([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12])('com %i folhas o layout vale', (n) => {
    expect(layoutIssue(organizar(n) as LayoutNode)).toBeNull();
  });

  it('mantém a ordem da lista e os ids das folhas', () => {
    const r = organizar(7) as LayoutNode;
    expect(ordem(r)).toEqual(folhas(7).map((f) => f.id));
  });

  it('ids das divisões distintos entre si e das folhas', () => {
    const ids = todosIds(organizar(9) as LayoutNode);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe('layout vazio no esquema', () => {
  it('workspaceLayoutSchema aceita null', () => {
    expect(workspaceLayoutSchema.parse(null)).toBeNull();
  });

  it('um layout inválido segue recusado', () => {
    expect(workspaceLayoutSchema.safeParse({ type: 'leaf' }).success).toBe(false);
  });

  it('saveLayoutInputSchema aceita layout null', () => {
    expect(saveLayoutInputSchema.safeParse({ workspaceId: 'w', layout: null }).success).toBe(true);
  });
});
