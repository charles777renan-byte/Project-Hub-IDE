import type { AppResult } from '@project-hub/contracts';
import { DEFAULT_EXECUTION_PROFILE_ID, type Mission } from '@project-hub/domain';
import type { MissionRepository, ProfileDirectory } from '../ports';
import { failure } from '../result';
import {
  missionAccountOf,
  withMissionAccount,
  type MissionAccountDeps,
  type MissionAccountView,
} from './mission-account';

export const PROFILE_UNAVAILABLE = 'O perfil foi removido.';

export const PROFILE_LOCKED =
  'O perfil só pode ser trocado antes de a missão começar, ou depois de ela falhar ou ser cancelada.';

export type SetMissionProfileDeps = MissionAccountDeps & {
  repo: Pick<MissionRepository, 'getMission' | 'setMissionProfile'>;
  profiles: Pick<ProfileDirectory, 'get'>;
  now: () => string;
};

/**
 * Troca o perfil de execução de uma missão. Vale com a mesma trava da conta: antes de a missão começar e fora do
 * planejamento, e de novo quando ela falhou ou foi cancelada. O perfil embutido sempre vale; o que não existe é
 * recusado, e a missão fica como estava.
 */
export function setMissionProfile(
  deps: SetMissionProfileDeps,
  input: { missionId: string; profileId: string },
): AppResult<Mission & MissionAccountView> {
  const mission = deps.repo.getMission(input.missionId);
  if (mission === undefined) return failure('MISSION_NOT_FOUND', 'A missão não foi encontrada.');
  if (missionAccountOf(deps, mission).accountLocked) {
    return failure('VALIDATION_FAILED', PROFILE_LOCKED);
  }
  if (
    input.profileId !== DEFAULT_EXECUTION_PROFILE_ID &&
    deps.profiles.get(input.profileId) === undefined
  ) {
    return failure('VALIDATION_FAILED', PROFILE_UNAVAILABLE);
  }
  deps.repo.setMissionProfile(input.missionId, input.profileId, deps.now());
  const updated = deps.repo.getMission(input.missionId) ?? mission;
  return { ok: true, data: withMissionAccount(deps, updated) };
}
