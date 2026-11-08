import { useEffect, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import {
  Group,
  Panel,
  Separator,
  useGroupRef,
  type Layout,
  type LayoutChangedMeta,
} from 'react-resizable-panels';
import type { LayoutLeaf, LayoutNode, LayoutSplit } from '@project-hub/contracts';
import { useLeafHosts, type LeafHosts } from './leaf-hosts';
import { minExtent } from './layout-fit';
import { leavesOf } from './layout-model';
import { PANE_IN, PANE_OUT, type PaneMotion } from './pane-motion';

const MIN_RATIO = 0.15;
const MAX_RATIO = 0.85;
const EPSILON = 0.0005;

type PaneTreeProps = {
  layout: LayoutNode;
  /**
   * Chamado quando o usuário termina de mover uma divisória; `ratio` é a fração de `first`. Sem ele, arrastar
   * vale só na tela (a árvore derivada da grade responsiva não existe no layout guardado, então não grava).
   */
  onRatio?: ((splitId: string, ratio: number) => void) | undefined;
  /** Largura mínima de cada painel, em px. Com ela, cada lado de uma divisão em linha tem `minSize` em px (e não 15%). */
  minWidth?: number | undefined;
  /** Altura mínima de cada painel, em px; o mesmo, para as divisões em coluna. */
  minHeight?: number | undefined;
  renderLeaf(leaf: LayoutLeaf): ReactNode;
  /** Folhas entrando e saindo, para a animação (pane-motion.ts). Sem ele, nada anima. */
  motion?: PaneMotion | undefined;
  /**
   * Os nós do conteúdo das folhas, de quem chama (WorkspacePage), que também os mostra fora da grade (modo Abas). Com
   * eles, quem chama renderiza o conteúdo por portal e cuida dos nós; a árvore só os põe no lugar. Sem eles, a árvore
   * cuida de tudo.
   */
  hosts?: LeafHosts | undefined;
};

/**
 * A grade de painéis. Abrir ou fechar um painel muda os grupos (ids novos de divisão) e remonta as folhas; o
 * conteúdo delas, não. Cada folha tem um nó do DOM próprio, criado uma vez: o conteúdo é renderizado nele por portal
 * (com a chave da folha) e o nó é movido para o lugar da folha na árvore. Assim o terminal ao lado de um painel que
 * abre ou fecha continua o mesmo, sem recriar o xterm nem o WebGL no meio da animação.
 */
export function PaneTree({
  layout,
  onRatio,
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
        onRatio={onRatio}
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
  return <SplitNode split={node} {...rest} />;
}

/** O `minSize` de um lado da divisão: o que a subárvore pede no eixo da divisão, em px; sem o mínimo, os 15% de sempre. */
function minSizeOf(
  child: LayoutNode,
  direction: LayoutSplit['direction'],
  minWidth: number | undefined,
  minHeight: number | undefined,
): string {
  const axis = direction === 'row' ? 'width' : 'height';
  const leafMin = axis === 'width' ? minWidth : minHeight;
  return leafMin === undefined ? '15' : `${minExtent(child, axis, leafMin)}px`;
}

function SplitNode({
  split,
  onRatio,
  minWidth,
  minHeight,
  motion,
  attach,
}: Omit<NodeProps, 'node'> & { split: LayoutSplit }) {
  const groupRef = useGroupRef();
  // O ratio que o grupo já exibe: o inicial, o último do usuário ou o último aplicado de fora.
  const known = useRef(split.ratio);
  const firstId = split.first.id;
  const secondId = split.second.id;

  // `defaultLayout` só vale na montagem. Um ratio novo vindo de fora (layout restaurado) entra por
  // `setLayout`; remontar o grupo reiniciaria os terminais dentro dele.
  useEffect(() => {
    if (Math.abs(split.ratio - known.current) <= EPSILON) return;
    known.current = split.ratio;
    groupRef.current?.setLayout({
      [firstId]: split.ratio * 100,
      [secondId]: (1 - split.ratio) * 100,
    });
  }, [split.ratio, firstId, secondId, groupRef]);

  const handleChanged = (next: Layout, meta: LayoutChangedMeta) => {
    // A montagem e o `setLayout` acima não são gesto do usuário.
    if (!meta.isUserInteraction) return;
    const share = next[firstId];
    if (share === undefined) return;
    const ratio = Math.min(MAX_RATIO, Math.max(MIN_RATIO, share / 100));
    if (Math.abs(ratio - known.current) <= EPSILON) return;
    known.current = ratio;
    onRatio?.(split.id, ratio);
  };

  return (
    <Group
      id={split.id}
      className="pane-tree__group"
      orientation={split.direction === 'row' ? 'horizontal' : 'vertical'}
      groupRef={groupRef}
      defaultLayout={{ [firstId]: split.ratio * 100, [secondId]: (1 - split.ratio) * 100 }}
      onLayoutChanged={handleChanged}
    >
      <Panel
        id={firstId}
        className="pane-tree__panel"
        defaultSize={String(split.ratio * 100)}
        minSize={minSizeOf(split.first, split.direction, minWidth, minHeight)}
      >
        {/* Mudar a estrutura (abrir/fechar painel) gera ids novos de divisão e remonta as folhas; o conteúdo
            delas fica no nó de cada uma (ver PaneTree) e só muda de lugar. */}
        <Node
          key={split.first.id}
          node={split.first}
          onRatio={onRatio}
          minWidth={minWidth}
          minHeight={minHeight}
          motion={motion}
          attach={attach}
        />
      </Panel>
      <Separator className="pane-tree__separator" aria-label="Redimensionar painéis" />
      <Panel
        id={secondId}
        className="pane-tree__panel"
        defaultSize={String((1 - split.ratio) * 100)}
        minSize={minSizeOf(split.second, split.direction, minWidth, minHeight)}
      >
        <Node
          key={split.second.id}
          node={split.second}
          onRatio={onRatio}
          minWidth={minWidth}
          minHeight={minHeight}
          motion={motion}
          attach={attach}
        />
      </Panel>
    </Group>
  );
}
