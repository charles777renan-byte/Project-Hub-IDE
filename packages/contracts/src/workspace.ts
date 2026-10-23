import { z } from 'zod';
import { LAYOUT_LIMITS } from './layout-limits';

export { LAYOUT_LIMITS };

/** Programas que um painel do workspace sabe abrir. O comando de cada um fica no processo principal. */
export const PROVIDER_IDS = ['claude', 'codex', 'gemini', 'shell'] as const;
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
  /** `row` põe `first` à esquerda; `column` põe `first` em cima. */
  direction: 'row' | 'column';
  first: LayoutNode;
  second: LayoutNode;
  /** Fração do espaço que fica com `first`. */
  ratio: number;
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

    if (!(node.ratio >= LAYOUT_LIMITS.minRatio && node.ratio <= LAYOUT_LIMITS.maxRatio)) {
      return `A divisão "${node.id}" tem ratio ${node.ratio}; o permitido é de ${LAYOUT_LIMITS.minRatio} a ${LAYOUT_LIMITS.maxRatio}.`;
    }
    return visit(node.first, depth + 1) ?? visit(node.second, depth + 1);
  };

  return visit(root, 1);
}

const leafShape = z.object({
  type: z.literal('leaf'),
  id: z.string().min(1).max(128),
  provider: providerIdSchema,
  terminalId: z.string().min(1).max(128).nullable(),
});

// Só o formato, recursivo. As regras do conjunto (limites, ids únicos, faixa do ratio) rodam uma
// vez na raiz, em `layoutIssue`; por isso o `superRefine` fica fora do `z.lazy`.
const layoutShape: z.ZodType<LayoutNode> = z.lazy(() =>
  z.discriminatedUnion('type', [
    leafShape,
    z.object({
      type: z.literal('split'),
      id: z.string().min(1).max(128),
      direction: z.enum(['row', 'column']),
      first: layoutShape,
      second: layoutShape,
      ratio: z.number().finite(),
    }),
  ]),
);

export const workspaceLayoutSchema: z.ZodType<LayoutNode> = layoutShape.superRefine(
  (layout, ctx) => {
    const issue = layoutIssue(layout);
    if (issue !== null) ctx.addIssue({ code: 'custom', message: issue });
  },
);

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

export const saveLayoutInputSchema = z.object({
  workspaceId: idSchema,
  layout: workspaceLayoutSchema,
});

/** Entrada dos canais que agem num painel: o workspace e a folha, nunca comando ou caminho. */
export const paneInputSchema = z.object({ workspaceId: idSchema, leafId: idSchema });
