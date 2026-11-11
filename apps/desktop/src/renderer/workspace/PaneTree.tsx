import { Fragment, useEffect, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import {
  Group,
  Panel,
  Separator,
  useGroupRef,
  type Layout,
  type LayoutChangedMeta,
} from 'react-resizable-panels';
import { minExtent } from '@project-hub/contracts/layout-ops';
import type { LayoutLeaf, LayoutNode, LayoutSplit } from '@project-hub/contracts';
import { useLeafHosts, type LeafHosts } from './leaf-hosts';
import { PANE_GAP } from './layout-fit';
import { leavesOf } from './layout-model';
import { PANE_IN, PANE_OUT, type PaneMotion } from './pane-motion';

const EPSILON = 0.0005;

type PaneTreeProps = {
  layout: LayoutNode;
  /**
   * Chamado quando o usuário termina de mover uma divisória: os tamanhos novos dos filhos da divisão, na ordem deles
   * e somando 1. Sem ele, arrastar vale só na tela.
   */
  onSizes?: ((splitId: string, sizes: number[]) => void) | undefined;
  /** Duplo clique na divisória entre os filhos `index` e `index + 1`: quem chama iguala os dois lados. */
  onEqualize?: ((splitId: string, index: number) => void) | undefined;
  /** Largura mínima de cada painel, em px. Com ela, cada filho de uma divisão em linha tem `minSize` em px (e não 5%). */
  minWidth?: number | undefined;
  /** Altura mínima de cada painel, em px; o mesmo, para as divisões em coluna. */
  minHeight?: number | undefined;
  renderLeaf(leaf: LayoutLeaf): ReactNode;
  /** Folhas entrando e saindo, para a animação (pane-motion.ts). Sem ele, nada anima. */
  motion?: PaneMotion | undefined;
  /**
   * Os nós do conteúdo das folhas, de quem chama (WorkspacePage), que também os mostra fora da grade (modo foco). Com
   * eles, quem chama renderiza o conteúdo por portal e cuida dos nós; a árvore só os põe no lugar. Sem eles, a árvore
   * cuida de tudo.
   */
  hosts?: LeafHosts | undefined;
};

/**
 * A grade de painéis. Mudar a estrutura (dividir, fechar, arrastar um painel para outro lugar) remonta os grupos que
 * mudaram e os lugares das folhas; o conteúdo delas, não. Cada folha tem um nó do DOM próprio, criado uma vez: o
 * conteúdo é renderizado nele por portal (com a chave da folha) e o nó é movido para o lugar da folha na árvore. Assim
 * o terminal continua o mesmo, sem recriar o xterm nem o WebGL e sem perder o que está na tela.
 */
export function PaneTree({
  layout,
  onSizes,
  onEqualize,
  minWidth,
  minHeight,
  renderLeaf,
  motion,
  hosts,
}: PaneTreeProps) {
  const own = useLeafHosts();
  const leafHosts = hosts ?? own;
  const leaves = leavesOf(layout);
  const ids = leaves.map((leaf) => leaf.id).join(' ');
  const { prune } = own;

  useEffect(() => {
    if (hosts === undefined) prune(new Set(ids.split(' ')));
  }, [hosts, ids, prune]);

  return (
    <div className="pane-tree" onFocus={leafHosts.rememberFocus}>
      <Node
        node={layout}
        onSizes={onSizes}
        onEqualize={onEqualize}
        minWidth={minWidth}
        minHeight={minHeight}
        motion={motion}
        attach={leafHosts.attach}
      />
      {hosts === undefined
        ? leaves.map((leaf) => createPortal(renderLeaf(leaf), own.hostOf(leaf.id), leaf.id))
        : null}
    </div>
  );
}

type NodeProps = Omit<PaneTreeProps, 'layout' | 'renderLeaf' | 'hosts'> & {
  node: LayoutNode;
  /** Põe o nó do conteúdo da folha dentro do lugar dela na árvore. */
  attach(leafId: string, slot: HTMLDivElement | null): void;
};

function motionOf(motion: PaneMotion | undefined, leafId: string) {
  if (motion?.leaving.has(leafId) === true) return 'leaving';
  if (motion?.entering.has(leafId) === true) return 'entering';
  return undefined;
}

function Node({ node, ...rest }: NodeProps) {
  if (node.type === 'leaf') {
    return (
      <div
        ref={(slot) => rest.attach(node.id, slot)}
        className="pane-tree__leaf"
        // O lugar da folha na tela: é por ele que o arrasto de um painel acha o alvo (pane-drag.ts).
        data-leaf-id={node.id}
        data-motion={motionOf(rest.motion, node.id)}
        onAnimationEnd={(event) => {
          // Só as da própria folha: as animações de dentro dela também borbulham até aqui.
          if (event.target !== event.currentTarget) return;
          if (event.animationName === PANE_IN) rest.motion?.onEntered(node.id);
          else if (event.animationName === PANE_OUT) rest.motion?.onLeft(node.id);
        }}
      />
    );
  }
  // A chave é a lista de filhos: com um filho a mais, a menos ou trocado, o grupo é remontado e nasce já com os
  // tamanhos certos (o `defaultLayout` só vale na montagem). Os nós das folhas só mudam de lugar.
  return (
    <SplitNode key={node.children.map((child) => child.id).join(' ')} split={node} {...rest} />
  );
}

/** O `minSize` de um filho da divisão: o que a subárvore pede no eixo da divisão, em px; sem o mínimo, 5%. */
function minSizeOf(
  child: LayoutNode,
  direction: LayoutSplit['direction'],
  minWidth: number | undefined,
  minHeight: number | undefined,
): string {
  const axis = direction === 'row' ? 'width' : 'height';
  const leafMin = axis === 'width' ? minWidth : minHeight;
  return leafMin === undefined ? '5' : `${minExtent(child, axis, leafMin, PANE_GAP)}px`;
}

const toLayout = (split: LayoutSplit): Layout =>
  Object.fromEntries(split.children.map((child, i) => [child.id, (split.sizes[i] ?? 0) * 100]));

function SplitNode({
  split,
  onSizes,
  onEqualize,
  minWidth,
  minHeight,
  motion,
  attach,
}: Omit<NodeProps, 'node'> & { split: LayoutSplit }) {
  const groupRef = useGroupRef();
  // Os tamanhos que o grupo já exibe: os iniciais, os últimos do usuário ou os últimos aplicados de fora.
  const known = useRef(split.sizes);

  // `defaultLayout` só vale na montagem. Tamanhos novos vindos de fora (igualar, desfazer, layout restaurado) entram
  // por `setLayout`; remontar o grupo por causa deles mexeria nos lugares de todos os terminais dentro dele.
  useEffect(() => {
    const same =
      known.current.length === split.sizes.length &&
      split.sizes.every((size, i) => Math.abs(size - (known.current[i] ?? 0)) <= EPSILON);
    if (same) return;
    known.current = split.sizes;
    groupRef.current?.setLayout(toLayout(split));
  }, [split, groupRef]);

  const handleChanged = (next: Layout, meta: LayoutChangedMeta) => {
    // A montagem e o `setLayout` acima não são gesto do usuário.
    if (!meta.isUserInteraction) return;
    const shares = split.children.map((child) => next[child.id]);
    if (shares.some((share) => share === undefined)) return;
    const total = shares.reduce<number>((sum, share) => sum + (share ?? 0), 0);
    if (!(total > 0)) return;
    const sizes = shares.map((share) => (share ?? 0) / total);
    if (sizes.every((size, i) => Math.abs(size - (known.current[i] ?? 0)) <= EPSILON)) return;
    known.current = sizes;
    onSizes?.(split.id, sizes);
  };

  return (
    <Group
      id={split.id}
      className="pane-tree__group"
      orientation={split.direction === 'row' ? 'horizontal' : 'vertical'}
      groupRef={groupRef}
      defaultLayout={toLayout(split)}
      onLayoutChanged={handleChanged}
    >
      {split.children.map((child, index) => (
        <Fragment key={child.id}>
          {index > 0 && (
            <Separator
              className="pane-tree__separator"
              aria-label="Redimensionar painéis"
              title="Arraste para redimensionar; dois cliques igualam os dois lados"
              onDoubleClick={() => onEqualize?.(split.id, index - 1)}
            />
          )}
          <Panel
            id={child.id}
            className="pane-tree__panel"
            defaultSize={String((split.sizes[index] ?? 0) * 100)}
            minSize={minSizeOf(child, split.direction, minWidth, minHeight)}
          >
            <Node
              node={child}
              onSizes={onSizes}
              onEqualize={onEqualize}
              minWidth={minWidth}
              minHeight={minHeight}
              motion={motion}
              attach={attach}
            />
          </Panel>
        </Fragment>
      ))}
    </Group>
  );
}
