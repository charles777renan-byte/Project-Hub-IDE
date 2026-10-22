/**
 * Evento da janela disparado quando a lista de workspaces abertos muda (abrir ou fechar uma aba). Quem
 * lê a lista (`useOpenWorkspaces`) ouve e recarrega. Fica num módulo próprio para que quem dispara não
 * dependa de quem ouve.
 */
export const WORKSPACES_CHANGED_EVENT = 'project-hub:workspaces-changed';
