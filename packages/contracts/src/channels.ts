/** Canais IPC (seção 13.4). O sufixo `:vN` versiona o contrato de cada canal (seção 13.1). */
export const CHANNELS = {
  appPing: 'app:ping:v1',
  projectsList: 'projects:list:v1',
  projectsAdd: 'projects:add:v1',
  projectsChooseDirectory: 'projects:choose-directory:v1',
  /** Projetos arquivados, para a seção de arquivados (sem os removidos). */
  projectsListArchived: 'projects:list-archived:v1',
  projectsArchive: 'projects:archive:v1',
  projectsUnarchive: 'projects:unarchive:v1',
  /** Tira o projeto da lista. Não apaga a pasta, o Git nem as missões. */
  projectsRemove: 'projects:remove:v1',
  missionsCreate: 'missions:create:v1',
  missionsList: 'missions:list:v1',
  missionsGet: 'missions:get:v1',
  /** Alterações do worktree da missão em relação ao HEAD (Tarefa 10 da interface). */
  missionsDiff: 'missions:diff:v1',
  missionsPlan: 'missions:plan:v1',
  missionsApprovePlan: 'missions:approve-plan:v1',
  missionsStart: 'missions:start:v1',
  missionsCancel: 'missions:cancel:v1',
  missionsPause: 'missions:pause:v1',
  missionsResume: 'missions:resume:v1',
  /** Nova tentativa de missão `failed` ou `cancelled` (R180). Devolve a tentativa nova. */
  missionsRetry: 'missions:retry:v1',
  /** Exclui uma missão encerrada, com o plano, as tentativas, as aprovações e a auditoria. */
  missionsDelete: 'missions:delete:v1',
  missionsProvideInput: 'missions:provide-input:v1',
  /** Evento da missão, do processo principal para o renderer. Não tem resposta. */
  missionsEvent: 'missions:event:v1',
  approvalsDecide: 'approvals:decide:v1',
  /** Worktrees do projeto, derivados das missões (Tarefa 14 da interface). */
  worktreesList: 'worktrees:list:v1',
  /** Remove o worktree de uma missão encerrada, sem apagar a branch. */
  worktreesRemove: 'worktrees:remove:v1',
  /** Terminais dos agentes e shells (plano de agente real, Tarefa 7). Só entram ids, nunca caminho ou comando. */
  terminalsList: 'terminals:list:v1',
  terminalsOpenShell: 'terminals:open-shell:v1',
  terminalsWrite: 'terminals:write:v1',
  terminalsResize: 'terminals:resize:v1',
  terminalsSubscribe: 'terminals:subscribe:v1',
  terminalsUnsubscribe: 'terminals:unsubscribe:v1',
  /** Fecha um shell. O terminal de um agente se encerra cancelando a missão. */
  terminalsClose: 'terminals:close:v1',
  /** Saída e fim de um terminal assinado, do processo principal para o renderer. Não tem resposta. */
  terminalsEvent: 'terminals:event:v1',
  /** Workspaces de painéis (plano da fase 1). Só entram ids; o provedor de cada painel é resolvido no processo principal. */
  workspacesList: 'workspaces:list:v1',
  workspacesOpen: 'workspaces:open:v1',
  workspacesClose: 'workspaces:close:v1',
  workspacesSaveLayout: 'workspaces:save-layout:v1',
  /** Abre a sessão do provedor de um painel. */
  workspacesStartSession: 'workspaces:start-session:v1',
  workspacesEndSession: 'workspaces:end-session:v1',
  /** Programas que os painéis sabem abrir, com a disponibilidade de cada um. */
  providersList: 'providers:list:v1',
} as const;
