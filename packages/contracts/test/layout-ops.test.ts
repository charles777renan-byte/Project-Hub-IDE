import { describe, expect, it } from 'vitest';
import {
  arrangeLeaves,
  dockLeaf,
  equalizeDivider,
  leavesOf,
  minExtent,
  moveDivider,
  neighbourAt,
  normalize,
  presetLayout,
  rectsOf,
  removeLeaf,
  splitLeaf,
  swapLeaves,
  upgradeLegacyLayout,
  withSizes,
} from '../src/layout-ops';
import { layoutIssue, workspaceLayoutSchema, type LayoutLeaf, type LayoutNode } from '../src';

const leaf = (id: string, terminalId: string | null = null): LayoutLeaf => ({
  type: 'leaf',
  id,
  provider: 'shell',
  terminalId,
});

const split = (
  id: string,
  direction: 'row' | 'column',
  children: LayoutNode[],
  sizes?: number[],
): LayoutNode => ({
  type: 'split',
  id,
  direction,
  children,
  sizes: sizes ?? children.map(() => 1 / children.length),
});

const ids = (node: LayoutNode | null) => leavesOf(node).map((item) => item.id);
const counter = (prefix = 's') => {
  let count = 0;
  return () => `${prefix}${count++}`;
};
/** A árvore como texto curto: `row(a:0.5, column(b:0.5, c:0.5):0.5)`. */
function shape(node: LayoutNode | null): string {
  if (node === null) return 'vazio';
  if (node.type === 'leaf') return node.id;
  const parts = node.children.map(
    (child, index) => `${shape(child)}:${Number((node.sizes[index] ?? 0).toFixed(3))}`,
  );
  return `${node.direction}(${parts.join(', ')})`;
}

/** a | (b sobre c) */
const tres = () =>
  split('r', 'row', [leaf('a'), split('m', 'column', [leaf('b'), leaf('c')])], [0.6, 0.4]);

describe('splitLeaf', () => {
  it('uma folha sozinha vira uma divisão de duas metades, no lado pedido', () => {
    expect(shape(splitLeaf(leaf('a'), 'a', 'right', leaf('n'), counter()))).toBe(
      'row(a:0.5, n:0.5)',
    );
    expect(shape(splitLeaf(leaf('a'), 'a', 'left', leaf('n'), counter()))).toBe(
      'row(n:0.5, a:0.5)',
    );
    expect(shape(splitLeaf(leaf('a'), 'a', 'bottom', leaf('n'), counter()))).toBe(
      'column(a:0.5, n:0.5)',
    );
    expect(shape(splitLeaf(leaf('a'), 'a', 'top', leaf('n'), counter()))).toBe(
      'column(n:0.5, a:0.5)',
    );
  });

  it('na mesma direção do pai a nova entra como irmã e reparte só o espaço da folha', () => {
    const next = splitLeaf(tres(), 'a', 'right', leaf('n'), counter());
    expect(shape(next)).toBe('row(a:0.3, n:0.3, column(b:0.5, c:0.5):0.4)');
    expect(layoutIssue(next)).toBeNull();
  });

  it('na outra direção a folha vira uma divisão nova, e os vizinhos não mudam', () => {
    const next = splitLeaf(tres(), 'a', 'bottom', leaf('n'), counter());
    expect(shape(next)).toBe('row(column(a:0.5, n:0.5):0.6, column(b:0.5, c:0.5):0.4)');
  });

  it('folha inexistente, ou folha nova que já está na árvore, não muda nada', () => {
    const tree = tres();
    expect(splitLeaf(tree, 'x', 'right', leaf('n'), counter())).toBe(tree);
    expect(splitLeaf(tree, 'a', 'right', leaf('b'), counter())).toBe(tree);
  });
});

describe('removeLeaf', () => {
  it('o vizinho absorve o espaço de quem sai', () => {
    const linha = split('r', 'row', [leaf('a'), leaf('b'), leaf('c')], [0.2, 0.3, 0.5]);
    expect(shape(removeLeaf(linha, 'b'))).toBe('row(a:0.5, c:0.5)');
    expect(shape(removeLeaf(linha, 'a'))).toBe('row(b:0.5, c:0.5)');
    expect(shape(removeLeaf(linha, 'c'))).toBe('row(a:0.2, b:0.8)');
  });

  it('a divisão que fica com um filho só é trocada por ele', () => {
    expect(shape(removeLeaf(tres(), 'b'))).toBe('row(a:0.6, c:0.4)');
    expect(shape(removeLeaf(tres(), 'a'))).toBe('column(b:0.5, c:0.5)');
  });

  it('ao colapsar, o filho de mesma direção do avô é desfeito nele, com os tamanhos proporcionais', () => {
    // linha( a | coluna( b / linha(c | d) ) ): tirar b deixa linha(c | d) direto na linha de fora.
    const tree = split('r', 'row', [
      leaf('a'),
      split('m', 'column', [leaf('b'), split('i', 'row', [leaf('c'), leaf('d')])]),
    ]);
    expect(shape(removeLeaf(tree, 'b'))).toBe('row(a:0.5, c:0.25, d:0.25)');
  });

  it('tirar a última folha deixa o workspace vazio, e folha inexistente não muda nada', () => {
    expect(removeLeaf(leaf('a'), 'a')).toBeNull();
    const tree = tres();
    expect(removeLeaf(tree, 'x')).toBe(tree);
    expect(removeLeaf(null, 'a')).toBeNull();
  });
});

describe('swapLeaves', () => {
  it('troca as duas de lugar e os tamanhos ficam com os lugares', () => {
    const next = swapLeaves(tres(), 'a', 'c');
    expect(shape(next)).toBe('row(c:0.6, column(b:0.5, a:0.5):0.4)');
  });

  it('a folha leva a sessão dela', () => {
    const tree = split('r', 'row', [leaf('a', 't1'), leaf('b', 't2')]);
    expect(leavesOf(swapLeaves(tree, 'a', 'b')).map((item) => item.terminalId)).toEqual([
      't2',
      't1',
    ]);
  });

  it('a mesma folha, ou uma inexistente, não muda nada', () => {
    const tree = tres();
    expect(swapLeaves(tree, 'a', 'a')).toBe(tree);
    expect(swapLeaves(tree, 'a', 'x')).toBe(tree);
  });
});

describe('dockLeaf', () => {
  const linha = () => split('r', 'row', [leaf('a'), leaf('b'), leaf('c')]);

  it('encaixa à esquerda do alvo, que cede metade do espaço', () => {
    expect(shape(dockLeaf(linha(), 'c', 'a', 'left', counter()))).toBe(
      'row(c:0.167, a:0.167, b:0.667)',
    );
  });

  it('encaixa à direita do alvo', () => {
    expect(shape(dockLeaf(linha(), 'a', 'c', 'right', counter()))).toBe(
      'row(b:0.667, c:0.167, a:0.167)',
    );
  });

  it('encaixa acima do alvo, numa divisão nova', () => {
    expect(shape(dockLeaf(linha(), 'a', 'c', 'top', counter()))).toBe(
      'row(b:0.667, column(a:0.5, c:0.5):0.333)',
    );
  });

  it('encaixa abaixo do alvo', () => {
    expect(shape(dockLeaf(linha(), 'a', 'c', 'bottom', counter()))).toBe(
      'row(b:0.667, column(c:0.5, a:0.5):0.333)',
    );
  });

  it('com dois painéis, encaixar muda a direção da divisão', () => {
    const dois = split('r', 'row', [leaf('a'), leaf('b')]);
    expect(shape(dockLeaf(dois, 'a', 'b', 'bottom', counter()))).toBe('column(b:0.5, a:0.5)');
  });

  it('mantém todas as folhas, uma vez cada, e a árvore continua válida', () => {
    const next = dockLeaf(tres(), 'b', 'a', 'top', counter());
    expect(ids(next).sort()).toEqual(['a', 'b', 'c']);
    expect(layoutIssue(next)).toBeNull();
  });

  it('sobre si mesma, ou com folha inexistente, não muda nada', () => {
    const tree = tres();
    expect(dockLeaf(tree, 'a', 'a', 'left', counter())).toBe(tree);
    expect(dockLeaf(tree, 'a', 'x', 'left', counter())).toBe(tree);
    expect(dockLeaf(tree, 'x', 'a', 'left', counter())).toBe(tree);
  });
});

describe('redimensionar', () => {
  const linha = () => split('r', 'row', [leaf('a'), leaf('b'), leaf('c')], [0.2, 0.3, 0.5]);

  it('withSizes troca os tamanhos da divisão e os normaliza', () => {
    expect(shape(withSizes(linha(), 'r', [1, 1, 2]))).toBe('row(a:0.25, b:0.25, c:0.5)');
  });

  it('withSizes ignora divisão inexistente, comprimento errado e tamanhos iguais aos atuais', () => {
    const tree = linha();
    expect(withSizes(tree, 'x', [0.5, 0.5])).toBe(tree);
    expect(withSizes(tree, 'r', [0.5, 0.5])).toBe(tree);
    expect(withSizes(tree, 'r', [0.2, 0.3, 0.5])).toBe(tree);
  });

  it('moveDivider só mexe nos dois lados da divisória', () => {
    expect(shape(moveDivider(linha(), 'r', 0, 0.8))).toBe('row(a:0.4, b:0.1, c:0.5)');
  });

  it('a divisória para no mínimo de cada lado', () => {
    // a + b = 0.5 do espaço. Mínimos de 0.15 de cada lado: a fica entre 0.15 e 0.35.
    expect(shape(moveDivider(linha(), 'r', 0, 0.01, 0.15, 0.15))).toBe(
      'row(a:0.15, b:0.35, c:0.5)',
    );
    expect(shape(moveDivider(linha(), 'r', 0, 0.99, 0.15, 0.15))).toBe(
      'row(a:0.35, b:0.15, c:0.5)',
    );
  });

  it('se os dois mínimos não cabem juntos, a divisória não se move', () => {
    const tree = linha();
    expect(moveDivider(tree, 'r', 0, 0.9, 0.3, 0.3)).toBe(tree);
  });

  it('equalizeDivider iguala os dois lados e não toca nos outros', () => {
    expect(shape(equalizeDivider(linha(), 'r', 0))).toBe('row(a:0.25, b:0.25, c:0.5)');
    expect(shape(equalizeDivider(linha(), 'r', 1))).toBe('row(a:0.2, b:0.4, c:0.4)');
  });

  it('minExtent soma os filhos e os vãos no eixo da divisão e pega o maior no outro', () => {
    expect(minExtent(tres(), 'width', 340, 8)).toBe(340 + 8 + 340);
    expect(minExtent(tres(), 'height', 200, 8)).toBe(200 + 8 + 200);
    expect(minExtent(leaf('a'), 'width', 340, 8)).toBe(340);
  });
});

describe('vizinhos', () => {
  it('rectsOf dá o retângulo de cada folha', () => {
    const rects = rectsOf(tres());
    expect(rects.get('a')).toEqual({ x: 0, y: 0, width: 0.6, height: 1 });
    expect(rects.get('c')).toEqual({ x: 0.6, y: 0.5, width: 0.4, height: 0.5 });
  });

  it('neighbourAt acha quem encosta em cada lado', () => {
    expect(neighbourAt(tres(), 'a', 'right')).toBe('b');
    expect(neighbourAt(tres(), 'b', 'left')).toBe('a');
    expect(neighbourAt(tres(), 'b', 'bottom')).toBe('c');
    expect(neighbourAt(tres(), 'c', 'top')).toBe('b');
  });

  it('na borda da área não há vizinho', () => {
    expect(neighbourAt(tres(), 'a', 'left')).toBeNull();
    expect(neighbourAt(tres(), 'b', 'top')).toBeNull();
    expect(neighbourAt(tres(), 'x', 'left')).toBeNull();
  });

  it('entre vários que encostam, vale o de maior sobreposição', () => {
    const tree = split('r', 'row', [
      leaf('a'),
      split('m', 'column', [leaf('b'), leaf('c')], [0.3, 0.7]),
    ]);
    expect(neighbourAt(tree, 'a', 'right')).toBe('c');
  });
});

describe('layouts prontos', () => {
  const folhas = (n: number) => Array.from({ length: n }, (_, i) => leaf(`l${i}`));

  it('lado a lado', () => {
    expect(shape(presetLayout('side-by-side', folhas(2), counter()))).toBe('row(l0:0.5, l1:0.5)');
  });

  it('um grande e dois empilhados', () => {
    expect(shape(presetLayout('main-stack', folhas(3), counter()))).toBe(
      'row(l0:0.6, column(l1:0.5, l2:0.5):0.4)',
    );
  });

  it('grade 2×2', () => {
    expect(shape(presetLayout('grid', folhas(4), counter()))).toBe(
      'column(row(l0:0.5, l1:0.5):0.5, row(l2:0.5, l3:0.5):0.5)',
    );
  });

  it('três colunas, com as folhas a mais empilhadas nas colunas', () => {
    expect(shape(presetLayout('three-columns', folhas(3), counter()))).toBe(
      'row(l0:0.333, l1:0.333, l2:0.333)',
    );
    expect(shape(presetLayout('three-columns', folhas(4), counter()))).toBe(
      'row(column(l0:0.5, l3:0.5):0.333, l1:0.333, l2:0.333)',
    );
  });

  it.each(['side-by-side', 'main-stack', 'grid', 'three-columns'] as const)(
    '%s guarda todas as folhas e dá uma árvore válida até o limite de painéis',
    (preset) => {
      for (let n = 1; n <= 12; n += 1) {
        const tree = presetLayout(preset, folhas(n), counter());
        expect(ids(tree).sort()).toEqual(
          folhas(n)
            .map((item) => item.id)
            .sort(),
        );
        expect(workspaceLayoutSchema.safeParse(tree).success).toBe(true);
      }
    },
  );

  it('sem folhas não há layout', () => {
    expect(presetLayout('grid', [], counter())).toBeNull();
    expect(arrangeLeaves([], counter())).toBeNull();
  });

  it('a arrumação automática: 2 lado a lado, 3 com um à esquerda, 4 em grade', () => {
    expect(shape(arrangeLeaves(folhas(2), counter()))).toBe('row(l0:0.5, l1:0.5)');
    expect(shape(arrangeLeaves(folhas(3), counter()))).toBe(
      'row(l0:0.5, column(l1:0.5, l2:0.5):0.5)',
    );
    expect(shape(arrangeLeaves(folhas(4), counter()))).toBe(
      'column(row(l0:0.5, l1:0.5):0.5, row(l2:0.5, l3:0.5):0.5)',
    );
  });
});

describe('serializar e restaurar', () => {
  it('a árvore passa pelo JSON sem mudar e continua válida', () => {
    const tree = dockLeaf(
      splitLeaf(tres(), 'a', 'bottom', leaf('n', 't9'), counter()),
      'c',
      'n',
      'left',
      counter('d'),
    );
    const restored: unknown = JSON.parse(JSON.stringify(tree));
    expect(restored).toEqual(tree);
    const parsed = workspaceLayoutSchema.safeParse(restored);
    expect(parsed.success).toBe(true);
    expect(parsed.data).toEqual(tree);
  });

  it('o formato antigo de duas metades é convertido, e divisões de mesma direção viram uma só', () => {
    const antigo = {
      type: 'split',
      id: 'r',
      direction: 'row',
      ratio: 1 / 3,
      first: leaf('a'),
      second: {
        type: 'split',
        id: 'm',
        direction: 'row',
        ratio: 0.5,
        first: leaf('b'),
        second: {
          type: 'split',
          id: 'k',
          direction: 'column',
          ratio: 0.25,
          first: leaf('c'),
          second: leaf('d'),
        },
      },
    };
    const parsed = workspaceLayoutSchema.safeParse(upgradeLegacyLayout(antigo));
    expect(parsed.success).toBe(true);
    expect(shape(normalize(parsed.data as LayoutNode))).toBe(
      'row(a:0.333, b:0.333, column(c:0.25, d:0.75):0.333)',
    );
  });

  it('o que já está no formato atual, e o que não é layout, passa como veio', () => {
    const tree = tres();
    expect(upgradeLegacyLayout(tree)).toEqual(tree);
    expect(upgradeLegacyLayout(null)).toBeNull();
    expect(upgradeLegacyLayout('x')).toBe('x');
    expect(upgradeLegacyLayout(leaf('a'))).toEqual(leaf('a'));
  });

  it('normalize desfaz a divisão de um filho só e acerta tamanhos inválidos', () => {
    const torta = {
      type: 'split',
      id: 'r',
      direction: 'row',
      children: [
        { type: 'split', id: 'u', direction: 'column', children: [leaf('a')], sizes: [1] },
        leaf('b'),
      ],
      sizes: [3, 1],
    } as LayoutNode;
    expect(shape(normalize(torta))).toBe('row(a:0.75, b:0.25)');
    expect(shape(normalize(split('r', 'row', [leaf('a'), leaf('b')], [0, Number.NaN])))).toBe(
      'row(a:0.5, b:0.5)',
    );
  });
});
