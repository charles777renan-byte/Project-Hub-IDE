import type { AppResult } from '@project-hub/contracts';
import type { Mission } from '@project-hub/domain';
import type { MissionRepository } from '../ports';
import { failure } from '../result';
import {
  ACCOUNT_UNAVAILABLE,
  missionAccountOf,
  withMissionAccount,
  type MissionAccountDeps,
  type MissionAccountView,
} from './mission-account';

export { ACCOUNT_UNAVAILABLE };

export const ACCOUNT_LOCKED =
  'A conta só pode ser trocada antes de a missão começar, ou depois de ela falhar ou ser cancelada.';

export type SetMissionAccountDeps = MissionAccountDeps & {
  repo: Pick<MissionRepository, 'getMission' | 'setMissionAccount'>;
  now: () => string;
};

/**
 * Troca a conta do Claude Code de uma missão (`null` é a Principal). Vale antes de a missão começar e fora do
 * planejamento, e de novo quando a missão falhou ou foi cancelada: a nova tentativa abre outra execução. Conta removida ou desconhecida é recusada,
 * e a missão fica como estava.
 */
export function setMissionAccount(
  deps: SetMissionAccountDeps,
  input: { missionId: string; accountId: string | null },
): AppResult<Mission & MissionAccountView> {
  const mission = deps.repo.getMission(input.missionId);
  if (mission === undefined) return failure('MISSION_NOT_FOUND', 'A missão não foi encontrada.');
  if (missionAccountOf(deps, mission).accountLocked) {
    return failure('VALIDATION_FAILED', ACCOUNT_LOCKED);
  }
  if (input.accountId !== null && deps.accounts.labelOf('claude', input.accountId).removed) {
    return failure('VALIDATION_FAILED', ACCOUNT_UNAVAILABLE);
  }
  deps.repo.setMissionAccount(input.missionId, input.accountId, deps.now());
  const updated = deps.repo.getMission(input.missionId) ?? mission;
  return { ok: true, data: withMissionAccount(deps, updated) };
}
