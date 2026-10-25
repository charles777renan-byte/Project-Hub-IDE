/**
 * Cores dos projetos e dos grupos na barra lateral. A pessoa não escolhe: a cor sai do nome (ou do id), por um
 * cálculo fixo, então o mesmo projeto tem sempre a mesma cor. As classes `swatch--*` e `group-bar--*` ficam em
 * app.css.
 */
export const PROJECT_COLORS = ['purple', 'cyan', 'orange', 'pink', 'blue', 'teal'] as const;

export type ProjectColor = (typeof PROJECT_COLORS)[number];

/** A cor de um texto: a soma ponderada dos caracteres, no intervalo das cores. */
export function colorOf(key: string): ProjectColor {
  let hash = 0;
  for (const char of key) hash = (hash * 31 + (char.codePointAt(0) ?? 0)) % 9973;
  return PROJECT_COLORS[hash % PROJECT_COLORS.length] ?? 'purple';
}
