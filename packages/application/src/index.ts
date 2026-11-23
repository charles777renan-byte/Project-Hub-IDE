export { addProject, type AddProjectDeps } from './projects/add-project';
export {
  archiveProject,
  listArchivedProjects,
  removeProject,
  unarchiveProject,
  type ProjectLifecycleDeps,
  setProjectGroup,
  setProjectMuted,
  setProjectNickname,
} from './projects/project-lifecycle';
export { listProjects, toProjectSummary, type ListProjectsDeps } from './projects/list-projects';
export {
  initProjectRepository,
  previewRepositoryInit,
  type InitRepositoryDeps,
} from './projects/init-repository';
export {
  GIT_IDENTITY_EMAIL_KEY,
  GIT_IDENTITY_NAME_KEY,
  suggestGitIdentity,
  type GitIdentityDeps,
} from './projects/git-identity';
export { normalizePath, type Platform } from './projects/normalize-path';
export { getGitStatus } from './git-panel/status';
export { getFileDiff } from './git-panel/diff';
export { discardPaths, stagePaths, unstagePaths } from './git-panel/files';
export {
  commitChanges,
  fetchProject,
  publishProjectBranch,
  pullProject,
  pushProjectBranch,
} from './git-panel/write';
export { getProjectBranchLog } from './git-panel/log';
export { getProjectBranchChanges } from './git-panel/branch-changes';
export type { GitPanelDeps } from './git-panel/project';
export { getPullRequestPanel } from './github-panel/pull-request';
export { addPullRequestComment } from './github-panel/comment';
export { mergeProjectPullRequest } from './github-panel/merge';
export type { GithubPanelDeps } from './github-panel/project';
export type { GithubPanelPort } from './github-panel/port';
export {
  createOrchestrator,
  type MissionPlan,
  type Orchestrator,
  type OrchestratorDeps,
} from './missions/orchestrator';
export { planFromCriteria, type MissionPlanStep } from './missions/plan';
export { applyPlanEdit, type PlanEdit } from './missions/plan-edit';
export {
  MAX_PLAN_TASKS,
  tasksToSteps,
  validatePlan,
  type PlannedTask,
} from './missions/plan-validation';
export {
  createMission,
  type CreateMissionDeps,
  type CreateMissionInput,
} from './missions/create-mission';
export {
  ACCOUNT_UNAVAILABLE,
  missionAccountOf,
  withMissionAccount,
  type MissionAccountDeps,
  type MissionAccountView,
} from './missions/mission-account';
export {
  ACCOUNT_LOCKED,
  setMissionAccount,
  type SetMissionAccountDeps,
} from './missions/set-mission-account';
export {
  PROFILE_LOCKED,
  PROFILE_UNAVAILABLE,
  setMissionProfile,
  type SetMissionProfileDeps,
} from './missions/set-mission-profile';
export {
  getMissionDiff,
  getMissionView,
  listMissions,
  type MissionDiffDeps,
  type MissionEvent,
  type MissionProject,
  type MissionQueryDeps,
  type MissionView,
} from './missions/mission-queries';
export { deleteMission, type DeleteMissionDeps } from './missions/delete-mission';
export { recoverInterruptedExecutions } from './missions/startup-recovery';
export { DISPLAY_NAME_KEY, getProfile, setDisplayName, type ProfileDeps } from './profile/profile';
export type {
  AccountDirectory,
  ProfileDirectory,
  AccountPick,
  AccountSwitchNotice,
  ApprovalChanges,
  DiffPort,
  ExecutionChanges,
  FileSystemPort,
  GitDetector,
  GitPanelPort,
  MissionChanges,
  MissionRepository,
  Planner,
  ProjectRepository,
  RepositoryInitializer,
  SettingsRepository,
  TerminalErrorCode,
  TerminalExit,
  TerminalOpenInput,
  TerminalPort,
  TerminalSnapshot,
  TerminalSubscriber,
  WorktreeNames,
  WorktreePort,
} from './ports';
export { TerminalPortError } from './ports';
export { failure } from './result';
export {
  listWorktrees,
  removeMissionWorktree,
  type ListWorktreesDeps,
  type RemoveWorktreeDeps,
} from './worktrees/worktrees';
