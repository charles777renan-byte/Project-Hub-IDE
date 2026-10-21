export { createGitDetector } from './detect';
export {
  getWorktreeDiff,
  type WorktreeDiff,
  type WorktreeDiffFile,
  type WorktreeDiffOptions,
  type WorktreeFileStatus,
} from './diff';
export { GitError, runGit, type RunGitOptions } from './run-git';
export { getStatus, type GitStatus } from './status';
export { createWorktree, removeWorktree, type CreatedWorktree } from './worktree';
export { buildWorktreeNames, type WorktreeNames } from './worktree-naming';
