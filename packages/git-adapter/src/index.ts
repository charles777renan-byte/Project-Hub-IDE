export { createGitDetector } from './detect';
export { createRepositoryInitializer } from './init-repository';
export { createGitPanelPort } from './git-panel-port';
export {
  getWorktreeDiff,
  type WorktreeDiff,
  type WorktreeDiffFile,
  type WorktreeDiffOptions,
  type WorktreeFileStatus,
} from './diff';
export {
  commitStaged,
  discardPaths,
  fetchOrigin,
  pullFastForward,
  pushBranch,
  stagePaths,
  unstagePaths,
  type WriteOptions,
} from './git-write';
export {
  getBranchChanges,
  getBranchLog,
  getFileDiffAgainstHead,
  getGitPanelStatus,
  type BranchChangeFile,
  type BranchChanges,
  type BranchChangeStatus,
  type BranchLogEntry,
  type FileDiffAgainstBase,
  type GitPanelStatus,
  type PanelFile,
  type ReadOptions,
  type StagedState,
  type UnstagedState,
} from './git-read';
export { isStrictlyInside } from './path-scope';
export { GitError, runGit, type RunGitOptions } from './run-git';
export { getStatus, type GitStatus } from './status';
export { createWorktree, removeWorktree, type CreatedWorktree } from './worktree';
export {
  copyWorktreeIncludes,
  parseWorktreeInclude,
  WORKTREE_INCLUDE_FILE,
  WORKTREE_INCLUDE_MAX_BYTES,
  WORKTREE_INCLUDE_MAX_ENTRIES,
  type WorktreeIncludeResult,
  type WorktreeIncludeSkip,
  type WorktreeIncludeSkipReason,
} from './worktree-include';
export { buildWorktreeNames, type WorktreeNames } from './worktree-naming';
