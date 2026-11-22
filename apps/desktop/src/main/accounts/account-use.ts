import { claudeConfigDirOf, codexHomeOf } from '@project-hub/agent-adapters';
import { failure } from '@project-hub/application';
import {
  ACCOUNT_PROVIDERS,
  accountIdSchema,
  type AccountKind,
  type AccountProviderId,
  type AppResult,
} from '@project-hub/contracts';
import type { AccountRepository, AppSettingsRepository } from '@project-hub/database';
import type { AccountPaths } from './account-paths';
import type { AccountVault } from './account-vault';
import { API_KEY_VARIABLE, isApiKeyProvider } from './api-key-shape';
import { DEFAULT_ACCOUNT_KEY, PRINCIPAL_NAME } from './accounts-service';

/** A frase de toda abertura que pede uma conta que já não vale. Nunca vira "abrir na Principal". */
export const ACCOUNT_REMOVED = 'A conta foi removida.';

/**
 * A conta em uso: o que os painéis, as missões e os leitores precisam saber de uma conta. `null` é a Principal.
 * `launchEnv` é o ambiente de quem lança o programa (painel, agente da missão, planejador). Os leitores usam só
 * `dataRootOf`, a pasta de dados, e nunca recebem ambiente.
 */
export type AccountUse = {
  isAccountProvider(provider: string): provider is AccountProviderId;
  /** A conta padrão do programa. Sem a chave, ou com uma conta que já não vale: a Principal. */
  defaultOf(provider: AccountProviderId): string | null;
  /**
   * As variáveis extras do lançamento. Conta que não vale é falha, e nunca ambiente vazio. Conta API: a pasta e a
   * variável da chave, lida do cofre a cada chamada; cofre trancado falha com o código `VAULT_LOCKED`.
   */
  launchEnv(
    provider: AccountProviderId,
    accountId: string | null,
  ): Promise<AppResult<Record<string, string>>>;
  /** O tipo da conta. A Principal e a desconhecida são de assinatura. */
  kindOf(provider: AccountProviderId, accountId: string | null): AccountKind;
  /**
   * A conta espera a senha do cofre: é API, tem a chave guardada e o cofre está trancado. Sem chave, ou com uma que
   * não abre, não espera: pedir a senha não resolveria.
   */
  waitsForVault(provider: AccountProviderId, accountId: string | null): boolean;
  /** Dá para abrir agora: assinatura que existe, ou conta API com a chave guardada e o cofre aberto. */
  usableOf(provider: AccountProviderId, accountId: string | null): boolean;
  /** A pasta de dados do programa nessa conta. Conta que não vale: `undefined`. */
  dataRootOf(provider: AccountProviderId, accountId: string | null): string | undefined;
  /** O nome para mostrar. Conta removida mantém o nome gravado; a desconhecida fica sem nome. */
  labelOf(
    provider: AccountProviderId,
    accountId: string | null,
  ): { name: string; removed: boolean };
  /** A Principal e as extras que existem, com a pasta de cada uma. */
  listRoots(provider: AccountProviderId): { accountId: string | null; root: string }[];
  /** O programa tem conta além da Principal: só aí a tela mostra de qual conta é cada coisa. */
  hasExtras(provider: AccountProviderId): boolean;
};

export type AccountUseDeps = {
  accounts: Pick<AccountRepository, 'get' | 'list'>;
  settings: Pick<AppSettingsRepository, 'get'>;
  paths: Pick<AccountPaths, 'envOf' | 'folderOf'>;
  vault: Pick<AccountVault, 'check' | 'reveal'>;
  /** O ambiente filtrado que os terminais recebem: é dele que sai a pasta da Principal. */
  env: Readonly<Record<string, string | undefined>>;
};

export function createAccountUse(deps: AccountUseDeps): AccountUse {
  const { accounts, settings, paths } = deps;

  /** A conta extra que existe, não foi removida e é deste programa. */
  function live(provider: AccountProviderId, accountId: string) {
    if (!accountIdSchema.safeParse(accountId).success) return undefined;
    const record = accounts.get(accountId);
    if (!record || record.removedAt !== undefined || record.provider !== provider) return undefined;
    return record;
  }

  function principalRoot(provider: AccountProviderId): string {
    return provider === 'claude' ? claudeConfigDirOf(deps.env) : codexHomeOf(deps.env);
  }

  return {
    isAccountProvider(provider): provider is AccountProviderId {
      return (ACCOUNT_PROVIDERS as readonly string[]).includes(provider);
    },

    defaultOf(provider) {
      const stored = settings.get(DEFAULT_ACCOUNT_KEY(provider));
      if (stored === undefined) return null;
      const record = live(provider, stored);
      if (record === undefined) return null;
      // Conta API sem chave não abre nada: a padrão volta à Principal. Trancada continua a padrão (pede a senha).
      if (record.kind === 'api' && deps.vault.check(record.id) === 'missing') return null;
      return stored;
    },

    // Assíncrono de propósito: quem lança espera, e a chave só existe dentro desta chamada.
    async launchEnv(provider, accountId) {
      const env = paths.envOf(provider, accountId);
      if (!env.ok) return failure('VALIDATION_FAILED', ACCOUNT_REMOVED);
      if (accountId === null) return env;
      const record = live(provider, accountId);
      if (record === undefined) return failure('VALIDATION_FAILED', ACCOUNT_REMOVED);
      if (record.kind !== 'api') return env;
      if (!isApiKeyProvider(provider)) return failure('VALIDATION_FAILED', ACCOUNT_REMOVED);
      // O único lugar do processo principal que pede a chave em claro ao cofre.
      const key = deps.vault.reveal(record.id);
      if (!key.ok) return key;
      return { ok: true, data: { ...env.data, [API_KEY_VARIABLE[provider]]: key.data } };
    },

    kindOf(provider, accountId) {
      if (accountId === null) return 'subscription';
      return live(provider, accountId)?.kind ?? 'subscription';
    },

    waitsForVault(provider, accountId) {
      if (accountId === null) return false;
      const record = live(provider, accountId);
      return record?.kind === 'api' && deps.vault.check(record.id) === 'locked';
    },

    usableOf(provider, accountId) {
      if (accountId === null) return true;
      const record = live(provider, accountId);
      if (record === undefined) return false;
      return record.kind !== 'api' || deps.vault.check(record.id) === 'stored';
    },

    dataRootOf(provider, accountId) {
      if (accountId === null) return principalRoot(provider);
      return live(provider, accountId) === undefined
        ? undefined
        : paths.folderOf(provider, accountId);
    },

    labelOf(provider, accountId) {
      if (accountId === null) return { name: PRINCIPAL_NAME, removed: false };
      const record = accountIdSchema.safeParse(accountId).success
        ? accounts.get(accountId)
        : undefined;
      if (!record || record.provider !== provider) return { name: '', removed: true };
      return { name: record.name, removed: record.removedAt !== undefined };
    },

    listRoots(provider) {
      return [
        { accountId: null, root: principalRoot(provider) },
        ...accounts
          .list(provider)
          .map((record) => ({ accountId: record.id, root: paths.folderOf(provider, record.id) })),
      ];
    },

    hasExtras(provider) {
      return accounts.list(provider).length > 0;
    },
  };
}
