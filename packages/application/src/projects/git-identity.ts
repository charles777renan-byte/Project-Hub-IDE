import type { GitIdentity } from '@project-hub/contracts';
import type { SettingsRepository } from '../ports';
import { DISPLAY_NAME_KEY } from '../profile/profile';

/** Chaves das configurações que guardam o autor que a pessoa confirmou no último repositório criado. */
export const GIT_IDENTITY_NAME_KEY = 'git.identidade.nome';
export const GIT_IDENTITY_EMAIL_KEY = 'git.identidade.email';

/** Domínio do e-mail proposto. `.local` não existe na internet: o endereço não é caixa de correio de ninguém. */
const LOCAL_EMAIL_DOMAIN = 'project-hub.local';
const FALLBACK_NAME = 'Usuário';
const FALLBACK_EMAIL_USER = 'usuario';
const NAME_MAX_LENGTH = 100;

export type GitIdentityDeps = {
  settings: SettingsRepository;
  /** Nome do usuário no sistema operacional, ou vazio quando o sistema não diz. */
  osUserName: () => string;
};

/** Tira o que o Git não aceita num nome de autor: `<`, `>`, caracteres de controle e o `-` na frente. */
function cleanName(value: string | undefined): string {
  return (value ?? '')
    .replace(/[<>\p{Cc}]/gu, '')
    .trim()
    .replace(/^-+/u, '')
    .trim()
    .slice(0, NAME_MAX_LENGTH);
}

/** A parte antes do `@`: o usuário do sistema em minúsculas, sem acento, só com letras, números, `.` e `-`. */
function emailUser(osUserName: string): string {
  const slug = osUserName
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9.]+/gu, '-')
    .replace(/^[-.]+|[-.]+$/gu, '');
  return slug === '' ? FALLBACK_EMAIL_USER : slug;
}

/**
 * O autor que o aplicativo propõe para o primeiro commit quando o Git não tem identidade. Vem do que a pessoa
 * confirmou da última vez; sem isso, do nome do perfil local (ou do usuário do sistema) e de um e-mail local.
 * É só uma proposta: a confirmação a mostra, e a pessoa pode trocá-la antes de criar o repositório.
 */
export function suggestGitIdentity(deps: GitIdentityDeps): GitIdentity {
  const rememberedName = deps.settings.get(GIT_IDENTITY_NAME_KEY);
  const rememberedEmail = deps.settings.get(GIT_IDENTITY_EMAIL_KEY);
  if (rememberedName !== undefined && rememberedEmail !== undefined) {
    return { name: rememberedName, email: rememberedEmail };
  }
  const osUserName = deps.osUserName();
  const name =
    [cleanName(deps.settings.get(DISPLAY_NAME_KEY)), cleanName(osUserName)].find(
      (candidate) => candidate !== '',
    ) ?? FALLBACK_NAME;
  return { name, email: `${emailUser(osUserName)}@${LOCAL_EMAIL_DOMAIN}` };
}

/** Guarda o autor confirmado, para a próxima proposta repetir o que a pessoa escolheu. */
export function rememberGitIdentity(
  deps: Pick<GitIdentityDeps, 'settings'>,
  identity: GitIdentity,
  now: string,
): void {
  deps.settings.set(GIT_IDENTITY_NAME_KEY, identity.name, now);
  deps.settings.set(GIT_IDENTITY_EMAIL_KEY, identity.email, now);
}
