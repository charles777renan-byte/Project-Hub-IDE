/**
 * Evento da janela que pede para esconder ou mostrar o painel direito: a paleta de comandos o dispara, e o `App`,
 * dono do painel, o atende (o botão da barra superior e o Ctrl+Alt+B chamam a mesma função dele).
 */
export const TOGGLE_RIGHT_PANEL_EVENT = 'project-hub:toggle-right-panel';

/**
 * Evento da janela que expande o painel direito para toda a largura do corpo da janela, ou o devolve ao tamanho
 * dele: o botão Expandir do navegador o dispara, e o `App`, dono das colunas, o atende.
 */
export const TOGGLE_RIGHT_EXPANDED_EVENT = 'project-hub:toggle-right-expanded';

/**
 * Evento da janela que pede para mostrar um painel de terminal do projeto: o cartão do preview o dispara ("Ver
 * terminal"), e o `App`, que tem o roteador, leva à aba do projeto com o pedido.
 */
export const SHOW_TERMINAL_EVENT = 'project-hub:show-terminal';

export type ShowTerminalRequest = { projectId: string; terminalId: string };

export function requestShowTerminal(projectId: string, terminalId: string): void {
  window.dispatchEvent(
    new CustomEvent<ShowTerminalRequest>(SHOW_TERMINAL_EVENT, {
      detail: { projectId, terminalId },
    }),
  );
}

/** O pedido que o evento traz, ou `null` se ele não traz um pedido inteiro. */
export function showTerminalRequest(event: Event): ShowTerminalRequest | null {
  const detail: unknown = event instanceof CustomEvent ? event.detail : null;
  if (typeof detail !== 'object' || detail === null) return null;
  const { projectId, terminalId } = detail as Record<string, unknown>;
  if (typeof projectId !== 'string' || projectId === '') return null;
  if (typeof terminalId !== 'string' || terminalId === '') return null;
  return { projectId, terminalId };
}
