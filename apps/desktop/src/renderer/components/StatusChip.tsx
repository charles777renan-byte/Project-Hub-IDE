import type { Tone } from '../mission-text';

/**
 * Chip quadrado com ponto de estado (visual do protótipo). O texto vai em maiúsculas pela CSS, e o
 * tom escolhe a cor: lima para o que roda, violeta para o que espera, laranja para pausa, vermelho para falha.
 */
export function StatusChip({ label, tone }: { label: string; tone: Tone }) {
  return <span className={`chip chip--${tone}`}>{label}</span>;
}
