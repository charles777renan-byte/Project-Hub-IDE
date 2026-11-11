import { z } from 'zod';
import { LAYOUT_LIMITS } from './layout-limits';

export { LAYOUT_LIMITS };

/** Programas que um painel do workspace sabe abrir. O comando de cada um fica no processo principal. */
export const PROVIDER_IDS = [
  'claude',
  'codex',
  'antigravity',
  'opencode',
  'freebuff',
  'shell',
] as const;
export const providerIdSchema = z.enum(PROVIDER_IDS);
export type ProviderId = z.infer<typeof providerIdSchema>;

/** Um provedor como a interface o mostra: se dá para abrir e, quando não dá, o motivo. */
export const providerInfoSchema = z.object({
  id: providerIdSchema,
  label: z.string(),
  available: z.boolean(),
  reason: z.string().optional(),
});
export type ProviderInfo = z.infer<typeof providerInfoSchema>;

export type LayoutLeaf = {
  type: 'leaf';
  id: string;
  provider: ProviderId;
  /** `null` enquanto o painel não tem sessão aberta. */
  terminalId: string | null;
};

export type LayoutSplit = {
  type: 'split';
  id: string;
  /** `row` põe os filhos lado a lado, da esquerda para a direita; `column` os empilha, de cima para baixo. */
  direction: 'row' | 'column';
  /** Dois filhos ou mais. */
  children: LayoutNode[];
  /** A fração do espaço de cada filho, na mesma ordem; somam 1. */
  sizes: number[];
};

export type LayoutNode = LayoutLeaf | LayoutSplit;

/**
 * A primeira regra que o layout viola, em texto, ou `null` se ele vale. A raiz é o nível 1.
 * Para de descer ao passar da profundidade máxima, então uma árvore absurda custa pouco.
 */
export function layoutIssue(root: LayoutNode): string | null {
  const ids = new Set<string>();
  const terminalIds = new Set<string>();
  let leaves = 0;

  const visit = (node: LayoutNode, depth: number): string | null => {
    if (depth > LAYOUT_LIMITS.maxDepth) {
      return `O layout passa de ${LAYOUT_LIMITS.maxDepth} níveis de profundidade.`;
    }
    if (ids.has(node.id)) return `O id "${node.id}" aparece mais de uma vez no layout.`;
    ids.add(node.id);

    if (node.type === 'leaf') {
      leaves += 1;
      if (leaves > LAYOUT_LIMITS.maxLeaves) {
        return `O layout passa de ${LAYOUT_LIMITS.maxLeaves} painéis.`;
      }
      if (node.terminalId !== null) {
        if (terminalIds.has(node.terminalId)) {
          return `O terminal "${node.terminalId}" está em mais de um painel.`;
        }
        terminalIds.add(node.terminalId);
      }
      return null;
    }

    if (node.children.length < 2) return `A divisão "${node.id}" tem menos de dois painéis.`;
    if (node.sizes.length !== node.children.length) {
      return `A divisão "${node.id}" tem ${node.children.length} painéis e ${node.sizes.length} tamanhos.`;
    }
    if (node.sizes.some((size) => !(size >= LAYOUT_LIMITS.minSize))) {
      return `A divisão "${node.id}" tem um tamanho abaixo de ${LAYOUT_LIMITS.minSize}.`;
    }
    const total = node.sizes.reduce((sum, size) => sum + size, 0);
    if (Math.abs(total - 1) > LAYOUT_LIMITS.sizeTolerance) {
      return `Os tamanhos da divisão "${node.id}" somam ${total}; o esperado é 1.`;
    }
    for (const child of node.children) {
      const issue = visit(child, depth + 1);
      if (issue !== null) return issue;
    }
    return null;
  };

  return visit(root, 1);
}

const leafShape = z.object({
  type: z.literal('leaf'),
  id: z.string().min(1).max(128),
  provider: providerIdSchema,
  terminalId: z.string().min(1).max(128).nullable(),
});

// Só o formato, recursivo. As regras do conjunto (limites, ids únicos, tamanhos) rodam uma
// vez na raiz, em `layoutIssue`; por isso o `superRefine` fica fora do `z.lazy`.
const layoutShape: z.ZodType<LayoutNode> = z.lazy(() =>
  z.discriminatedUnion('type', [
    leafShape,
    z.object({
      type: z.literal('split'),
      id: z.string().min(1).max(128),
      direction: z.enum(['row', 'column']),
      // O teto do comprimento barra a lista absurda antes de descer nela; as regras finas ficam no `layoutIssue`.
      children: z.array(layoutShape).max(LAYOUT_LIMITS.maxLeaves),
      sizes: z.array(z.number().finite()).max(LAYOUT_LIMITS.maxLeaves),
    }),
  ]),
);

/** `null` é o workspace vazio, sem nenhum painel. */
export const workspaceLayoutSchema: z.ZodType<LayoutNode | null> = layoutShape
  .superRefine((layout, ctx) => {
    const issue = layoutIssue(layout);
    if (issue !== null) ctx.addIssue({ code: 'custom', message: issue });
  })
  .nullable();

export const workspaceDtoSchema = z.object({
  id: z.string(),
  projectId: z.string(),
  layout: workspaceLayoutSchema,
  position: z.number().int().min(0),
  lastActiveAt: z.string(),
});
export type WorkspaceDto = z.infer<typeof workspaceDtoSchema>;

const idSchema = z.string().min(1).max(128);

/** Entrada de `workspaces:open:v1` e `workspaces:list:v1`: o projeto, nunca um caminho. */
export const openWorkspaceInputSchema = z.object({ projectId: idSchema });

export const workspaceIdInputSchema = z.object({ workspaceId: idSchema });

/**
 * Entrada de `workspaces:reorder:v1`: a ordem nova dos workspaces abertos, cada um uma vez. A lista precisa
 * ter todos os abertos; a aplicação confere isso contra o banco.
 */
export const reorderWorkspacesInputSchema = z.object({
  workspaceIds: z
    .array(idSchema)
    .min(1)
    .max(200)
    .refine((ids) => new Set(ids).size === ids.length, 'Um workspace aparece mais de uma vez.'),
});

export type ReorderWorkspacesInput = z.infer<typeof reorderWorkspacesInputSchema>;

export const saveLayoutInputSchema = z.object({
  workspaceId: idSchema,
  layout: workspaceLayoutSchema,
});

/** Entrada de `workspaces:add-pane:v1`: o workspace e o programa; o comando sai do registro de provedores. */
export const addPaneInputSchema = z.object({ workspaceId: idSchema, provider: providerIdSchema });

/**
 * Entrada de `workspaces:split-pane:v1`: o painel que cede espaço, o lado em que o novo entra e o programa dele.
 * Nunca comando ou caminho.
 */
export const splitPaneInputSchema = z.object({
  workspaceId: idSchema,
  leafId: idSchema,
  side: z.enum(['left', 'right', 'top', 'bottom']),
  provider: providerIdSchema,
});

/** Entrada dos canais que agem num painel: o workspace e a folha, nunca comando ou caminho. */
export const paneInputSchema = z.object({ workspaceId: idSchema, leafId: idSchema });
