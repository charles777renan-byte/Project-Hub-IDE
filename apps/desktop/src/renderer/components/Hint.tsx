import * as Tooltip from '@radix-ui/react-tooltip';
import type { ReactElement } from 'react';

/** Atraso antes da dica aparecer ao passar o mouse. Ao focar por teclado ela aparece na hora. */
const HINT_DELAY_MS = 400;

/**
 * Dica de um botão só de ícone (ou de um texto curto demais para dizer o efeito). Envolve UM elemento
 * focável: mostra `label` ao focá-lo por teclado ou ao passar o mouse, e some com Esc. O elemento filho
 * mantém o nome acessível dele (aria-label ou texto): a dica só o descreve (aria-describedby), nunca
 * o nomeia. O estilo vem da classe `.hint` (app.css), sem estilo escrito em texto (CSP estrita).
 */
export function Hint({
  label,
  children,
  side = 'bottom',
}: {
  label: string;
  children: ReactElement;
  /** De que lado do elemento a dica abre. Abaixo, por padrão. */
  side?: 'top' | 'bottom';
}) {
  return (
    <Tooltip.Provider delayDuration={HINT_DELAY_MS} skipDelayDuration={0}>
      <Tooltip.Root>
        <Tooltip.Trigger asChild>{children}</Tooltip.Trigger>
        <Tooltip.Portal>
          <Tooltip.Content className="hint" side={side} sideOffset={6} collisionPadding={8}>
            {label}
          </Tooltip.Content>
        </Tooltip.Portal>
      </Tooltip.Root>
    </Tooltip.Provider>
  );
}
