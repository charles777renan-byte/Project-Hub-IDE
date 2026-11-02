import {
  CHANNELS,
  filesSaveAllRequestSchema,
  limitsDtoSchema,
  missionEventDtoSchema,
  missionUsageEventDtoSchema,
  terminalEventSchema,
  responseSchemas,
  type AddProjectInput,
  type AgentActivity,
  type AppResult,
  type ContentSearchDto,
  type CreateMissionInput,
  type DecideApprovalInput,
  type EditPlanStepInput,
  type ExecutionDto,
  type FileContentDto,
  type FileEntryDto,
  type FileStatDto,
  type FileVersionDto,
  type FilesWriteInput,
  type BranchChangesDto,
  type GitCommitInput,
  type GitCommitResultDto,
  type GitDiffInput,
  type GitFileDiffDto,
  type GitLogEntryDto,
  type GitPathsInput,
  type GitProjectInput,
  type GitPullResultDto,
  type GitPushResultDto,
  type GitStatusDto,
  type LayoutNode,
  type LimitsDto,
  type MissionDiffDto,
  type MissionDto,
  type MissionEventDto,
  type MissionPlanDto,
  type MissionUsageEventDto,
  type MissionViewDto,
  type NameSearchDto,
  type ProfileDto,
  type SystemUsageDto,
  type ProjectHubApi,
  type ProjectSummary,
  type ProviderId,
  type ProviderInfo,
  type ProvideInput,
  type RepositoryInitPreview,
  type RequestChanges,
  type TerminalEvent,
  type TerminalSummary,
  type WorkspaceDto,
  type WorktreeDto,
} from '@project-hub/contracts';

/** Chamada ao processo principal. No preload, é `ipcRenderer.invoke`. */
export type Invoke = (channel: string, payload?: unknown) => Promise<unknown>;

/**
 * Assinatura de um canal que o processo principal envia (main → renderer). Devolve a função que
 * remove o ouvinte. No preload, é `ipcRenderer.on`.
 */
export type Subscribe = (channel: string, listener: (payload: unknown) => void) => () => void;

type ResponseChannel = keyof typeof responseSchemas;

function invalidResponse(): AppResult<never> {
  return {
    ok: false,
    error: {
      code: 'VALIDATION_FAILED',
      message: 'O processo principal devolveu uma resposta fora do contrato.',
      retryable: false,
    },
  };
}

/**
 * Chama um canal e confere a resposta com o schema dele (seção 13.1 e R28). Resposta que não bate vira
 * VALIDATION_FAILED, registrada com console.warn, e o renderer não recebe o dado inesperado. Resposta
 * que bate segue como o schema a define: campos extras do processo principal ficam de fora.
 */
async function invokeChannel<T>(
  invoke: Invoke,
  channel: ResponseChannel,
  payload?: unknown,
): Promise<AppResult<T>> {
  const response = await invoke(channel, payload);
  const parsed = responseSchemas[channel].safeParse(response);
  if (!parsed.success) {
    console.warn(`Resposta fora do contrato no canal ${channel}:`, parsed.error.issues);
    return invalidResponse();
  }
  return parsed.data as AppResult<T>;
}

/**
 * Monta a API que o preload expõe ao renderer. É uma função pura: cada método chama um canal fixo
 * de `CHANNELS`, e o renderer nunca escolhe o canal nem recebe `invoke` ou `on` (seção 13.4).
 */
export function buildProjectHubApi(invoke: Invoke, subscribe: Subscribe): ProjectHubApi {
  const call = <T>(channel: ResponseChannel, payload?: unknown) =>
    invokeChannel<T>(invoke, channel, payload);

  return {
    ping: () => call<string>(CHANNELS.appPing),
    projects: {
      list: () => call<ProjectSummary[]>(CHANNELS.projectsList),
      chooseDirectory: () => call<{ path: string } | null>(CHANNELS.projectsChooseDirectory),
      add: (input: AddProjectInput) => call<ProjectSummary>(CHANNELS.projectsAdd, input),
      listArchived: () => call<ProjectSummary[]>(CHANNELS.projectsListArchived),
      archive: (projectId: string) => call<void>(CHANNELS.projectsArchive, { projectId }),
      unarchive: (projectId: string) => call<void>(CHANNELS.projectsUnarchive, { projectId }),
      remove: (projectId: string) => call<void>(CHANNELS.projectsRemove, { projectId }),
      openFolder: (projectId: string) => call<void>(CHANNELS.projectsOpenFolder, { projectId }),
      repositoryPreview: (projectId: string) =>
        call<RepositoryInitPreview>(CHANNELS.projectsRepositoryPreview, { projectId }),
      initRepository: (projectId: string) =>
        call<ProjectSummary>(CHANNELS.projectsInitRepository, { projectId }),
      setGroup: (projectId: string, group: string | null) =>
        call<void>(CHANNELS.projectsSetGroup, { projectId, group }),
      setNickname: (projectId: string, nickname: string | null) =>
        call<void>(CHANNELS.projectsSetNickname, { projectId, nickname }),
    },
    missions: {
      create: (input: CreateMissionInput) => call<MissionDto>(CHANNELS.missionsCreate, input),
      list: (projectId: string) => call<MissionDto[]>(CHANNELS.missionsList, { projectId }),
      get: (missionId: string) => call<MissionViewDto>(CHANNELS.missionsGet, { missionId }),
      diff: (missionId: string) => call<MissionDiffDto>(CHANNELS.missionsDiff, { missionId }),
      plan: (missionId: string, instruction?: string) =>
        call<MissionPlanDto>(
          CHANNELS.missionsPlan,
          instruction === undefined ? { missionId } : { missionId, instruction },
        ),
      editPlanStep: (input: EditPlanStepInput) =>
        call<MissionPlanDto>(CHANNELS.missionsEditPlan, input),
      approvePlan: (missionId: string) => call<void>(CHANNELS.missionsApprovePlan, { missionId }),
      cancelPlanning: (missionId: string) =>
        call<void>(CHANNELS.missionsCancelPlanning, { missionId }),
      start: (missionId: string) => call<ExecutionDto>(CHANNELS.missionsStart, { missionId }),
      cancel: (missionId: string) => call<void>(CHANNELS.missionsCancel, { missionId }),
      pause: (missionId: string) => call<void>(CHANNELS.missionsPause, { missionId }),
      resume: (missionId: string) => call<void>(CHANNELS.missionsResume, { missionId }),
      retry: (missionId: string) => call<ExecutionDto>(CHANNELS.missionsRetry, { missionId }),
      delete: (missionId: string) => call<void>(CHANNELS.missionsDelete, { missionId }),
      provideInput: (input: ProvideInput) => call<void>(CHANNELS.missionsProvideInput, input),
      approveReview: (missionId: string) =>
        call<void>(CHANNELS.missionsApproveReview, { missionId }),
      requestChanges: (input: RequestChanges) =>
        call<ExecutionDto>(CHANNELS.missionsRequestChanges, input),
      subscribe: (listener: (event: MissionEventDto) => void) =>
        subscribe(CHANNELS.missionsEvent, (payload) => {
          const parsed = missionEventDtoSchema.safeParse(payload);
          if (!parsed.success) {
            console.warn(
              `Evento fora do contrato no canal ${CHANNELS.missionsEvent}:`,
              parsed.error.issues,
            );
            return;
          }
          listener(parsed.data);
        }),
      subscribeUsage: (listener: (event: MissionUsageEventDto) => void) =>
        subscribe(CHANNELS.missionsUsage, (payload) => {
          const parsed = missionUsageEventDtoSchema.safeParse(payload);
          if (!parsed.success) {
            console.warn(
              `Evento fora do contrato no canal ${CHANNELS.missionsUsage}:`,
              parsed.error.issues,
            );
            return;
          }
          listener(parsed.data);
        }),
    },
    terminals: {
      list: () => call<TerminalSummary[]>(CHANNELS.terminalsList),
      write: (terminalId: string, data: string) =>
        call<void>(CHANNELS.terminalsWrite, { terminalId, data }),
      resize: (terminalId: string, cols: number, rows: number) =>
        call<void>(CHANNELS.terminalsResize, { terminalId, cols, rows }),
      subscribe: (terminalId: string) => call<void>(CHANNELS.terminalsSubscribe, { terminalId }),
      unsubscribe: (terminalId: string) =>
        call<void>(CHANNELS.terminalsUnsubscribe, { terminalId }),
      onEvent: (listener: (event: TerminalEvent) => void) =>
        subscribe(CHANNELS.terminalsEvent, (payload) => {
          const parsed = terminalEventSchema.safeParse(payload);
          if (!parsed.success) {
            console.warn(
              'Evento fora do contrato no canal ' + CHANNELS.terminalsEvent + ':',
              parsed.error.issues,
            );
            return;
          }
          listener(parsed.data);
        }),
    },
    workspaces: {
      list: () => call<WorkspaceDto[]>(CHANNELS.workspacesList),
      open: (projectId: string) => call<WorkspaceDto>(CHANNELS.workspacesOpen, { projectId }),
      close: (workspaceId: string) => call<void>(CHANNELS.workspacesClose, { workspaceId }),
      saveLayout: (workspaceId: string, layout: LayoutNode | null) =>
        call<void>(CHANNELS.workspacesSaveLayout, { workspaceId, layout }),
      startSession: (workspaceId: string, leafId: string) =>
        call<WorkspaceDto>(CHANNELS.workspacesStartSession, { workspaceId, leafId }),
      // Contrato do processo principal; a tela não usa (fechar o painel já encerra a sessão).
      endSession: (workspaceId: string, leafId: string) =>
        call<WorkspaceDto>(CHANNELS.workspacesEndSession, { workspaceId, leafId }),
      addPane: (workspaceId: string, provider: ProviderId) =>
        call<WorkspaceDto>(CHANNELS.workspacesAddPane, { workspaceId, provider }),
      removePane: (workspaceId: string, leafId: string) =>
        call<WorkspaceDto>(CHANNELS.workspacesRemovePane, { workspaceId, leafId }),
      reorder: (workspaceIds: string[]) => call<void>(CHANNELS.workspacesReorder, { workspaceIds }),
    },
    providers: {
      list: () => call<ProviderInfo[]>(CHANNELS.providersList),
    },
    worktrees: {
      list: (projectId: string) => call<WorktreeDto[]>(CHANNELS.worktreesList, { projectId }),
      remove: (missionId: string) => call<void>(CHANNELS.worktreesRemove, { missionId }),
    },
    activity: {
      agents: () => call<AgentActivity>(CHANNELS.activityAgents),
    },
    profile: {
      get: () => call<ProfileDto>(CHANNELS.profileGet),
      setDisplayName: (name: string | null) => call<void>(CHANNELS.profileSetDisplayName, { name }),
    },
    system: {
      usage: () => call<SystemUsageDto>(CHANNELS.systemUsage),
    },
    limits: {
      get: () => call<LimitsDto>(CHANNELS.limitsGet),
      refresh: () => call<LimitsDto>(CHANNELS.limitsRefresh),
      subscribe: (listener: (limits: LimitsDto) => void) =>
        subscribe(CHANNELS.limitsEvent, (payload) => {
          const parsed = limitsDtoSchema.safeParse(payload);
          if (!parsed.success) {
            console.warn(
              `Evento fora do contrato no canal ${CHANNELS.limitsEvent}:`,
              parsed.error.issues,
            );
            return;
          }
          listener(parsed.data);
        }),
    },
    files: {
      list: (projectId: string, dir: string) =>
        call<FileEntryDto[]>(CHANNELS.filesList, { projectId, dir }),
      stat: (projectId: string, path: string) =>
        call<FileStatDto>(CHANNELS.filesStat, { projectId, path }),
      read: (projectId: string, path: string) =>
        call<FileContentDto>(CHANNELS.filesRead, { projectId, path }),
      write: (input: FilesWriteInput) => call<FileVersionDto>(CHANNELS.filesWrite, input),
      searchNames: (projectId: string, query: string) =>
        call<NameSearchDto>(CHANNELS.filesSearchNames, { projectId, query }),
      searchContent: (projectId: string, query: string, regex: boolean) =>
        call<ContentSearchDto>(CHANNELS.filesSearchContent, { projectId, query, regex }),
      onSaveAllRequest: (handler: () => Promise<boolean>) =>
        subscribe(CHANNELS.filesSaveAllRequest, (payload) => {
          const parsed = filesSaveAllRequestSchema.safeParse(payload);
          if (!parsed.success) {
            console.warn(
              `Evento fora do contrato no canal ${CHANNELS.filesSaveAllRequest}:`,
              parsed.error.issues,
            );
            return;
          }
          const { requestId } = parsed.data;
          // Qualquer falha do salvamento vale "não salvou": a janela só fecha com um `true` explícito.
          void Promise.resolve()
            .then(handler)
            .catch(() => false)
            .then((saved) =>
              invoke(CHANNELS.filesSaveAllResult, { requestId, saved }).catch(() => undefined),
            );
        }),
      openDefault: (projectId: string, path: string) =>
        call<void>(CHANNELS.filesOpenDefault, { projectId, path }),
    },
    git: {
      status: (input: GitProjectInput) => call<GitStatusDto>(CHANNELS.gitStatus, input),
      diff: (input: GitDiffInput) => call<GitFileDiffDto>(CHANNELS.gitDiff, input),
      stage: (input: GitPathsInput) => call<void>(CHANNELS.gitStage, input),
      unstage: (input: GitPathsInput) => call<void>(CHANNELS.gitUnstage, input),
      discard: (input: GitPathsInput) => call<void>(CHANNELS.gitDiscard, input),
      commit: (input: GitCommitInput) => call<GitCommitResultDto>(CHANNELS.gitCommit, input),
      push: (input: GitProjectInput) => call<GitPushResultDto>(CHANNELS.gitPush, input),
      pull: (input: GitProjectInput) => call<GitPullResultDto>(CHANNELS.gitPull, input),
      fetch: (input: GitProjectInput) => call<void>(CHANNELS.gitFetch, input),
      log: (input: GitProjectInput) => call<GitLogEntryDto[]>(CHANNELS.gitLog, input),
      branchChanges: (input: GitProjectInput) =>
        call<BranchChangesDto>(CHANNELS.gitBranchChanges, input),
    },
    approvals: {
      decide: (input: DecideApprovalInput) => call<void>(CHANNELS.approvalsDecide, input),
    },
  };
}
