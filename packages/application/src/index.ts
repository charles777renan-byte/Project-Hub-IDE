export { addProject, type AddProjectDeps } from './projects/add-project';
export { listProjects, toProjectSummary, type ListProjectsDeps } from './projects/list-projects';
export { normalizePath, type Platform } from './projects/normalize-path';
export {
  createOrchestrator,
  type MissionPlan,
  type Orchestrator,
  type OrchestratorDeps,
} from './missions/orchestrator';
export { planFromCriteria, type MissionPlanStep } from './missions/plan';
export { recoverInterruptedExecutions } from './missions/startup-recovery';
export type {
  ApprovalChanges,
  ExecutionChanges,
  FileSystemPort,
  GitDetector,
  MissionChanges,
  MissionRepository,
  ProjectRepository,
  WorktreeNames,
  WorktreePort,
} from './ports';
export { failure } from './result';
