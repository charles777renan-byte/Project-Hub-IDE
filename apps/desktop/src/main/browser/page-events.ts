import type { BrowserBounds, BrowserLoadErrorCode } from '@project-hub/contracts';
import type { PageShortcut } from './browser-service';

// Funções puras que traduzem o que o Electron conta de uma página (tecla, erro de carga, retângulo). Ficam fora de
// browser-views.ts para serem testadas sem o Electron.

/** O que este módulo usa do `Input` do evento `before-input-event`. */
export type KeyInput = {
  type: string;
  key: string;
  control: boolean;
  alt: boolean;
  shift: boolean;
  meta: boolean;
};

/**
 * O atalho do app que esta tecla representa, ou `undefined` para a página receber a tecla. Com o foco dentro da
 * página, as teclas não passam pelo renderer do app: este conjunto pequeno é interceptado antes da página, para a
 * pessoa não ficar presa nela (F6 e Ctrl+Alt+B) e para o navegador ter os atalhos de sempre.
 */
export function shortcutOf(input: KeyInput): PageShortcut | undefined {
  if (input.type !== 'keyDown' || input.shift || input.meta) return undefined;
  const key = input.key.length === 1 ? input.key.toLowerCase() : input.key;
  if (input.control && input.alt) return key === 'b' ? 'toggle-right-panel' : undefined;
  if (input.control) {
    if (key === 'l') return 'focus-address';
    if (key === 't') return 'new-tab';
    if (key === 'w') return 'close-tab';
    if (key === 'r') return 'reload';
    return undefined;
  }
  if (input.alt) {
    if (key === 'ArrowLeft') return 'back';
    if (key === 'ArrowRight') return 'forward';
    return undefined;
  }
  if (key === 'F6') return 'focus-toolbar';
  if (key === 'F5') return 'reload';
  return undefined;
}

/** Códigos de erro de rede do Chromium que significam "o servidor não aceitou a conexão". */
const REFUSED_CODES: ReadonlySet<number> = new Set([-101, -102, -104, -118]);
/** Nome que não resolve. */
const NOT_FOUND_CODES: ReadonlySet<number> = new Set([-105, -137]);

/**
 * Traduz o código de erro do `did-fail-load`. `-3` é carga cancelada (a pessoa navegou para outro lugar, ou a
 * navegação foi barrada): não é erro, e devolve `null`.
 */
export function loadErrorOf(errorCode: number): BrowserLoadErrorCode | null {
  if (errorCode === -3) return null;
  if (errorCode === -106) return 'OFFLINE';
  if (REFUSED_CODES.has(errorCode)) return 'REFUSED';
  if (NOT_FOUND_CODES.has(errorCode)) return 'NOT_FOUND';
  if (errorCode <= -200 && errorCode >= -219) return 'CERTIFICATE';
  return 'UNKNOWN';
}

/**
 * O retângulo que o renderer mediu (pixels de CSS) no sistema de coordenadas da janela, que é o da view. Com zoom
 * diferente de 100% na janela do app, um pixel de CSS não vale um pixel da janela.
 */
export function toViewBounds(bounds: BrowserBounds, zoomFactor: number): BrowserBounds {
  return {
    x: Math.round(bounds.x * zoomFactor),
    y: Math.round(bounds.y * zoomFactor),
    width: Math.round(bounds.width * zoomFactor),
    height: Math.round(bounds.height * zoomFactor),
  };
}

/** Diz se o retângulo, já no sistema da janela, cabe inteiro na área de conteúdo dela. */
export function fitsContent(
  bounds: BrowserBounds,
  content: { width: number; height: number },
): boolean {
  return (
    bounds.x >= 0 &&
    bounds.y >= 0 &&
    bounds.x + bounds.width <= content.width &&
    bounds.y + bounds.height <= content.height
  );
}
