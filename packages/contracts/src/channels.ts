/** Canais IPC (seção 13.4). O sufixo `:vN` versiona o contrato de cada canal (seção 13.1). */
export const CHANNELS = {
  appPing: 'app:ping:v1',
  projectsList: 'projects:list:v1',
  projectsAdd: 'projects:add:v1',
  projectsChooseDirectory: 'projects:choose-directory:v1',
} as const;
