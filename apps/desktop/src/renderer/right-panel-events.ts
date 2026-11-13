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
