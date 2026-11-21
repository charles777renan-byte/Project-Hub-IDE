import {
  alertOpenEventSchema,
  loginEventSchema,
  type AccountDto,
  type AccountsDto,
  type AccountTargetInput,
  type AddAccountInput,
  type AppInfoDto,
  type LoginDto,
  type LoginEvent,
  type RemoveAccountInput,
  type RenameAccountInput,
  type AlertNotifyInput,
  type AlertOpenEvent,
  CHANNELS,
  browserShortcutEventSchema,
  browserStateSchema,
  previewStateSchema,
  workspaceDtoSchema,
  type PreviewStateDto,
  filesChangedEventSchema,
  filesSaveAllRequestSchema,
  limitsDtoSchema,
  missionEventDtoSchema,
  missionUsageEventDtoSchema,
  terminalEventSchema,
  responseSchemas,
  type AddProjectInput,
  type AgentActivity,
  type AppResult,
  type BrowserAgentAccessDto,
  type BrowserBounds,
  type BrowserShortcutEvent,
  type BrowserStateDto,
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
  type GithubCommentInput,
  type GithubMergeInput,
  type GithubPanelDto,
  type GithubProjectInput,
  type LayoutNode,
  type LimitsDto,
  type MissionDiffDto,
  type MissionDto,
  type SetMissionAccountInput,
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
  type SessionsListInput,
  type SessionsListResult,
  type SessionsResumeInput,
  type ProvideInput,
  type GitIdentity,
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
      initRepository: (projectId: string, identity?: GitIdentity) =>
        call<ProjectSummary>(
          CHANNELS.projectsInitRepository,
          identity === undefined ? { projectId } : { projectId, identity },
        ),
      setGroup: (projectId: string, group: string | null) =>
        call<void>(CHANNELS.projectsSetGroup, { projectId, group }),
      setNickname: (projectId: string, nickname: string | null) =>
        call<void>(CHANNELS.projectsSetNickname, { projectId, nickname }),
      setMuted: (projectId: string, muted: boolean) =>
        call<void>(CHANNELS.projectsSetMuted, { projectId, muted }),
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
      setAccount: (input: SetMissionAccountInput) =>
        call<MissionDto>(CHANNELS.missionsSetAccount, input),
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
      // Só o sinal: o canal não leva dados, e a tela relê a lista pelo canal de pedido.
      onChanged: (listener: () => void) => subscribe(CHANNELS.terminalsChanged, () => listener()),
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
      // Sem conta no pedido, o campo nem vai: o processo principal usa a padrão do programa.
      addPane: (workspaceId: string, provider: ProviderId, accountId?: string | null) =>
        call<WorkspaceDto>(CHANNELS.workspacesAddPane, {
          workspaceId,
          provider,
          ...(accountId === undefined ? {} : { accountId }),
        }),
      splitPane: (
        workspaceId: string,
        leafId: string,
        side: 'left' | 'right' | 'top' | 'bottom',
        provider: ProviderId,
        accountId?: string | null,
      ) =>
        call<WorkspaceDto>(CHANNELS.workspacesSplitPane, {
          workspaceId,
          leafId,
          side,
          provider,
          ...(accountId === undefined ? {} : { accountId }),
        }),
      removePane: (workspaceId: string, leafId: string) =>
        call<WorkspaceDto>(CHANNELS.workspacesRemovePane, { workspaceId, leafId }),
      reorder: (workspaceIds: string[]) => call<void>(CHANNELS.workspacesReorder, { workspaceIds }),
      onChanged: (listener: (workspace: WorkspaceDto) => void) =>
        subscribe(CHANNELS.workspacesChanged, (payload) => {
          const parsed = workspaceDtoSchema.safeParse(payload);
          if (!parsed.success) {
            console.warn(
              `Evento fora do contrato no canal ${CHANNELS.workspacesChanged}:`,
              parsed.error.issues,
            );
            return;
          }
          listener(parsed.data);
        }),
    },
    preview: {
      state: (projectId: string) => call<PreviewStateDto>(CHANNELS.previewState, { projectId }),
      approve: (projectId: string, script: string, shownBody: string) =>
        call<PreviewStateDto>(CHANNELS.previewApprove, { projectId, script, shownBody }),
      setAddress: (projectId: string, text: string) =>
        call<PreviewStateDto>(CHANNELS.previewSetAddress, { projectId, text }),
      start: (projectId: string, tabId: string, options?: { restart?: boolean }) =>
        call<PreviewStateDto>(CHANNELS.previewStart, {
          projectId,
          tabId,
          ...(options?.restart === undefined ? {} : { restart: options.restart }),
        }),
      forget: (projectId: string) => call<PreviewStateDto>(CHANNELS.previewForget, { projectId }),
      onChanged: (listener: (state: PreviewStateDto) => void) =>
        subscribe(CHANNELS.previewChanged, (payload) => {
          const parsed = previewStateSchema.safeParse(payload);
          if (!parsed.success) {
            console.warn(
              `Evento fora do contrato no canal ${CHANNELS.previewChanged}:`,
              parsed.error.issues,
            );
            return;
          }
          listener(parsed.data);
        }),
    },
    providers: {
      list: () => call<ProviderInfo[]>(CHANNELS.providersList),
    },
    sessions: {
      list: (input: SessionsListInput) => call<SessionsListResult>(CHANNELS.sessionsList, input),
      resume: (input: SessionsResumeInput) => call<WorkspaceDto>(CHANNELS.sessionsResume, input),
    },
    browser: {
      state: (projectId: string) => call<BrowserStateDto>(CHANNELS.browserState, { projectId }),
      openTab: (projectId: string) => call<BrowserStateDto>(CHANNELS.browserOpenTab, { projectId }),
      closeTab: (projectId: string, tabId: string) =>
        call<BrowserStateDto>(CHANNELS.browserCloseTab, { projectId, tabId }),
      selectTab: (projectId: string, tabId: string) =>
        call<BrowserStateDto>(CHANNELS.browserSelectTab, { projectId, tabId }),
      navigate: (projectId: string, tabId: string, text: string) =>
        call<BrowserStateDto>(CHANNELS.browserNavigate, { projectId, tabId, text }),
      back: (projectId: string, tabId: string) =>
        call<void>(CHANNELS.browserBack, { projectId, tabId }),
      forward: (projectId: string, tabId: string) =>
        call<void>(CHANNELS.browserForward, { projectId, tabId }),
      reload: (projectId: string, tabId: string) =>
        call<void>(CHANNELS.browserReload, { projectId, tabId }),
      stop: (projectId: string, tabId: string) =>
        call<void>(CHANNELS.browserStop, { projectId, tabId }),
      setBounds: (projectId: string, bounds: BrowserBounds | null) =>
        call<void>(CHANNELS.browserSetBounds, { projectId, bounds }),
      snapshot: (projectId: string) => call<string | null>(CHANNELS.browserSnapshot, { projectId }),
      focusPage: (projectId: string) => call<void>(CHANNELS.browserFocusPage, { projectId }),
      openDevtools: (projectId: string, tabId: string) =>
        call<void>(CHANNELS.browserOpenDevtools, { projectId, tabId }),
      openExternal: (projectId: string, tabId: string) =>
        call<void>(CHANNELS.browserOpenExternal, { projectId, tabId }),
      clearData: (projectId: string) =>
        call<BrowserStateDto>(CHANNELS.browserClearData, { projectId }),
      /** Quais programas recebem o navegador ao abrir um terminal. Só rótulos e sim ou não. */
      agentAccess: () => call<BrowserAgentAccessDto>(CHANNELS.browserAgentAccess),
      onChanged: (listener: (state: BrowserStateDto) => void) =>
        subscribe(CHANNELS.browserChanged, (payload) => {
          const parsed = browserStateSchema.safeParse(payload);
          if (!parsed.success) {
            console.warn(
              `Evento fora do contrato no canal ${CHANNELS.browserChanged}:`,
              parsed.error.issues,
            );
            return;
          }
          listener(parsed.data);
        }),
      onShortcut: (listener: (event: BrowserShortcutEvent) => void) =>
        subscribe(CHANNELS.browserShortcut, (payload) => {
          const parsed = browserShortcutEventSchema.safeParse(payload);
          if (!parsed.success) {
            console.warn(
              `Evento fora do contrato no canal ${CHANNELS.browserShortcut}:`,
              parsed.error.issues,
            );
            return;
          }
          listener(parsed.data);
        }),
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
      refreshAccount: (input: AccountTargetInput) =>
        call<LimitsDto>(CHANNELS.limitsRefreshAccount, input),
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
      watch: (projectId: string, onChange: () => void) => {
        const stop = subscribe(CHANNELS.filesChanged, (payload) => {
          const parsed = filesChangedEventSchema.safeParse(payload);
          if (!parsed.success) {
            console.warn(
              `Evento fora do contrato no canal ${CHANNELS.filesChanged}:`,
              parsed.error.issues,
            );
            return;
          }
          if (parsed.data.projectId === projectId) onChange();
        });
        void call<void>(CHANNELS.filesWatch, { projectId });
        return () => {
          stop();
          void call<void>(CHANNELS.filesUnwatch, { projectId });
        };
      },
    },
    git: {
      status: (input: GitProjectInput) => call<GitStatusDto>(CHANNELS.gitStatus, input),
      diff: (input: GitDiffInput) => call<GitFileDiffDto>(CHANNELS.gitDiff, input),
      stage: (input: GitPathsInput) => call<void>(CHANNELS.gitStage, input),
      unstage: (input: GitPathsInput) => call<void>(CHANNELS.gitUnstage, input),
      discard: (input: GitPathsInput) => call<void>(CHANNELS.gitDiscard, input),
      commit: (input: GitCommitInput) => call<GitCommitResultDto>(CHANNELS.gitCommit, input),
      push: (input: GitProjectInput) => call<GitPushResultDto>(CHANNELS.gitPush, input),
      publish: (input: GitProjectInput) => call<GitPushResultDto>(CHANNELS.gitPublish, input),
      pull: (input: GitProjectInput) => call<GitPullResultDto>(CHANNELS.gitPull, input),
      fetch: (input: GitProjectInput) => call<void>(CHANNELS.gitFetch, input),
      log: (input: GitProjectInput) => call<GitLogEntryDto[]>(CHANNELS.gitLog, input),
      branchChanges: (input: GitProjectInput) =>
        call<BranchChangesDto>(CHANNELS.gitBranchChanges, input),
    },
    github: {
      pr: (input: GithubProjectInput) => call<GithubPanelDto>(CHANNELS.githubPr, input),
      comment: (input: GithubCommentInput) => call<void>(CHANNELS.githubComment, input),
      merge: (input: GithubMergeInput) => call<void>(CHANNELS.githubMerge, input),
      openUrl: (url: string) => call<void>(CHANNELS.githubOpenUrl, { url }),
    },
    accounts: {
      list: () => call<AccountsDto>(CHANNELS.accountsList),
      add: (input: AddAccountInput) => call<AccountDto>(CHANNELS.accountsAdd, input),
      rename: (input: RenameAccountInput) => call<void>(CHANNELS.accountsRename, input),
      setDefault: (input: AccountTargetInput) => call<void>(CHANNELS.accountsSetDefault, input),
      disconnect: (input: AccountTargetInput) => call<void>(CHANNELS.accountsDisconnect, input),
      remove: (input: RemoveAccountInput) => call<void>(CHANNELS.accountsRemove, input),
      login: {
        start: (input: AccountTargetInput) => call<LoginDto>(CHANNELS.accountsLoginStart, input),
        get: () => call<LoginDto | null>(CHANNELS.accountsLoginGet),
        cancel: () => call<void>(CHANNELS.accountsLoginCancel),
        confirm: () => call<void>(CHANNELS.accountsLoginConfirm),
        reject: () => call<void>(CHANNELS.accountsLoginReject),
        openUrl: () => call<void>(CHANNELS.accountsLoginOpenUrl),
        copyUrl: () => call<void>(CHANNELS.accountsLoginCopyUrl),
        write: (data: string) => call<void>(CHANNELS.accountsLoginWrite, { data }),
        resize: (cols: number, rows: number) =>
          call<void>(CHANNELS.accountsLoginResize, { cols, rows }),
        subscribe: (listener: (event: LoginEvent) => void) =>
          subscribe(CHANNELS.accountsLoginEvent, (payload) => {
            const parsed = loginEventSchema.safeParse(payload);
            if (!parsed.success) {
              // Sem os detalhes: o evento pode levar a saída do login, que não vai para log.
              console.warn(`Evento fora do contrato no canal ${CHANNELS.accountsLoginEvent}.`);
              return;
            }
            listener(parsed.data);
          }),
      },
    },
    app: {
      info: () => call<AppInfoDto>(CHANNELS.appInfo),
      openDataFolder: () => call<void>(CHANNELS.appOpenDataFolder),
    },
    alerts: {
      notify: (input: AlertNotifyInput) => call<void>(CHANNELS.alertsNotify, input),
      onOpen: (listener: (event: AlertOpenEvent) => void) =>
        subscribe(CHANNELS.alertsOpen, (payload) => {
          const parsed = alertOpenEventSchema.safeParse(payload);
          if (!parsed.success) {
            console.warn(
              `Evento fora do contrato no canal ${CHANNELS.alertsOpen}:`,
              parsed.error.issues,
            );
            return;
          }
          listener(parsed.data);
        }),
    },
    approvals: {
      decide: (input: DecideApprovalInput) => call<void>(CHANNELS.approvalsDecide, input),
    },
  };
}
