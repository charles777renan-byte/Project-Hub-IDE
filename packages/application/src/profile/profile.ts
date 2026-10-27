import type { AppResult, ProfileDto } from '@project-hub/contracts';
import type { SettingsRepository } from '../ports';
import { failure } from '../result';

/** Chave da configuração que guarda o nome da saudação. */
export const DISPLAY_NAME_KEY = 'perfil.nome';

const DISPLAY_NAME_MAX_LENGTH = 40;

export type ProfileDeps = {
  settings: SettingsRepository;
  now: () => string;
};

/** O perfil local: hoje, só o nome da saudação. Não há conta nem servidor. */
export function getProfile(deps: Pick<ProfileDeps, 'settings'>): AppResult<ProfileDto> {
  return { ok: true, data: { displayName: deps.settings.get(DISPLAY_NAME_KEY) ?? null } };
}

/**
 * Guarda o nome da saudação. O texto é aparado e tem no máximo 40 caracteres. `null` ou texto vazio tira o
 * nome, e a saudação volta a sair sem ele.
 */
export function setDisplayName(
  deps: ProfileDeps,
  input: { name: string | null },
): AppResult<undefined> {
  const name = input.name === null ? '' : input.name.trim();
  if (name.length > DISPLAY_NAME_MAX_LENGTH) {
    return failure('VALIDATION_FAILED', 'O nome pode ter até 40 caracteres.');
  }
  if (name === '') deps.settings.remove(DISPLAY_NAME_KEY);
  else deps.settings.set(DISPLAY_NAME_KEY, name, deps.now());
  return { ok: true, data: undefined };
}
