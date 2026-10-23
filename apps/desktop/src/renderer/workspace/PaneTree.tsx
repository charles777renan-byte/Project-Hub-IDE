import { useEffect, useRef, type ReactNode } from 'react';
import {
  Group,
  Panel,
  Separator,
  useGroupRef,
  type Layout,
  type LayoutChangedMeta,
} from 'react-resizable-panels';
import type { LayoutLeaf, LayoutNode, LayoutSplit } from '@project-hub/contracts';

const MIN_RATIO = 0.15;
const MAX_RATIO = 0.85;
const EPSILON = 0.0005;

type PaneTreeProps = {
  layout: LayoutNode;
  /** Chamado quando o usuário termina de mover uma divisória; `ratio` é a fração de `first`. */
  onRatio(splitId: string, ratio: number): void;
  renderLeaf(leaf: LayoutLeaf): ReactNode;
};

export function PaneTree({ layout, onRatio, renderLeaf }: PaneTreeProps) {
  return (
    <div className="pane-tree">
      <Node node={layout} onRatio={onRatio} renderLeaf={renderLeaf} />
    </div>
  );
}

type NodeProps = Omit<PaneTreeProps, 'layout'> & { node: LayoutNode };

function Node({ node, onRatio, renderLeaf }: NodeProps) {
  if (node.type === 'leaf') {
    return <div className="pane-tree__leaf">{renderLeaf(node)}</div>;
  }
  return <SplitNode split={node} onRatio={onRatio} renderLeaf={renderLeaf} />;
}

function SplitNode({
  split,
  onRatio,
  renderLeaf,
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
        <Node node={split.first} onRatio={onRatio} renderLeaf={renderLeaf} />
      </Panel>
      <Separator className="pane-tree__separator" />
      <Panel
        id={secondId}
        className="pane-tree__panel"
        defaultSize={String((1 - split.ratio) * 100)}
        minSize="15"
      >
        <Node node={split.second} onRatio={onRatio} renderLeaf={renderLeaf} />
      </Panel>
    </Group>
  );
}
