import { describe, expect, it } from 'vitest';
import {
  layoutIssue,
  saveLayoutInputSchema,
  workspaceLayoutSchema,
  type LayoutLeaf,
  type LayoutNode,
} from '../src';
import { arrangeLeaves, arrangeLeavesCapped } from '../src/layout-arrange';
import { LAYOUT_LIMITS } from '../src/layout-limits';

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

/** As linhas de uma árvore de arrumação: percorre as divisões `column` e para nas `row` ou nas folhas. */
const linhasDaColuna = (no: LayoutNode): LayoutNode[] =>
  no.type === 'split' && no.direction === 'column'
    ? [...linhasDaColuna(no.first), ...linhasDaColuna(no.second)]
    : [no];
const divisoes = (no: LayoutNode): Extract<LayoutNode, { type: 'split' }>[] =>
  no.type === 'leaf' ? [] : [no, ...divisoes(no.first), ...divisoes(no.second)];

describe('arrangeLeavesCapped', () => {
  it.each([1, 2, 3, 4, 6])('com %i folhas e 3 colunas é igual ao arrangeLeaves', (n) => {
    expect(arrangeLeavesCapped(folhas(n), 3, gerador())).toEqual(
      arrangeLeaves(folhas(n), gerador()),
    );
  });

  it('quando cabe devolve a própria folha, como o arrangeLeaves', () => {
    const f = folha('a');
    expect(arrangeLeavesCapped([f], 1, gerador())).toBe(f);
  });

  it('com 3 folhas e 2 colunas mantém o arranjo "um + dois" (cabe)', () => {
    expect(arrangeLeavesCapped(folhas(3), 2, gerador())).toEqual(
      arrangeLeaves(folhas(3), gerador()),
    );
  });

  it('limita a 2 colunas: 5 folhas viram linhas de 2, 2 e 1, na ordem da lista', () => {
    const r = arrangeLeavesCapped(folhas(5), 2, gerador()) as LayoutNode;
    expect(divisao(r).direction).toBe('column');
    const linhas = linhasDaColuna(r);
    expect(linhas).toHaveLength(3);
    expect(linhas.map((l) => ordem(l))).toEqual([['f1', 'f2'], ['f3', 'f4'], ['f5']]);
    for (const linha of linhas.slice(0, 2)) expect(divisao(linha).direction).toBe('row');
    expect(linhas[2]).toMatchObject({ type: 'leaf', id: 'f5' });
    expect(ordem(r)).toEqual(['f1', 'f2', 'f3', 'f4', 'f5']);
  });

  it('limita a 2 colunas com 9 folhas: nenhuma linha passa de 2 folhas', () => {
    const r = arrangeLeavesCapped(folhas(9), 2, gerador()) as LayoutNode;
    const linhas = linhasDaColuna(r);
    expect(linhas).toHaveLength(5);
    for (const linha of linhas) expect(ordem(linha).length).toBeLessThanOrEqual(2);
    expect(ordem(r)).toEqual(folhas(9).map((f) => f.id));
  });

  it('uma coluna: 3 folhas só em divisões column, sem row nem o arranjo "um + dois"', () => {
    const r = arrangeLeavesCapped(folhas(3), 1, gerador()) as LayoutNode;
    const todas = divisoes(r);
    expect(todas).toHaveLength(2);
    expect(todas.every((d) => d.direction === 'column')).toBe(true);
    expect(ordem(r)).toEqual(['f1', 'f2', 'f3']);
  });

  it('uma coluna com 2 folhas também empilha (column, não row)', () => {
    const r = divisao(arrangeLeavesCapped(folhas(2), 1, gerador()));
    expect(r.direction).toBe('column');
    expect(r.ratio).toBe(0.5);
    expect(ordem(r)).toEqual(['f1', 'f2']);
  });

  it('sem folhas devolve null', () => {
    expect(arrangeLeavesCapped([], 3, gerador())).toBeNull();
  });

  it('maxColumns menor que 1 é tratado como 1', () => {
    expect(arrangeLeavesCapped(folhas(3), 0, gerador())).toEqual(
      arrangeLeavesCapped(folhas(3), 1, gerador()),
    );
    expect(arrangeLeavesCapped(folhas(3), -2, gerador())).toEqual(
      arrangeLeavesCapped(folhas(3), 1, gerador()),
    );
  });

  it.each([
    [5, 2],
    [7, 2],
    [12, 2],
    [5, 1],
    [12, 1],
    [12, 3],
  ])('com %i folhas e %i colunas o layout vale e os ids vêm do newId', (n, colunas) => {
    const r = arrangeLeavesCapped(folhas(n), colunas, gerador()) as LayoutNode;
    expect(layoutIssue(r)).toBeNull();
    for (const d of divisoes(r)) {
      expect(d.ratio).toBeGreaterThanOrEqual(LAYOUT_LIMITS.minRatio);
      expect(d.ratio).toBeLessThanOrEqual(LAYOUT_LIMITS.maxRatio);
      expect(d.id).toMatch(/^s\d+$/);
    }
    const ids = todosIds(r);
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
