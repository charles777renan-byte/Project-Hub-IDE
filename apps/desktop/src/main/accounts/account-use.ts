import { claudeConfigDirOf, codexHomeOf } from '@project-hub/agent-adapters';
import { failure } from '@project-hub/application';
import {
  ACCOUNT_PROVIDERS,
  accountIdSchema,
  type AccountProviderId,
  type AppResult,
} from '@project-hub/contracts';
import type { AccountRepository, AppSettingsRepository } from '@project-hub/database';
import type { AccountPaths } from './account-paths';
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
  /** As variáveis extras do lançamento. Conta que não vale é falha, e nunca ambiente vazio. */
  launchEnv(
    provider: AccountProviderId,
    accountId: string | null,
  ): AppResult<Record<string, string>>;
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
      return stored !== undefined && live(provider, stored) !== undefined ? stored : null;
    },

    launchEnv(provider, accountId) {
      const env = paths.envOf(provider, accountId);
      return env.ok ? env : failure('VALIDATION_FAILED', ACCOUNT_REMOVED);
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
