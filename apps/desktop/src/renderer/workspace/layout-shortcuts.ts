import type { Side } from '@project-hub/contracts/layout-ops';
import type { ShortcutKeys } from './provider-shortcuts';

/**
 * Atalhos do layout dos terminais. Valem na captura do workspace, antes do xterm, então funcionam com o teclado
 * dentro de um terminal:
 *
 * - Ctrl+Alt+setas: leva o foco ao painel vizinho daquele lado (com um painel por vez na tela, ←/→ trocam de aba).
 *   Não é Alt+setas, que nos shells e nos agentes de linha de comando anda palavra por palavra.
 * - Alt+Shift+setas: troca o painel ativo de lugar com o vizinho daquele lado.
 * - Alt+Shift+D: duplica o painel ativo (abre outro do mesmo programa ao lado, ou abaixo se ao lado não couber).
 * - Alt+Shift+(+): divide à direita. Alt+Shift+(−): divide abaixo.
 * - Ctrl+Shift+W: fecha o painel ativo, com a mesma pergunta do X.
 *
 * As teclas são lidas pelo `code` (a tecla física): no ABNT2, o `+` e o `−` mudam de `key` com o Shift, e Ctrl+Alt é o
 * AltGr. O `+` vale na tecla `=`/`+` e no teclado numérico; o `−`, na tecla `-` e no teclado numérico.
 */
export type LayoutShortcut =
  | { type: 'focus'; side: Side }
  | { type: 'swap'; side: Side }
  | { type: 'split'; side: 'right' | 'bottom' }
  | { type: 'duplicate' }
  | { type: 'close' };

const ARROWS: Readonly<Record<string, Side>> = {
  ArrowLeft: 'left',
  ArrowRight: 'right',
  ArrowUp: 'top',
  ArrowDown: 'bottom',
};

/** O atalho de layout que o evento pede, ou `null` se ele não é um. */
export function layoutShortcut(event: ShortcutKeys): LayoutShortcut | null {
  if (event.metaKey) return null;
  const arrow = ARROWS[event.code];
  if (event.ctrlKey && event.altKey && !event.shiftKey) {
    return arrow === undefined ? null : { type: 'focus', side: arrow };
  }
  if (event.altKey && event.shiftKey && !event.ctrlKey) {
    if (arrow !== undefined) return { type: 'swap', side: arrow };
    if (event.code === 'KeyD') return { type: 'duplicate' };
    if (event.code === 'Equal' || event.code === 'NumpadAdd') {
      return { type: 'split', side: 'right' };
    }
    if (event.code === 'Minus' || event.code === 'NumpadSubtract') {
      return { type: 'split', side: 'bottom' };
    }
    return null;
  }
  if (event.ctrlKey && event.shiftKey && !event.altKey && event.code === 'KeyW') {
    return { type: 'close' };
  }
  return null;
}
