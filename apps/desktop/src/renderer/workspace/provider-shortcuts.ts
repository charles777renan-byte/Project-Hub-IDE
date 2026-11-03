/**
 * Atalhos dos programas do menu "Abrir terminal": Ctrl+Alt+1 abre o primeiro programa do menu, Ctrl+Alt+2 o
 * segundo, e assim até o nono. O número é a posição na lista que o menu recebe (a lista inteira, não a filtrada
 * pela busca), então o atalho de um programa não muda enquanto se digita.
 *
 * A tecla é lida pelo `code` (a tecla física), nunca pelo `key`: no teclado ABNT2 do Windows, Ctrl+Alt é o AltGr, e
 * o `key` do AltGr+1 a 3 chega como ¹ ² ³. Com o prefixo Ctrl+Alt, como nos outros atalhos do app, o xterm não
 * toma a tecla do terminal (a captura roda antes dele).
 */

/** O que o atalho precisa saber do evento de teclado (cabe tanto no nativo quanto no do React). */
export interface ShortcutKeys {
  code: string;
  ctrlKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
  metaKey: boolean;
}

const MAX_SHORTCUTS = 9;

/** A posição (0 a 8) do programa que o atalho aponta, ou `null` se o evento não é um atalho de programa. */
export function providerShortcutIndex(event: ShortcutKeys): number | null {
  if (!event.ctrlKey || !event.altKey || event.shiftKey || event.metaKey) return null;
  const digit = /^Digit([1-9])$/.exec(event.code)?.[1];
  return digit === undefined ? null : Number(digit) - 1;
}

/** O atalho como o menu o mostra ("Ctrl+Alt+1"), ou `undefined` se a posição não tem atalho. */
export function providerShortcutLabel(index: number): string | undefined {
  return index >= 0 && index < MAX_SHORTCUTS ? `Ctrl+Alt+${index + 1}` : undefined;
}

/** O mesmo atalho no formato do `aria-keyshortcuts` ("Control+Alt+1"). */
export function providerShortcutKeys(index: number): string | undefined {
  return index >= 0 && index < MAX_SHORTCUTS ? `Control+Alt+${index + 1}` : undefined;
}
