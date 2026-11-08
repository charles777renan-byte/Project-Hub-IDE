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
  projectsOpenFolder: 'projects:open-folder:v1',
  /** O que a confirmação de criar o repositório Git mostra (ADR 0009). Não escreve nada. */
  projectsRepositoryPreview: 'projects:repository-preview:v1',
  /** Cria o repositório Git com o primeiro commit, depois da confirmação (ADR 0009). */
  projectsInitRepository: 'projects:init-repository:v1',
  projectsSetGroup: 'projects:set-group:v1',
  projectsSetNickname: 'projects:set-nickname:v1',
  missionsCreate: 'missions:create:v1',
  missionsList: 'missions:list:v1',
  missionsGet: 'missions:get:v1',
  /** Alterações do worktree da missão em relação ao HEAD (Tarefa 10 da interface). */
  missionsDiff: 'missions:diff:v1',
  /** Gera o plano ou o refaz; a instrução opcional é o pedido de ajuste da pessoa. */
  missionsPlan: 'missions:plan:v1',
  /** Edita uma tarefa do plano antes de a missão iniciar. Devolve o plano inteiro. */
  missionsEditPlan: 'missions:edit-plan:v1',
  missionsApprovePlan: 'missions:approve-plan:v1',
  /** Interrompe o planejamento em andamento da missão, sem cancelar a missão. */
  missionsCancelPlanning: 'missions:cancel-planning:v1',
  missionsStart: 'missions:start:v1',
  missionsCancel: 'missions:cancel:v1',
  missionsPause: 'missions:pause:v1',
  missionsResume: 'missions:resume:v1',
  /** Nova tentativa de missão `failed` ou `cancelled` (R180). Devolve a tentativa nova. */
  missionsRetry: 'missions:retry:v1',
  /** Exclui uma missão encerrada, com o plano, as tentativas, as aprovações e a auditoria. */
  missionsDelete: 'missions:delete:v1',
  missionsProvideInput: 'missions:provide-input:v1',
  missionsApproveReview: 'missions:approve-review:v1',
  missionsRequestChanges: 'missions:request-changes:v1',
  /** Evento da missão, do processo principal para o renderer. Não tem resposta. */
  missionsEvent: 'missions:event:v1',
  /** Gasto de tokens de uma tentativa, a cada mudança, do processo principal para o renderer. Não tem resposta. */
  missionsUsage: 'missions:usage:v1',
  approvalsDecide: 'approvals:decide:v1',
  /** Worktrees do projeto, derivados das missões (Tarefa 14 da interface). */
  worktreesList: 'worktrees:list:v1',
  /** Remove o worktree de uma missão encerrada, sem apagar a branch. */
  worktreesRemove: 'worktrees:remove:v1',
  /** Terminais dos agentes e shells (plano de agente real, Tarefa 7). Só entram ids, nunca caminho ou comando. */
  terminalsList: 'terminals:list:v1',
  terminalsWrite: 'terminals:write:v1',
  terminalsResize: 'terminals:resize:v1',
  terminalsSubscribe: 'terminals:subscribe:v1',
  terminalsUnsubscribe: 'terminals:unsubscribe:v1',
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
  /** Abre a sessão do programa e cria o painel dela, num pedido só. */
  workspacesAddPane: 'workspaces:add-pane:v1',
  /** Encerra a sessão do painel e o tira do layout, num pedido só. */
  workspacesRemovePane: 'workspaces:remove-pane:v1',
  /** Põe os workspaces abertos na ordem das abas. Recebe a lista inteira dos abertos, cada um uma vez. */
  workspacesReorder: 'workspaces:reorder:v1',
  /** Programas que os painéis sabem abrir, com a disponibilidade de cada um. */
  providersList: 'providers:list:v1',
  /** Mensagens e tokens por agente e por dia, para o bloco "Visão geral" do Início. Só leitura. */
  activityAgents: 'activity:agents:v1',
  /** Perfil local: o nome da saudação do Início. Só leitura. */
  profileGet: 'profile:get:v1',
  profileSetDisplayName: 'profile:set-display-name:v1',
  /** Uso do processador e da memória do computador, para o cabeçalho. Só leitura. */
  systemUsage: 'system:usage:v1',
  /** Limites da assinatura dos programas (cartão de uso do Início): a última leitura guardada. */
  limitsGet: 'limits:get:v1',
  /** Pede uma leitura nova dos limites. Devolve o estado depois da leitura (ou o de antes, se ela é recente). */
  limitsRefresh: 'limits:refresh:v1',
  /** Mudança nos limites (leitura nova ou em andamento), do processo principal para o renderer. Não tem resposta. */
  limitsEvent: 'limits:event:v1',
  /** Arquivos do projeto (painel direito, fase 1). Só entram o id do projeto e um caminho relativo POSIX. */
  filesList: 'files:list:v1',
  filesStat: 'files:stat:v1',
  filesRead: 'files:read:v1',
  filesWrite: 'files:write:v1',
  filesSearchNames: 'files:search-names:v1',
  filesSearchContent: 'files:search-content:v1',
  /** Abre o arquivo no programa padrão do sistema. */
  filesOpenDefault: 'files:open-default:v1',
  /** Fechar a janela com "Salvar": o processo principal pede ao renderer que grave os arquivos sujos. Não tem resposta. */
  filesSaveAllRequest: 'files:save-all-request:v1',
  /** O renderer diz como foi o pedido acima: `saved` só vale `true` se nada ficou sujo. */
  filesSaveAllResult: 'files:save-all-result:v1',
  /** Painel de código-fonte (fase 2, ADR 0010): branch, upstream, à frente/atrás e arquivos alterados. Só entram o id do projeto, caminhos relativos POSIX e a mensagem do commit. */
  gitStatus: 'git:status:v1',
  /** Diff de um arquivo contra o último commit (`HEAD`). */
  gitDiff: 'git:diff:v1',
  /** Põe arquivos em stage. */
  gitStage: 'git:stage:v1',
  /** Tira arquivos do stage. */
  gitUnstage: 'git:unstage:v1',
  /** Descarta as alterações de arquivos no disco. Não tem volta. */
  gitDiscard: 'git:discard:v1',
  /** Cria o commit com o que está em stage. */
  gitCommit: 'git:commit:v1',
  /** Envia a branch atual, que já tem upstream, para `origin`; o nome da branch sai do processo principal. */
  gitPush: 'git:push:v1',
  /** Publica a branch atual, que ainda não tem upstream (`push -u`); o nome da branch sai do processo principal. */
  gitPublish: 'git:publish:v1',
  /** Traz os commits do remoto só se a branch puder avançar (sem commit de merge). */
  gitPull: 'git:pull:v1',
  /** Atualiza as refs remotas, sem mexer na branch local. */
  gitFetch: 'git:fetch:v1',
  /** Histórico da branch atual. */
  gitLog: 'git:log:v1',
  /** Arquivos que a branch mudou em relação à base. */
  gitBranchChanges: 'git:branch-changes:v1',
  /** Painel de checks (fase 3): o PR da branch atual, com checks e comentários. Só entra o id do projeto; o processo principal descobre o PR. */
  githubPr: 'github:pr:v1',
  /** Comenta no PR. Entram o id do projeto, o número do PR e o texto; o número é conferido contra o PR da branch atual. */
  githubComment: 'github:comment:v1',
  /** Mescla o PR depois de reler o estado: só com PR aberto e mesclável. Sem `--admin`, `--auto` nem `--delete-branch`. */
  githubMerge: 'github:merge:v1',
  /** Abre no navegador um endereço do `github.com` (link de check ou de comentário). Só o processo principal decide: https, host exato, sem usuário, senha nem porta. */
  githubOpenUrl: 'github:open-url:v1',
  /** Histórico das sessões dos agentes (painel direito, fase 4). Só entram escopo e busca; o texto vem como texto puro. */
  sessionsList: 'sessions:list:v1',
  /** Retomar em Worktree. Entram só o id do workspace e o id da sessão: pasta e programa saem do índice no processo principal. */
  sessionsResume: 'sessions:resume:v1',
} as const;
