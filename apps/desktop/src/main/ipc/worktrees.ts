import {
  failure,
  listWorktrees,
  removeMissionWorktree,
  type ListWorktreesDeps,
  type RemoveWorktreeDeps,
} from '@project-hub/application';
import {
  CHANNELS,
  listWorktreesInputSchema,
  removeWorktreeInputSchema,
} from '@project-hub/contracts';
import { registerTrustedHandler, type IpcRegistry, type SenderCheck } from './trusted-handler';

/** O que os canais de worktree precisam: a lista derivada das missões e a remoção protegida. */
export type WorktreesIpcDeps = { list: ListWorktreesDeps; remove: RemoveWorktreeDeps };

const INVALID_PROJECT = 'Informe o projeto.';
const INVALID_MISSION = 'Informe a missão.';

/** Worktrees do projeto. A entrada é conferida antes de qualquer leitura. */
export function handleListWorktrees(deps: ListWorktreesDeps, payload: unknown) {
  const input = listWorktreesInputSchema.safeParse(payload);
  if (!input.success) return Promise.resolve(failure('VALIDATION_FAILED', INVALID_PROJECT));
  return listWorktrees(deps, input.data.projectId);
}

/**
 * Remove o worktree de uma missão encerrada. O renderer manda só o id da missão: o caminho sai do
 * banco, e nunca de um valor que o renderer escolhe (R66).
 */
export function handleRemoveWorktree(deps: RemoveWorktreeDeps, payload: unknown) {
  const input = removeWorktreeInputSchema.safeParse(payload);
  if (!input.success) return Promise.resolve(failure('VALIDATION_FAILED', INVALID_MISSION));
  return removeMissionWorktree(deps, input.data.missionId);
}

/** Liga os dois canais de worktree. Ambos recusam remetente de outra origem (R65). */
export function registerWorktreeHandlers(
  registry: IpcRegistry,
  isTrusted: SenderCheck,
  deps: WorktreesIpcDeps,
): void {
  registerTrustedHandler(registry, CHANNELS.worktreesList, isTrusted, (_event, payload) =>
    handleListWorktrees(deps.list, payload),
  );
  registerTrustedHandler(registry, CHANNELS.worktreesRemove, isTrusted, (_event, payload) =>
    handleRemoveWorktree(deps.remove, payload),
  );
}
