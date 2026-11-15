/** O que este módulo usa de um nó da árvore de acessibilidade do Chromium (`Accessibility.getFullAXTree`). */
export type AxNode = {
  nodeId: string;
  ignored?: boolean;
  role?: { value?: unknown };
  name?: { value?: unknown };
  value?: { value?: unknown };
  childIds?: string[];
  backendDOMNodeId?: number;
};

export type Snapshot = {
  /** A estrutura em texto, uma linha por elemento, recuada pela hierarquia. */
  text: string;
  /** Referência (`e3`) → nó do DOM, para clicar e digitar. */
  refs: Map<string, number>;
};

/** Papéis em que dá para clicar ou digitar: só eles ganham referência. */
const INTERACTIVE: ReadonlySet<string> = new Set([
  'button',
  'link',
  'textbox',
  'searchbox',
  'checkbox',
  'radio',
  'combobox',
  'listbox',
  'option',
  'menuitem',
  'menuitemcheckbox',
  'menuitemradio',
  'tab',
  'switch',
  'slider',
  'spinbutton',
]);

/** Papéis que organizam a página e aparecem mesmo sem nome. */
const STRUCTURAL: ReadonlySet<string> = new Set([
  'main',
  'navigation',
  'banner',
  'contentinfo',
  'complementary',
  'region',
  'form',
  'search',
  'dialog',
  'alertdialog',
  'alert',
  'list',
  'listitem',
  'table',
  'row',
  'cell',
  'columnheader',
  'rowheader',
  'tablist',
  'tabpanel',
  'menu',
  'menubar',
  'toolbar',
  'tree',
  'treeitem',
  'group',
  'article',
  'figure',
  'img',
  'heading',
]);

/** Maior nome ou valor escrito numa linha. */
const LABEL_MAX = 200;

function str(value: unknown): string {
  return typeof value === 'string' ? value : typeof value === 'number' ? String(value) : '';
}

function quote(text: string): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  const cut = flat.length > LABEL_MAX ? `${flat.slice(0, LABEL_MAX)}…` : flat;
  return `"${cut.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

/**
 * Monta a estrutura que o agente lê. Nó ignorado ou que só agrupa não vira linha, mas os filhos dele sobem. O
 * texto de um elemento que já disse o próprio nome (o rótulo de um botão) não é repetido. Nunca lança: árvore
 * torta (ciclo, filho que não existe) é percorrida até onde dá.
 */
export function buildSnapshot(nodes: readonly AxNode[]): Snapshot {
  const refs = new Map<string, number>();
  const root = nodes[0];
  if (root === undefined) return { text: '', refs };
  const byId = new Map(nodes.map((node) => [node.nodeId, node]));
  const seen = new Set<string>();
  const lines: string[] = [];

  const walk = (node: AxNode, depth: number, parentName: string): void => {
    if (seen.has(node.nodeId)) return;
    seen.add(node.nodeId);
    const role = str(node.role?.value);
    const name = str(node.name?.value).trim();
    let line: string | undefined;

    if (node === root) {
      line = name === '' ? 'page' : `page ${quote(name)}`;
    } else if (node.ignored === true) {
      line = undefined;
    } else if (role === 'StaticText') {
      if (name !== '' && name !== parentName) line = `text ${quote(name)}`;
    } else if (INTERACTIVE.has(role)) {
      line = name === '' ? role : `${role} ${quote(name)}`;
      if (node.backendDOMNodeId !== undefined) {
        const ref = `e${String(refs.size + 1)}`;
        refs.set(ref, node.backendDOMNodeId);
        line += ` [ref=${ref}]`;
      }
      const value = str(node.value?.value);
      if (value !== '') line += ` value=${quote(value)}`;
    } else if (STRUCTURAL.has(role)) {
      line = name === '' ? role : `${role} ${quote(name)}`;
    }

    if (line !== undefined) lines.push(`${'  '.repeat(depth)}- ${line}`);
    const printed = line !== undefined;
    for (const childId of node.childIds ?? []) {
      const child = byId.get(childId);
      if (child !== undefined) {
        walk(child, printed ? depth + 1 : depth, printed && name !== '' ? name : parentName);
      }
    }
  };

  walk(root, 0, '');
  return { text: lines.join('\n'), refs };
}
