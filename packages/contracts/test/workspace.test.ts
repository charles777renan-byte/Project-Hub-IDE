import { describe, expect, it } from 'vitest';
import { arrangeLeaves } from '../src/layout-arrange';
import {
  LAYOUT_LIMITS,
  addPaneInputSchema,
  layoutIssue,
  paneInputSchema,
  providerIdSchema,
  providerInfoSchema,
  saveLayoutInputSchema,
  workspaceDtoSchema,
  workspaceLayoutSchema,
  type LayoutLeaf,
  type LayoutNode,
} from '../src';

const leaf = (
  id: string,
  provider: LayoutLeaf['provider'] = 'shell',
  terminalId: string | null = null,
): LayoutLeaf => ({ type: 'leaf', id, provider, terminalId });

const split = (
  id: string,
  first: LayoutNode,
  second: LayoutNode,
  ratio = 0.5,
  direction: 'row' | 'column' = 'row',
): LayoutNode => ({ type: 'split', id, direction, first, second, ratio });

const padrao = (): LayoutNode =>
  split(
    'raiz',
    leaf('a', 'claude'),
    split('meio', leaf('b', 'codex'), leaf('c', 'shell'), 0.5, 'column'),
    0.52,
  );

/** Árvore balanceada com `n` folhas de ids `${prefix}0`…, e divisões `${prefix}s…`. */
function balanced(n: number, prefix: string): LayoutNode {
  let count = 0;
  const build = (size: number): LayoutNode => {
    if (size === 1) return leaf(`${prefix}${count++}`);
    const half = Math.floor(size / 2);
    return split(`${prefix}s${count}-${size}`, build(half), build(size - half));
  };
  return build(n);
}

/** Cadeia de `depth` divisões aninhadas pelo `second`; a folha do fim fica no nível `depth + 1`. */
function chain(depth: number): LayoutNode {
  let node: LayoutNode = leaf('fim');
  for (let level = depth; level >= 1; level -= 1) {
    node = split(`d${level}`, leaf(`irma${level}`), node);
  }
  return node;
}

describe('workspaceLayoutSchema', () => {
  it('aceita o layout padrão e layoutIssue devolve null', () => {
    expect(workspaceLayoutSchema.safeParse(padrao()).success).toBe(true);
    expect(layoutIssue(padrao())).toBeNull();
  });

  it('aceita uma folha sozinha', () => {
    expect(workspaceLayoutSchema.safeParse(leaf('so', 'antigravity')).success).toBe(true);
  });

  it('expõe os limites combinados', () => {
    expect(LAYOUT_LIMITS).toEqual({ maxLeaves: 12, maxDepth: 6, minRatio: 0.1, maxRatio: 0.9 });
  });

  it('aceita 12 folhas e recusa 13', () => {
    const doze = balanced(12, 'x');
    const treze = balanced(13, 'y');
    expect(workspaceLayoutSchema.safeParse(doze).success).toBe(true);
    expect(workspaceLayoutSchema.safeParse(treze).success).toBe(false);
    expect(layoutIssue(treze)).toEqual(expect.any(String));
  });

  it('recusa 13 folhas mesmo na organização automática', () => {
    const folhas = Array.from({ length: 13 }, (_, n) => leaf(`o${n}`));
    let count = 0;
    const organizado = arrangeLeaves(folhas, () => `os${count++}`);
    expect(organizado).not.toBeNull();
    expect(workspaceLayoutSchema.safeParse(organizado).success).toBe(false);
  });

  it('o pedido de abrir painel exige workspace e um provedor conhecido', () => {
    expect(addPaneInputSchema.safeParse({ workspaceId: 'w', provider: 'codex' }).success).toBe(
      true,
    );
    expect(addPaneInputSchema.safeParse({ workspaceId: '', provider: 'codex' }).success).toBe(
      false,
    );
    expect(addPaneInputSchema.safeParse({ workspaceId: 'w', provider: 'bash' }).success).toBe(
      false,
    );
    expect(addPaneInputSchema.safeParse({ workspaceId: 'w' }).success).toBe(false);
  });

  it('aceita profundidade 6 e recusa 7', () => {
    // A raiz é o nível 1. chain(5): 5 divisões + a folha do fim = 6 níveis. chain(6) = 7 níveis.
    expect(workspaceLayoutSchema.safeParse(chain(5)).success).toBe(true);
    const profundo = chain(6);
    expect(workspaceLayoutSchema.safeParse(profundo).success).toBe(false);
    expect(layoutIssue(profundo)).toEqual(expect.any(String));
  });

  it.each([0, 0.05, 0.95, 1])('recusa ratio %s', (ratio) => {
    const ruim = split('r', leaf('a'), leaf('b'), ratio);
    expect(workspaceLayoutSchema.safeParse(ruim).success).toBe(false);
    expect(layoutIssue(ruim)).toEqual(expect.any(String));
  });

  it.each([0.1, 0.9])('aceita ratio %s', (ratio) => {
    const bom = split('r', leaf('a'), leaf('b'), ratio);
    expect(workspaceLayoutSchema.safeParse(bom).success).toBe(true);
    expect(layoutIssue(bom)).toBeNull();
  });

  it('recusa o ratio fora do limite numa divisão aninhada', () => {
    const ruim = split('r', leaf('a'), split('s', leaf('b'), leaf('c'), 0.95));
    expect(layoutIssue(ruim)).toEqual(expect.any(String));
  });

  it('recusa divisão sem first, sem second ou sem ratio', () => {
    const semFirst = { type: 'split', id: 'r', direction: 'row', second: leaf('b'), ratio: 0.5 };
    const semSecond = { type: 'split', id: 'r', direction: 'row', first: leaf('a'), ratio: 0.5 };
    const semRatio = {
      type: 'split',
      id: 'r',
      direction: 'row',
      first: leaf('a'),
      second: leaf('b'),
    };
    expect(workspaceLayoutSchema.safeParse(semFirst).success).toBe(false);
    expect(workspaceLayoutSchema.safeParse(semSecond).success).toBe(false);
    expect(workspaceLayoutSchema.safeParse(semRatio).success).toBe(false);
  });

  it('recusa direção desconhecida e ratio que não é número', () => {
    const base = { type: 'split', id: 'r', first: leaf('a'), second: leaf('b') };
    expect(
      workspaceLayoutSchema.safeParse({ ...base, direction: 'diagonal', ratio: 0.5 }).success,
    ).toBe(false);
    expect(
      workspaceLayoutSchema.safeParse({ ...base, direction: 'row', ratio: '0.5' }).success,
    ).toBe(false);
  });

  it('recusa id repetido, de folha e de divisão', () => {
    const folhaRepetida = split('r', leaf('a'), leaf('a'));
    const divisaoRepetida = split('r', leaf('a'), split('r', leaf('b'), leaf('c')));
    const folhaIgualDivisao = split('r', leaf('r'), leaf('b'));
    expect(workspaceLayoutSchema.safeParse(folhaRepetida).success).toBe(false);
    expect(workspaceLayoutSchema.safeParse(divisaoRepetida).success).toBe(false);
    expect(workspaceLayoutSchema.safeParse(folhaIgualDivisao).success).toBe(false);
    expect(layoutIssue(folhaRepetida)).toEqual(expect.any(String));
    expect(layoutIssue(divisaoRepetida)).toEqual(expect.any(String));
    expect(layoutIssue(folhaIgualDivisao)).toEqual(expect.any(String));
  });

  it('recusa o mesmo terminalId em duas folhas', () => {
    const ruim = split('r', leaf('a', 'claude', 't1'), leaf('b', 'shell', 't1'));
    expect(workspaceLayoutSchema.safeParse(ruim).success).toBe(false);
    expect(layoutIssue(ruim)).toEqual(expect.any(String));
  });

  it('aceita terminalId diferentes e vários nulos', () => {
    const bom = split(
      'r',
      leaf('a', 'claude', 't1'),
      split('s', leaf('b', 'shell', 't2'), leaf('c')),
    );
    expect(workspaceLayoutSchema.safeParse(bom).success).toBe(true);
    expect(layoutIssue(bom)).toBeNull();
  });

  it("recusa o provedor 'bash'", () => {
    const ruim = { type: 'leaf', id: 'a', provider: 'bash', terminalId: null };
    expect(workspaceLayoutSchema.safeParse(ruim).success).toBe(false);
    expect(providerIdSchema.safeParse('bash').success).toBe(false);
    expect(providerIdSchema.safeParse('antigravity').success).toBe(true);
  });

  it('recusa nó de tipo desconhecido e folha incompleta', () => {
    expect(workspaceLayoutSchema.safeParse({ type: 'tab', id: 'a' }).success).toBe(false);
    expect(
      workspaceLayoutSchema.safeParse({ type: 'leaf', id: 'a', provider: 'shell' }).success,
    ).toBe(false);
  });

  it('recusa o formato n-ário antigo', () => {
    const antigo = {
      type: 'split',
      id: 'r',
      direction: 'row',
      sizes: [50, 50],
      children: [leaf('a'), leaf('b')],
    };
    expect(workspaceLayoutSchema.safeParse(antigo).success).toBe(false);
  });
});

describe('contratos do workspace', () => {
  it('o workspace tem layout válido, posição inteira não negativa e data em texto', () => {
    const dto = {
      id: 'w1',
      projectId: 'p1',
      layout: padrao(),
      position: 0,
      lastActiveAt: '2026-10-22T10:00:00.000Z',
    };
    expect(workspaceDtoSchema.safeParse(dto).success).toBe(true);
    expect(workspaceDtoSchema.safeParse({ ...dto, position: -1 }).success).toBe(false);
    expect(workspaceDtoSchema.safeParse({ ...dto, position: 1.5 }).success).toBe(false);
    expect(workspaceDtoSchema.safeParse({ ...dto, layout: 'leaf' }).success).toBe(false);
  });

  it('os pedidos limitam os ids e validam o layout', () => {
    expect(paneInputSchema.safeParse({ workspaceId: 'w', leafId: 'a' }).success).toBe(true);
    expect(paneInputSchema.safeParse({ workspaceId: '', leafId: 'a' }).success).toBe(false);
    expect(paneInputSchema.safeParse({ workspaceId: 'w', leafId: 'x'.repeat(129) }).success).toBe(
      false,
    );
    expect(saveLayoutInputSchema.safeParse({ workspaceId: 'w', layout: padrao() }).success).toBe(
      true,
    );
    expect(
      saveLayoutInputSchema.safeParse({ workspaceId: 'w', layout: { type: 'leaf' } }).success,
    ).toBe(false);
  });

  it('o provedor informa se está disponível e por quê não', () => {
    expect(
      providerInfoSchema.safeParse({
        id: 'codex',
        label: 'Codex',
        available: false,
        reason: 'Não encontrado',
      }).success,
    ).toBe(true);
    expect(
      providerInfoSchema.safeParse({ id: 'shell', label: 'PowerShell', available: true }).success,
    ).toBe(true);
    expect(providerInfoSchema.safeParse({ id: 'shell', label: 'PowerShell' }).success).toBe(false);
  });
});
