import {
  commitChanges,
  discardPaths,
  failure,
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
  type AppResult,
  type GitPushResultDto,
} from '@project-hub/contracts';
import type { ZodType } from 'zod';
import { registerTrustedHandler, type IpcRegistry, type SenderCheck } from './trusted-handler';

const INVALID_INPUT = 'Os dados do pedido não são válidos.';

/**
 * Confere a entrada com o schema do contrato (R28) e só então roda o caso de uso. Entrada inválida volta como
 * `VALIDATION_FAILED`, sem tocar no projeto nem no Git. O que o schema não declara (como um nome de branch)
 * é descartado pelo `parse`: o caso de uso só recebe o que o contrato permite.
 */
function validated<T>(
  schema: ZodType<T>,
  run: (input: T) => Promise<AppResult<unknown>>,
): (_event: unknown, payload: unknown) => Promise<AppResult<unknown>> {
  return (_event, payload) => {
    const input = schema.safeParse(payload);
    if (!input.success) return Promise.resolve(failure('VALIDATION_FAILED', INVALID_INPUT));
    return run(input.data);
  };
}

/**
 * `git:push:v1` serve para enviar e para publicar: o renderer não escolhe. O caso de uso de envio exige
 * upstream, e o de publicação exige a ausência dele, então o processo principal lê o estado e despacha. Sem
 * upstream (inclusive o HEAD destacado, que o caso de uso recusa com GIT_DETACHED_HEAD) vale a publicação.
 * Qualquer falha da leitura sobe como veio.
 */
async function sendBranch(
  deps: GitPanelDeps,
  input: { projectId: string },
): Promise<AppResult<GitPushResultDto>> {
  const status = await getGitStatus(deps, input);
  if (!status.ok) return status;
  return status.data.upstream === null
    ? publishProjectBranch(deps, input)
    : pushProjectBranch(deps, input);
}

/**
 * Liga os onze canais `git:*:v1` do painel de código-fonte (ADR 0010). Todos recusam remetente de outra
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

  register(CHANNELS.gitStatus, validated(gitProjectInputSchema, (input) => getGitStatus(deps, input)));
  register(CHANNELS.gitDiff, validated(gitDiffInputSchema, (input) => getFileDiff(deps, input)));
  register(CHANNELS.gitStage, validated(gitPathsInputSchema, (input) => stagePaths(deps, input)));
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
  register(CHANNELS.gitPush, validated(gitProjectInputSchema, (input) => sendBranch(deps, input)));
  register(CHANNELS.gitPull, validated(gitProjectInputSchema, (input) => pullProject(deps, input)));
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
