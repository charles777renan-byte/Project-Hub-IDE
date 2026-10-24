import type { Tone } from '../mission-text';

/**
 * Selo em pílula com ponto de estado. O rótulo em texto é obrigatório e vai em maiúsculas pela CSS; o
 * tom só reforça (lima para o que roda, amarelo para o que aguarda, violeta para a marca, vermelho
 * para falha, neutro para o resto). Blue, orange e cyan têm a aparência neutra.
 */
export function StatusChip({ label, tone }: { label: string; tone: Tone }) {
  return <span className={`chip chip--${tone}`}>{label}</span>;
}
