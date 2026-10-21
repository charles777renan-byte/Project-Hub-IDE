/**
 * Evento da janela disparado quando um projeto é cadastrado. A barra lateral ouve e recarrega sem
 * trocar de rota. Fica num módulo próprio para que quem dispara (a página de projetos) não dependa
 * de quem ouve (a barra).
 */
export const PROJECTS_CHANGED_EVENT = 'project-hub:projects-changed';
