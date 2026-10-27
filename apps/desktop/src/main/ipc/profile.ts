import { failure, getProfile, setDisplayName, type ProfileDeps } from '@project-hub/application';
import {
  CHANNELS,
  setDisplayNameInputSchema,
  type AppResult,
  type ProfileDto,
} from '@project-hub/contracts';
import { registerTrustedHandler, type IpcRegistry, type SenderCheck } from './trusted-handler';

/** Lê o perfil local. Não recebe parâmetro. */
export function handleGetProfile(deps: ProfileDeps): AppResult<ProfileDto> {
  return getProfile(deps);
}

/**
 * Guarda o nome da saudação. A entrada é conferida aqui (R28); o limite e o texto aparado, na aplicação.
 * Nome longo demais tem mensagem própria.
 */
export function handleSetDisplayName(deps: ProfileDeps, payload: unknown): AppResult<undefined> {
  const input = setDisplayNameInputSchema.safeParse(payload);
  if (!input.success) {
    const tooLong = input.error.issues.some((issue) => issue.code === 'too_big');
    return failure(
      'VALIDATION_FAILED',
      tooLong ? 'O nome pode ter até 40 caracteres.' : 'Informe um nome válido.',
    );
  }
  return setDisplayName(deps, input.data);
}

/** Liga os canais do perfil local. Ambos recusam remetente de outra origem (R65). */
export function registerProfileHandlers(
  registry: IpcRegistry,
  isTrusted: SenderCheck,
  deps: ProfileDeps,
): void {
  registerTrustedHandler(registry, CHANNELS.profileGet, isTrusted, () =>
    Promise.resolve(handleGetProfile(deps)),
  );
  registerTrustedHandler(registry, CHANNELS.profileSetDisplayName, isTrusted, (_event, payload) =>
    Promise.resolve(handleSetDisplayName(deps, payload)),
  );
}
