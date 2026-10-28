export { addProject, type AddProjectDeps } from './projects/add-project';
export {
  archiveProject,
  listArchivedProjects,
  removeProject,
  unarchiveProject,
  type ProjectLifecycleDeps,
  setProjectGroup,
  setProjectNickname,
} from './projects/project-lifecycle';
export { listProjects, toProjectSummary, type ListProjectsDeps } from './projects/list-projects';
export { normalizePath, type Platform } from './projects/normalize-path';
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
  ApprovalChanges,
  DiffPort,
  ExecutionChanges,
  FileSystemPort,
  GitDetector,
  MissionChanges,
  MissionRepository,
  Planner,
  ProjectRepository,
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
