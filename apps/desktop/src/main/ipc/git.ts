import {
  commitChanges,
  discardPaths,
  fetchProject,
  getFileDiff,
  getGitStatus,
  getProjectBranchChanges,
  getProjectBranchLog,
  publishProjectBranch,
  pullProject,
  pushProjectBranch,
  stagePaths,
  unstagePaths,
  type GitPanelDeps,
} from '@project-hub/application';
import {
  CHANNELS,
  gitCommitInputSchema,
  gitDiffInputSchema,
  gitPathsInputSchema,
  gitProjectInputSchema,
} from '@project-hub/contracts';
import {
  registerTrustedHandler,
  validated,
  type IpcRegistry,
  type SenderCheck,
} from './trusted-handler';

/**
 * Liga os doze canais `git:*:v1` do painel de código-fonte (ADR 0010). Todos recusam remetente de outra
 * origem (R65) e conferem a entrada com zod antes de chamar o caso de uso. Os handlers não montam comando
 * Git: só chamam a aplicação, que passa pela porta e pelo adaptador. `GitError` e qualquer outro erro são
 * convertidos pelo `registerTrustedHandler`, e só o código e a mensagem chegam ao renderer.
 */
export function registerGitHandlers(
  registry: IpcRegistry,
  isTrusted: SenderCheck,
  deps: GitPanelDeps,
): void {
  const register = (channel: string, run: ReturnType<typeof validated>) =>
    registerTrustedHandler(registry, channel, isTrusted, run);

  register(
    CHANNELS.gitStatus,
    validated(gitProjectInputSchema, (input) => getGitStatus(deps, input)),
  );
  register(
    CHANNELS.gitDiff,
    validated(gitDiffInputSchema, (input) => getFileDiff(deps, input)),
  );
  register(
    CHANNELS.gitStage,
    validated(gitPathsInputSchema, (input) => stagePaths(deps, input)),
  );
  register(
    CHANNELS.gitUnstage,
    validated(gitPathsInputSchema, (input) => unstagePaths(deps, input)),
  );
  register(
    CHANNELS.gitDiscard,
    validated(gitPathsInputSchema, (input) => discardPaths(deps, input)),
  );
  register(
    CHANNELS.gitCommit,
    validated(gitCommitInputSchema, (input) => commitChanges(deps, input)),
  );
  register(
    CHANNELS.gitPush,
    validated(gitProjectInputSchema, (input) => pushProjectBranch(deps, input)),
  );
  register(
    CHANNELS.gitPublish,
    validated(gitProjectInputSchema, (input) => publishProjectBranch(deps, input)),
  );
  register(
    CHANNELS.gitPull,
    validated(gitProjectInputSchema, (input) => pullProject(deps, input)),
  );
  register(
    CHANNELS.gitFetch,
    validated(gitProjectInputSchema, (input) => fetchProject(deps, input)),
  );
  register(
    CHANNELS.gitLog,
    validated(gitProjectInputSchema, (input) => getProjectBranchLog(deps, input)),
  );
  register(
    CHANNELS.gitBranchChanges,
    validated(gitProjectInputSchema, (input) => getProjectBranchChanges(deps, input)),
  );
}
