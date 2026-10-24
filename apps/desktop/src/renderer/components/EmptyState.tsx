import type { LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { ICON_PROPS } from './Icon';

/**
 * Estado vazio: ícone decorativo (aria-hidden), título, dica opcional e uma ação opcional, em geral um botão que
 * já existe na tela ("Abrir projeto"). Não cria fluxo: sem ação onde não houver. O título aceita nó
 * (um link dentro da frase, por exemplo); a classe extra deixa o chamador ligar o estilo dele.
 */
export function EmptyState({
  icon: Icon,
  title,
  hint,
  action,
  className,
}: {
  icon: LucideIcon;
  title: ReactNode;
  hint?: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div className={className === undefined ? 'empty-state' : `empty-state ${className}`}>
      <Icon {...ICON_PROPS} size={24} className="empty-state__icon" />
      <p className="empty-state__title">{title}</p>
      {hint === undefined ? null : <p className="empty-state__hint">{hint}</p>}
      {action === undefined ? null : <div className="empty-state__action">{action}</div>}
    </div>
  );
}
