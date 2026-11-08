import type { AgentActivity } from './agent-activity';
import type {
  ContentSearchDto,
  FileContentDto,
  FileEntryDto,
  FileStatDto,
  FileVersionDto,
  FilesWriteInput,
  NameSearchDto,
} from './files';
import type {
  GithubCommentInput,
  GithubMergeInput,
  GithubPanelDto,
  GithubProjectInput,
} from './github';
import type {
  BranchChangesDto,
  GitCommitInput,
  GitCommitResultDto,
  GitDiffInput,
  GitFileDiffDto,
  GitLogEntryDto,
  GitPathsInput,
  GitProjectInput,
  GitPullResultDto,
  GitPushResultDto,
  GitStatusDto,
} from './git-panel';
import type { LimitsDto } from './limits';
import type { ProfileDto } from './profile';
import type { SessionsListInput, SessionsListResult, SessionsResumeInput } from './sessions';
import type { SystemUsageDto } from './system';
import type { AddProjectInput, ProjectSummary, RepositoryInitPreview } from './project';
import type { AppResult } from './result';
import type { WorktreeDto } from './responses';
import type { TerminalEvent, TerminalSummary } from './terminal';
import type { LayoutNode, ProviderId, ProviderInfo, WorkspaceDto } from './workspace';
import type {
  CreateMissionInput,
  DecideApprovalInput,
  EditPlanStepInput,
  ExecutionDto,
  MissionDiffDto,
  MissionDto,
  MissionEventDto,
  MissionPlanDto,
  MissionUsageEventDto,
  MissionViewDto,
  ProvideInput,
  RequestChanges,
} from './mission';

/**
 * API que o preload expõe ao renderer em `window.projectHub` (seção 13.3).
 * Cada método chama um canal fixo de `CHANNELS`; não existe envio genérico (seção 13.4).
 */
export type ProjectHubApi = {
  /** Confere que o processo principal responde. Devolve `'pong'`. */
  ping(): Promise<AppResult<string>>;
  projects: {
    /** Projetos ativos. Uma pasta que sumiu aparece com `available: false`. */
    list(): Promise<AppResult<ProjectSummary[]>>;
    /** Seletor nativo de pasta. Devolve `null` quando a pessoa cancela. */
    chooseDirectory(): Promise<AppResult<{ path: string } | null>>;
    /** Cadastra a pasta. O processo principal revalida o caminho (R66). */
    add(input: AddProjectInput): Promise<AppResult<ProjectSummary>>;
    /** Abre a pasta do projeto no gerenciador de arquivos. O processo principal acha o caminho pelo id. */
    openFolder(projectId: string): Promise<AppResult<void>>;
    /** O que a confirmação de criar o repositório Git mostra: o que está configurado e os nomes sensíveis. Não escreve. */
    repositoryPreview(projectId: string): Promise<AppResult<RepositoryInitPreview>>;
    /** Cria o repositório Git da pasta com o primeiro commit (ADR 0009). Só chamado depois da confirmação. */
    initRepository(projectId: string): Promise<AppResult<ProjectSummary>>;
    /** Põe o projeto num grupo da barra lateral, ou o tira (`null`). */
    setGroup(projectId: string, group: string | null): Promise<AppResult<void>>;
    /** Dá um apelido ao projeto (até 24 caracteres), ou o tira (`null`). */
    setNickname(projectId: string, nickname: string | null): Promise<AppResult<void>>;
    /** Projetos arquivados, com a disponibilidade da pasta. */
    listArchived(): Promise<AppResult<ProjectSummary[]>>;
    /** Arquiva o projeto: sai da lista, e a pasta, o Git e as missões ficam como estão. */
    archive(projectId: string): Promise<AppResult<void>>;
    /** Devolve um projeto arquivado para a lista principal. */
    unarchive(projectId: string): Promise<AppResult<void>>;
    /** Tira o projeto da lista. Não apaga a pasta, o Git nem as missões. */
    remove(projectId: string): Promise<AppResult<void>>;
  };
  missions: {
    /** Cria a missão em rascunho (RF-MIS-002). */
    create(input: CreateMissionInput): Promise<AppResult<MissionDto>>;
    /** As missões do projeto, da mais recente para a mais antiga. */
    list(projectId: string): Promise<AppResult<MissionDto[]>>;
    /** A visão completa de uma missão: plano, tentativas, aprovações pendentes e eventos. */
    get(missionId: string): Promise<AppResult<MissionViewDto>>;
    /** Alterações do worktree da missão em relação ao HEAD. Sem worktree, a lista vem vazia. */
    diff(missionId: string): Promise<AppResult<MissionDiffDto>>;
    /** Gera o plano, ou refaz o plano de uma missão planejada (R161). */
    plan(missionId: string, instruction?: string): Promise<AppResult<MissionPlanDto>>;
    /**
     * Edita uma tarefa do plano (renomear, remover, reordenar ou trocar o programa) antes de a missão
     * iniciar. Devolve o plano inteiro, já renumerado.
     */
    editPlanStep(input: EditPlanStepInput): Promise<AppResult<MissionPlanDto>>;
    /** Aprova o plano gerado: a missão vai para a fila. */
    approvePlan(missionId: string): Promise<AppResult<void>>;
    /**
     * Interrompe o planejamento em andamento e encerra o `claude` que o gera. A missão e o plano anterior
     * ficam como estavam; a chamada de `plan` que estava esperando termina com falha.
     */
    cancelPlanning(missionId: string): Promise<AppResult<void>>;
    /** Inicia a execução de uma missão aprovada. Devolve a tentativa no estado em que parou. */
    start(missionId: string): Promise<AppResult<ExecutionDto>>;
    /** Cancela a missão, encerrando o agente se ele estiver rodando (também a pausada). */
    cancel(missionId: string): Promise<AppResult<void>>;
    /** Pausa a missão em execução: o agente para de emitir e de agir até a retomada (R181). */
    pause(missionId: string): Promise<AppResult<void>>;
    /** Retoma a missão pausada, do ponto em que o agente parou (R181). */
    resume(missionId: string): Promise<AppResult<void>>;
    /** Nova tentativa de uma missão que falhou ou foi cancelada. Devolve a tentativa (R180). */
    retry(missionId: string): Promise<AppResult<ExecutionDto>>;
    /** Exclui a missão encerrada. Missão em andamento recusa: cancele antes. */
    delete(missionId: string): Promise<AppResult<void>>;
    /** Resposta do usuário ao pedido de entrada do agente. */
    provideInput(input: ProvideInput): Promise<AppResult<void>>;
    /** Aprova a conclusão que o agente entregou: a missão em revisão vira concluída. */
    approveReview(missionId: string): Promise<AppResult<void>>;
    /** Pede ajustes na revisão: abre nova tentativa no mesmo worktree, com o pedido no prompt. */
    requestChanges(input: RequestChanges): Promise<AppResult<ExecutionDto>>;
    /**
     * Assina os eventos das missões. Cada evento chega validado. Devolve a função que cancela a
     * assinatura.
     */
    subscribe(listener: (event: MissionEventDto) => void): () => void;
    /**
     * Assina o gasto de tokens das tentativas, a cada mudança. Cada evento chega validado e traz o total
     * da tentativa, não a diferença. Devolve a função que cancela a assinatura.
     */
    subscribeUsage(listener: (event: MissionUsageEventDto) => void): () => void;
  };
  terminals: {
    /** Agentes em andamento e shells abertos, com o estado de cada um. */
    list(): Promise<AppResult<TerminalSummary[]>>;
    write(terminalId: string, data: string): Promise<AppResult<void>>;
    resize(terminalId: string, cols: number, rows: number): Promise<AppResult<void>>;
    /** Passa a receber a saída do terminal: primeiro a guardada, depois a ao vivo. */
    subscribe(terminalId: string): Promise<AppResult<void>>;
    unsubscribe(terminalId: string): Promise<AppResult<void>>;
    /** Recebe os eventos dos terminais assinados, já conferidos. Devolve a função que cancela. */
    onEvent(listener: (event: TerminalEvent) => void): () => void;
  };
  worktrees: {
    /** Worktrees do projeto que ainda existem em disco, derivados das missões. */
    list(projectId: string): Promise<AppResult<WorktreeDto[]>>;
    /**
     * Remove o worktree de uma missão encerrada, sem forçar e sem apagar a branch. Com alteração não
     * salva, recusa com WORKTREE_HAS_UNSAVED_CHANGES e traz os arquivos em `details.files`.
     */
    remove(missionId: string): Promise<AppResult<void>>;
  };
  workspaces: {
    /** Os workspaces abertos, por posição. */
    list(): Promise<AppResult<WorkspaceDto[]>>;
    /** Abre o workspace do projeto, criando-o vazio (layout `null`) se for o primeiro. */
    open(projectId: string): Promise<AppResult<WorkspaceDto>>;
    /** Fecha a aba do workspace. As sessões dos painéis seguem vivas. */
    close(workspaceId: string): Promise<AppResult<void>>;
    /** Grava o layout. O processo principal recusa terminal que não seja do projeto. */
    saveLayout(workspaceId: string, layout: LayoutNode | null): Promise<AppResult<void>>;
    /** Abre a sessão do provedor do painel. Devolve o workspace com o layout atualizado. */
    startSession(workspaceId: string, leafId: string): Promise<AppResult<WorkspaceDto>>;
    /** Encerra a sessão do painel. Terminal de missão não encerra por aqui. */
    endSession(workspaceId: string, leafId: string): Promise<AppResult<WorkspaceDto>>;
    /** Abre uma sessão do programa e cria o painel dela; os painéis se reorganizam. Devolve o workspace inteiro. */
    addPane(workspaceId: string, provider: ProviderId): Promise<AppResult<WorkspaceDto>>;
    /** Encerra a sessão do painel (a de missão segue) e o tira do layout. Devolve o workspace inteiro. */
    removePane(workspaceId: string, leafId: string): Promise<AppResult<WorkspaceDto>>;
    /** Põe os workspaces abertos na ordem das abas. A lista precisa ter todos os abertos, uma vez cada. */
    reorder(workspaceIds: string[]): Promise<AppResult<void>>;
  };
  providers: {
    /** Os programas que um painel abre, e os que faltam no computador com o motivo. */
    list(): Promise<AppResult<ProviderInfo[]>>;
  };
  sessions: {
    /** O histórico das sessões dos programas. Escopo `workspace` e `project` pedem o projeto; `all` lista tudo. */
    list(input: SessionsListInput): Promise<AppResult<SessionsListResult>>;
    /** Abre um terminal na pasta da sessão, já retomando a conversa, e põe o painel no workspace. */
    resume(input: SessionsResumeInput): Promise<AppResult<WorkspaceDto>>;
  };
  activity: {
    /** Mensagens e tokens por agente e por dia, do uso feito pelo app. Só leitura, sem parâmetro. */
    agents(): Promise<AppResult<AgentActivity>>;
  };
  profile: {
    /** O nome da saudação, ou `null` quando a pessoa não informou um. */
    get(): Promise<AppResult<ProfileDto>>;
    /** Guarda o nome (até 40 caracteres, depois de aparar). `null` ou vazio tira o nome. */
    setDisplayName(name: string | null): Promise<AppResult<void>>;
  };
  system: {
    /** Uso do processador e da memória do computador. O processador é medido entre duas leituras. */
    usage(): Promise<AppResult<SystemUsageDto>>;
  };
  limits: {
    /** Limites da assinatura dos programas, da última leitura guardada. Não faz leitura nova. */
    get(): Promise<AppResult<LimitsDto>>;
    /**
     * Pede uma leitura nova. O processo principal limita a frequência: um pedido logo depois de outra leitura
     * devolve o estado que já tem. Espera a leitura terminar.
     */
    refresh(): Promise<AppResult<LimitsDto>>;
    /** Assina as mudanças dos limites. Cada evento chega validado. Devolve a função que cancela a assinatura. */
    subscribe(listener: (limits: LimitsDto) => void): () => void;
  };
  files: {
    /** Entradas de uma pasta do projeto. `dir` vazio é a raiz. O caminho é relativo, em POSIX. */
    list(projectId: string, dir: string): Promise<AppResult<FileEntryDto[]>>;
    /** Existência e versão do arquivo. */
    stat(projectId: string, path: string): Promise<AppResult<FileStatDto>>;
    /** Lê o arquivo de texto (até 2 MiB). O texto sai com `\n`; `eol` e `bom` dizem como estava no disco. */
    read(projectId: string, path: string): Promise<AppResult<FileContentDto>>;
    /**
     * Grava o arquivo. Com `expected`, recusa com FILE_CHANGED_ON_DISK se o disco mudou; com `null`, cria um
     * arquivo novo. Devolve a versão gravada.
     */
    write(input: FilesWriteInput): Promise<AppResult<FileVersionDto>>;
    /** Busca pelo nome do arquivo. */
    searchNames(projectId: string, query: string): Promise<AppResult<NameSearchDto>>;
    /** Busca pelo conteúdo dos arquivos de texto; `regex` trata a consulta como expressão regular. */
    searchContent(
      projectId: string,
      query: string,
      regex: boolean,
    ): Promise<AppResult<ContentSearchDto>>;
    /** Abre o arquivo no programa padrão do sistema. */
    openDefault(projectId: string, path: string): Promise<AppResult<void>>;
    /**
     * Fechar a janela com arquivo não salvo e a pessoa escolher "Salvar": o processo principal pede ao renderer que
     * grave tudo, e `handler` devolve `true` só se tudo foi gravado e nada ficou sujo (o preload leva a resposta de
     * volta). Com qualquer outra resposta a janela fica aberta. Devolve a função que cancela a assinatura.
     */
    onSaveAllRequest(handler: () => Promise<boolean>): () => void;
  };
  git: {
    /** Branch, upstream, à frente/atrás, linhas contra a base e arquivos alterados do projeto. */
    status(input: GitProjectInput): Promise<AppResult<GitStatusDto>>;
    /** Diff de um arquivo contra o último commit (`HEAD`). O caminho é relativo, em POSIX. */
    diff(input: GitDiffInput): Promise<AppResult<GitFileDiffDto>>;
    /** Põe os arquivos em stage. Os caminhos são relativos, em POSIX. */
    stage(input: GitPathsInput): Promise<AppResult<void>>;
    unstage(input: GitPathsInput): Promise<AppResult<void>>;
    /** Descarta as alterações dos arquivos no disco. Não tem volta: a tela pede confirmação antes. */
    discard(input: GitPathsInput): Promise<AppResult<void>>;
    /** Cria o commit com o que está em stage. Os hooks rodam; se um recusar, volta GIT_HOOK_FAILED. */
    commit(input: GitCommitInput): Promise<AppResult<GitCommitResultDto>>;
    /** Envia a branch atual para `origin`. Exige upstream, nunca força; o nome da branch sai do processo principal. */
    push(input: GitProjectInput): Promise<AppResult<GitPushResultDto>>;
    /** Publica a branch atual (`push -u origin`). Exige que ela ainda não tenha upstream; o nome da branch sai do processo principal. */
    publish(input: GitProjectInput): Promise<AppResult<GitPushResultDto>>;
    /** Traz os commits do remoto só se a branch puder avançar (sem commit de merge). */
    pull(input: GitProjectInput): Promise<AppResult<GitPullResultDto>>;
    /** Atualiza as refs remotas, sem mexer na branch local. */
    fetch(input: GitProjectInput): Promise<AppResult<void>>;
    /** Histórico da branch atual. */
    log(input: GitProjectInput): Promise<AppResult<GitLogEntryDto[]>>;
    /** Arquivos que a branch mudou em relação à base. */
    branchChanges(input: GitProjectInput): Promise<AppResult<BranchChangesDto>>;
  };
  github: {
    /**
     * O PR da branch atual, com checks e comentários. Sem PR e pasta que não é do GitHub são respostas de
     * sucesso (`no-pr`, `not-applicable`); sem `gh`, sem login e sem rede voltam como erro (`GH_*`).
     */
    pr(input: GithubProjectInput): Promise<AppResult<GithubPanelDto>>;
    /** Comenta no PR. O corpo é texto puro; o número é conferido contra o PR da branch atual. */
    comment(input: GithubCommentInput): Promise<AppResult<void>>;
    /** Mescla o PR depois de reler o estado (só aberto e mesclável). A tela pede confirmação antes. */
    merge(input: GithubMergeInput): Promise<AppResult<void>>;
    /**
     * Abre no navegador padrão um endereço que veio do GitHub. O processo principal confere: só `https://github.com`,
     * sem usuário, senha nem porta; o resto volta como erro, sem abrir. Abre direto, sem confirmação.
     */
    openUrl(url: string): Promise<AppResult<void>>;
  };
  approvals: {
    /** Aprova ou recusa uma ação protegida pedida pelo agente (seção 17.3). */
    decide(input: DecideApprovalInput): Promise<AppResult<void>>;
  };
};
