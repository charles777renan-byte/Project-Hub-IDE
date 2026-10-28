import { useCallback, useEffect, useRef, type ReactNode } from 'react';
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
import { leavesOf } from './layout-model';
import { PANE_IN, PANE_OUT, type PaneMotion } from './pane-motion';

const MIN_RATIO = 0.15;
const MAX_RATIO = 0.85;
const EPSILON = 0.0005;

type PaneTreeProps = {
  layout: LayoutNode;
  /** Chamado quando o usuário termina de mover uma divisória; `ratio` é a fração de `first`. */
  onRatio(splitId: string, ratio: number): void;
  renderLeaf(leaf: LayoutLeaf): ReactNode;
  /** Folhas entrando e saindo, para a animação (pane-motion.ts). Sem ele, nada anima. */
  motion?: PaneMotion | undefined;
};

/**
 * A grade de painéis. Abrir ou fechar um painel muda os grupos (ids novos de divisão) e remonta as folhas; o
 * conteúdo delas, não. Cada folha tem um nó do DOM próprio, criado uma vez: o conteúdo é renderizado nele por portal
 * (com a chave da folha) e o nó é movido para o lugar da folha na árvore. Assim o terminal ao lado de um painel que
 * abre ou fecha continua o mesmo, sem recriar o xterm nem o WebGL no meio da animação.
 */
export function PaneTree({ layout, onRatio, renderLeaf, motion }: PaneTreeProps) {
  const hosts = useRef(new Map<string, HTMLDivElement>());
  // O último elemento focado dentro da grade: mover um nó tira o foco dele, e o foco volta depois da mudança.
  const lastFocus = useRef<HTMLElement | null>(null);
  const leaves = leavesOf(layout);
  const ids = leaves.map((leaf) => leaf.id).join(' ');

  const hostOf = useCallback((leafId: string) => {
    let host = hosts.current.get(leafId);
    if (host === undefined) {
      host = document.createElement('div');
      host.className = 'pane-tree__content';
      hosts.current.set(leafId, host);
    }
    return host;
  }, []);

  const attach = useCallback(
    (leafId: string, slot: HTMLDivElement | null) => {
      if (slot === null) return;
      const host = hostOf(leafId);
      if (host.parentElement === slot) return;
      slot.append(host);
      const focused = lastFocus.current;
      const lost = document.activeElement === null || document.activeElement === document.body;
      if (lost && focused !== null && host.contains(focused))
        focused.focus({ preventScroll: true });
    },
    [hostOf],
  );

  // Folha que saiu do layout: o nó dela sai do mapa (o portal já desmontou o conteúdo).
  useEffect(() => {
    const kept = new Set(ids.split(' '));
    for (const id of hosts.current.keys()) if (!kept.has(id)) hosts.current.delete(id);
  }, [ids]);

  return (
    <div
      className="pane-tree"
      onFocus={(event) => {
        if (event.target instanceof HTMLElement) lastFocus.current = event.target;
      }}
    >
      <Node node={layout} onRatio={onRatio} motion={motion} attach={attach} />
      {leaves.map((leaf) => createPortal(renderLeaf(leaf), hostOf(leaf.id), leaf.id))}
    </div>
  );
}

type NodeProps = Omit<PaneTreeProps, 'layout' | 'renderLeaf'> & {
  node: LayoutNode;
  /** Põe o nó do conteúdo da folha dentro do lugar dela na árvore. */
  attach(leafId: string, slot: HTMLDivElement | null): void;
};

function motionOf(motion: PaneMotion | undefined, leafId: string) {
  if (motion?.leaving.has(leafId) === true) return 'leaving';
  if (motion?.entering.has(leafId) === true) return 'entering';
  return undefined;
}

function Node({ node, onRatio, motion, attach }: NodeProps) {
  if (node.type === 'leaf') {
    return (
      <div
        ref={(slot) => attach(node.id, slot)}
        className="pane-tree__leaf"
        data-motion={motionOf(motion, node.id)}
        onAnimationEnd={(event) => {
          // Só as da própria folha: as animações de dentro dela também borbulham até aqui.
          if (event.target !== event.currentTarget) return;
          if (event.animationName === PANE_IN) motion?.onEntered(node.id);
          else if (event.animationName === PANE_OUT) motion?.onLeft(node.id);
        }}
      />
    );
  }
  return <SplitNode split={node} onRatio={onRatio} motion={motion} attach={attach} />;
}

function SplitNode({
  split,
  onRatio,
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
    onRatio(split.id, ratio);
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
        minSize="15"
      >
        {/* Mudar a estrutura (abrir/fechar painel) gera ids novos de divisão e remonta as folhas; o conteúdo
            delas fica no nó de cada uma (ver PaneTree) e só muda de lugar. */}
        <Node
          key={split.first.id}
          node={split.first}
          onRatio={onRatio}
          motion={motion}
          attach={attach}
        />
      </Panel>
      <Separator className="pane-tree__separator" aria-label="Redimensionar painéis" />
      <Panel
        id={secondId}
        className="pane-tree__panel"
        defaultSize={String((1 - split.ratio) * 100)}
        minSize="15"
      >
        <Node
          key={split.second.id}
          node={split.second}
          onRatio={onRatio}
          motion={motion}
          attach={attach}
        />
      </Panel>
    </Group>
  );
}
