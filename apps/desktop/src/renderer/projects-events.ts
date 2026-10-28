/**
 * Evento da janela disparado quando um projeto é cadastrado, restaurado, arquivado ou removido. A barra
 * lateral ouve e recarrega sem trocar de rota. Fica num módulo próprio para que quem dispara (a lateral, as
 * páginas de projeto e de missão) não dependa de quem ouve.
 */
export const PROJECTS_CHANGED_EVENT = 'project-hub:projects-changed';

/**
 * Evento da janela que pede para adicionar um projeto: a paleta de comandos e o menu "+" da barra superior o
 * disparam, e a barra lateral, dona do fluxo (seletor de pasta e cadastro), o atende.
 */
export const ADD_PROJECT_REQUEST_EVENT = 'project-hub:add-project-request';
