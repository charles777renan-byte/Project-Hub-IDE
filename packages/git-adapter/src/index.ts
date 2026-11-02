export { createGitDetector } from './detect';
export {
  getWorktreeDiff,
  type WorktreeDiff,
  type WorktreeDiffFile,
  type WorktreeDiffOptions,
  type WorktreeFileStatus,
} from './diff';
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
