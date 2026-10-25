import type { Tone } from '../mission-text';
import { ICON_PROPS, type LucideIcon } from './Icon';

/**
 * Selo em pílula com ponto de estado. O rótulo em texto é obrigatório e vai em maiúsculas pela CSS; o
 * tom só reforça (lima para o que roda, amarelo para o que aguarda, violeta para a marca, vermelho
 * para falha, neutro para o resto). Blue, orange e cyan têm a aparência neutra.
 *
 * O `icon` é opcional e decorativo (`aria-hidden`): entra antes do rótulo e toma o lugar do ponto, e o
 * texto continua sendo o que o leitor de tela lê. O rótulo fica como texto direto do selo, sem
 * invólucro, para o nome acessível e o texto do selo não mudarem. Sem `icon`, o selo é o de sempre.
 */
export function StatusChip({
  label,
  tone,
  icon: Icon,
}: {
  label: string;
  tone: Tone;
  icon?: LucideIcon | undefined;
}) {
  if (Icon === undefined) {
    return <span className={`chip chip--${tone}`}>{label}</span>;
  }
  return (
    <span className={`chip chip--${tone} chip--icon`}>
      <Icon {...ICON_PROPS} size={12} className="chip__icon" />
      {label}
    </span>
  );
}
