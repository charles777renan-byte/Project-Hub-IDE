/** Onde uma aba estava quando o arrasto começou: o início e a largura, na mesma medida do ponteiro. */
export type TabSlot = { id: string; left: number; width: number };

/** A ordem que o arrasto produz e quanto cada aba anda para a direita (negativo: para a esquerda) até lá. */
export type DropPreview = { order: string[]; shifts: Map<string, number> };

/**
 * Como ficam as abas se a arrastada for solta com a borda esquerda em `left`. A decisão usa só os lugares de
 * antes do arrasto (`slots`), nunca as posições atuais: as abas se mexem durante o arrasto, e medir nelas faria
 * o destino oscilar. A arrastada passa uma aba quando a borda da frente dela passa do meio da outra: a
 * esquerda, ao ir para a esquerda, e a direita, ao ir para a direita. (O meio da arrastada erraria quando ela é
 * mais larga que a vizinha: no limite da barra já teria passado.) As abas ocupam os mesmos lugares de sempre,
 * só que na ordem nova, com a mesma folga entre elas.
 */
export function previewDrop(
  slots: readonly TabSlot[],
  draggedId: string,
  left: number,
): DropPreview {
  const dragged = slots.find((slot) => slot.id === draggedId);
  const first = slots[0];
  if (dragged === undefined || first === undefined) {
    return { order: slots.map((slot) => slot.id), shifts: new Map() };
  }
  const right = left + dragged.width;
  const draggedAt = slots.indexOf(dragged);
  const others = slots.filter((slot) => slot.id !== draggedId);
  const stayBefore = new Set(
    others
      .filter((slot) => {
        const middle = slot.left + slot.width / 2;
        return slots.indexOf(slot) < draggedAt ? left >= middle : right > middle;
      })
      .map((slot) => slot.id),
  );
  const ordered = [
    ...others.filter((slot) => stayBefore.has(slot.id)),
    dragged,
    ...others.filter((slot) => !stayBefore.has(slot.id)),
  ];
  const second = slots[1];
  const gap = second === undefined ? 0 : second.left - (first.left + first.width);

  const shifts = new Map<string, number>();
  let cursor = first.left;
  for (const slot of ordered) {
    shifts.set(slot.id, cursor - slot.left);
    cursor += slot.width + gap;
  }
  return { order: ordered.map((slot) => slot.id), shifts };
}

/**
 * A lista com `id` trocada de lugar com a vizinha: `-1` é a anterior e `1` é a seguinte. `null` quando `id` não
 * está na lista ou já está na ponta que o passo pede.
 */
export function stepId(ids: readonly string[], id: string, step: -1 | 1): string[] | null {
  const from = ids.indexOf(id);
  const to = from + step;
  const neighbour = ids[to];
  if (from < 0 || neighbour === undefined) return null;
  const next = [...ids];
  next[from] = neighbour;
  next[to] = id;
  return next;
}
