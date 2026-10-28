import type { LayoutLeaf } from '@project-hub/contracts';

/**
 * O modo "um painel por vez" do workspace: só um painel aparece (o ativo), com uma faixa de abas para trocar. Vive só
 * na tela e não muda o layout guardado. Estas são as regras puras que a página usa.
 */

/** O painel ao lado de `id` (`-1` anterior, `1` seguinte), voltando ao outro lado nas pontas. `null` sem painéis. */
export function stepSolo(leaves: readonly LayoutLeaf[], id: string, step: -1 | 1): string | null {
  if (leaves.length === 0) return null;
  const from = Math.max(
    0,
    leaves.findIndex((leaf) => leaf.id === id),
  );
  return leaves[(from + step + leaves.length) % leaves.length]?.id ?? null;
}

/**
 * Quem passa a aparecer quando o painel `id` for fechado: o que ocupa a posição dele (o seguinte) ou, se era o
 * último, o anterior. `null` se não sobra nenhum.
 */
export function neighbourOf(leaves: readonly LayoutLeaf[], id: string): string | null {
  const from = leaves.findIndex((leaf) => leaf.id === id);
  if (from < 0) return null;
  const rest = leaves.filter((leaf) => leaf.id !== id);
  return rest[Math.min(from, rest.length - 1)]?.id ?? null;
}
