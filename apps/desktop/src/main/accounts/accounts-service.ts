import { failure } from '@project-hub/application';
import {
  ACCOUNT_PROVIDERS,
  PROVIDER_IDS,
  type AccountDto,
  type AccountProviderId,
  type AccountsDto,
  type AccountTargetInput,
  type AddAccountInput,
  type AppResult,
  type RemoveAccountInput,
  type RenameAccountInput,
  type SetAutoSwitchInput,
} from '@project-hub/contracts';
import type {
  AccountRecord,
  AccountRepository,
  AppSettingsRepository,
} from '@project-hub/database';
import type { ProviderRegistry } from '../providers';
import type { AccountCli, AccountStatus } from './account-cli';
import type { AccountPaths } from './account-paths';
import {
  AUTO_SWITCH_API_KEY,
  AUTO_SWITCH_KEY,
  autoSwitchSettingsOf,
  candidateOrder,
  preferredAccount,
  type CandidateFacts,
} from './account-switch';
import { VAULT_LOCKED, VAULT_UNAVAILABLE, type AccountVault } from './account-vault';
import { API_KEY_UNSUPPORTED, isApiKeyProvider } from './api-key-shape';

/** Chave de `app_settings` com o id da conta padrão do programa. Sem a chave, a padrão é a Principal. */
export const DEFAULT_ACCOUNT_KEY = (provider: AccountProviderId): string =>
  `accounts.default.${provider}`;

export const PRINCIPAL_NAME = 'Principal';

export type AccountsService = {
  list(): Promise<AppResult<AccountsDto>>;
  add(input: AddAccountInput): Promise<AppResult<AccountDto>>;
  rename(input: RenameAccountInput): Promise<AppResult<undefined>>;
  setDefault(input: AccountTargetInput): Promise<AppResult<undefined>>;
  disconnect(input: AccountTargetInput): Promise<AppResult<undefined>>;
  remove(input: RemoveAccountInput): Promise<AppResult<undefined>>;
  setAutoSwitch(input: SetAutoSwitchInput): Promise<AppResult<undefined>>;
};

export type AccountsServiceDeps = {
  accounts: AccountRepository;
  settings: AppSettingsRepository;
  paths: AccountPaths;
  cli: AccountCli;
  /** O cofre das chaves de API: só o estado de cada chave e os 4 últimos caracteres. Nunca a chave. */
  vault: Pick<AccountVault, 'status' | 'check' | 'last4Of' | 'remove'>;
  providers: ProviderRegistry;
  newId: () => string;
  now: () => string;
  /** Títulos dos painéis abertos com a conta. Enquanto houver algum, ela não é desconectada nem removida. */
  liveSessionsOf: (provider: AccountProviderId, accountId: string | null) => Promise<string[]>;
  /** Até quando o limite de uso da conta está esgotado (ISO); `undefined` se não está. */
  exhaustedUntil(provider: AccountProviderId, accountId: string | null): string | undefined;
};

const DONE: AppResult<undefined> = { ok: true, data: undefined };
const GONE = 'A conta não existe mais.';
const NEEDS_KEY = 'Cole a chave de API antes de tornar esta conta a padrão.';
const NEEDS_ANOTHER_ACCOUNT = 'Adicione outra conta para usar a troca automática.';
const NEEDS_AUTO_SWITCH = 'Ligue antes a troca de conta.';
const API_NOT_SIGNED_IN =
  'Conta por chave de API não tem login: para deixar de usá-la, remova a chave.';
/** O estado de uma conta API: o programa nunca é chamado para ela. */
const API_STATUS: AccountStatus = { state: 'unknown' };

function isAccountProvider(provider: string): provider is AccountProviderId {
  return (ACCOUNT_PROVIDERS as readonly string[]).includes(provider);
}

function sameName(a: string, b: string): boolean {
  return a.trim().toLocaleLowerCase('pt-BR') === b.trim().toLocaleLowerCase('pt-BR');
}

export function createAccountsService(deps: AccountsServiceDeps): AccountsService {
  const { accounts, settings, paths, cli, providers, vault } = deps;

  /** A conta extra que existe, não foi removida e é de um programa com várias contas. */
  function existing(
    accountId: string,
  ): (AccountRecord & { provider: AccountProviderId }) | undefined {
    const record = accounts.get(accountId);
    if (!record || record.removedAt !== undefined || !isAccountProvider(record.provider)) {
      return undefined;
    }
    return { ...record, provider: record.provider };
  }

  function nameProblem(
    provider: AccountProviderId,
    name: string,
    exceptId?: string,
  ): string | undefined {
    if (sameName(name, PRINCIPAL_NAME)) return `O nome "${PRINCIPAL_NAME}" é da conta da máquina.`;
    const taken = accounts
      .list(provider)
      .some((account) => account.id !== exceptId && sameName(account.name, name));
    return taken ? 'Já existe uma conta com este nome neste programa.' : undefined;
  }

  /** O estado da chave e os 4 últimos caracteres. Com o cofre trancado, nada é decifrado. */
  function keyOf(record: AccountRecord): Pick<AccountDto, 'keyState' | 'keyLast4'> {
    const keyState = vault.check(record.id);
    const last4 = keyState === 'missing' ? undefined : vault.last4Of(record.id);
    return { keyState, ...(last4 === undefined ? {} : { keyLast4: last4 }) };
  }

  function toDto(
    provider: AccountProviderId,
    record: AccountRecord | null,
    isDefault: boolean,
    status: AccountStatus,
    exhaustedUntil?: string,
  ): AccountDto {
    return {
      id: record?.id ?? null,
      provider,
      name: record?.name ?? PRINCIPAL_NAME,
      isPrincipal: record === null,
      isDefault,
      state: status.state,
      ...(status.identity === undefined ? {} : { identity: status.identity }),
      ...(status.organization === undefined ? {} : { organization: status.organization }),
      // A Principal é sempre de assinatura.
      kind: record?.kind ?? 'subscription',
      ...(record?.kind === 'api' ? keyOf(record) : {}),
      ...(exhaustedUntil === undefined ? {} : { exhaustedUntil }),
    };
  }

  async function busy(
    provider: AccountProviderId,
    accountId: string | null,
  ): Promise<AppResult<never> | undefined> {
    const live = await deps.liveSessionsOf(provider, accountId);
    if (live.length === 0) return undefined;
    return failure(
      'VALIDATION_FAILED',
      `Feche antes os painéis que usam esta conta: ${live.join(', ')}.`,
    );
  }

  function resetDefaultIf(provider: AccountProviderId, accountId: string | null): void {
    if (accountId !== null && settings.get(DEFAULT_ACCOUNT_KEY(provider)) === accountId) {
      settings.remove(DEFAULT_ACCOUNT_KEY(provider));
    }
  }

  return {
    async list() {
      const labels = new Map(providers.list().map((info) => [info.id, info.label]));
      const groups = await Promise.all(
        ACCOUNT_PROVIDERS.map(async (provider) => {
          const extras = accounts.list(provider);
          const stored = settings.get(DEFAULT_ACCOUNT_KEY(provider));
          const defaultId = extras.some((account) => account.id === stored) ? stored : undefined;
          const records: (AccountRecord | null)[] = [null, ...extras];
          const statuses = await Promise.all(
            records.map((record) =>
              record?.kind === 'api'
                ? Promise.resolve(API_STATUS)
                : cli.status(provider, record?.id ?? null),
            ),
          );
          const autoSwitch = autoSwitchSettingsOf(settings, provider);
          const facts = new Map<string | null, CandidateFacts>();
          const dtos = records.map((record, index) => {
            const accountId = record?.id ?? null;
            const status = statuses[index] ?? { state: 'unknown' };
            const exhaustedUntil = deps.exhaustedUntil(provider, accountId);
            const dto = toDto(
              provider,
              record,
              record === null ? defaultId === undefined : record.id === defaultId,
              status,
              exhaustedUntil,
            );
            facts.set(accountId, {
              accountId,
              removed: false,
              kind: dto.kind,
              ...(dto.keyState === undefined ? {} : { keyState: dto.keyState }),
              connected: status.state === 'connected',
              ...(exhaustedUntil === undefined ? {} : { exhaustedUntil }),
            });
            return dto;
          });
          const defaultRef = defaultId ?? null;
          return {
            provider,
            installed: providers.resolve(provider).ok,
            accounts: dtos,
            autoSwitch,
            preferredId: preferredAccount({
              defaultId: defaultRef,
              order: candidateOrder(
                defaultRef,
                extras.map((account) => account.id),
              ),
              facts,
              settings: autoSwitch,
            }),
          };
        }),
      );
      const others = PROVIDER_IDS.filter((id) => id !== 'shell' && !isAccountProvider(id)).map(
        (provider) => ({
          provider,
          label: labels.get(provider) ?? provider,
          installed: providers.resolve(provider).ok,
        }),
      );
      return { ok: true, data: { groups, others } };
    },

    setAutoSwitch(input) {
      const key =
        input.option === 'enabled' ? AUTO_SWITCH_KEY(input.provider) : AUTO_SWITCH_API_KEY;
      if (input.value) {
        // A Principal conta: com uma extra, já são duas.
        if (accounts.list(input.provider).length === 0) {
          return Promise.resolve(failure('VALIDATION_FAILED', NEEDS_ANOTHER_ACCOUNT));
        }
        if (input.option === 'includeApi') {
          if (!isApiKeyProvider(input.provider)) {
            return Promise.resolve(failure('VALIDATION_FAILED', API_KEY_ONLY_CLAUDE));
          }
          if (!autoSwitchSettingsOf(settings, input.provider).enabled) {
            return Promise.resolve(failure('VALIDATION_FAILED', NEEDS_AUTO_SWITCH));
          }
        }
      }
      settings.set(key, input.value ? 'true' : 'false', deps.now());
      return Promise.resolve(DONE);
    },

    async add(input) {
      if (input.kind === 'api') {
        if (!isApiKeyProvider(input.provider)) {
          return failure('VALIDATION_FAILED', API_KEY_UNSUPPORTED);
        }
        if (!vault.status().available) return failure('VALIDATION_FAILED', VAULT_UNAVAILABLE);
      }
      const problem = nameProblem(input.provider, input.name);
      if (problem !== undefined) return failure('VALIDATION_FAILED', problem);
      const record: AccountRecord = {
        id: deps.newId(),
        provider: input.provider,
        name: input.name.trim(),
        createdAt: deps.now(),
        kind: input.kind,
      };
      accounts.insert(record);
      try {
        await paths.ensureFolder(input.provider, record.id);
      } catch {
        accounts.markRemoved(record.id, deps.now());
        return failure('UNKNOWN', 'Não foi possível criar a pasta da conta.');
      }
      const initial: AccountStatus = record.kind === 'api' ? API_STATUS : { state: 'signed-out' };
      return { ok: true, data: toDto(input.provider, record, false, initial) };
    },

    rename(input) {
      const record = existing(input.accountId);
      if (!record) return Promise.resolve(failure('VALIDATION_FAILED', GONE));
      const problem = nameProblem(record.provider, input.name, record.id);
      if (problem !== undefined) return Promise.resolve(failure('VALIDATION_FAILED', problem));
      accounts.rename(record.id, input.name.trim());
      return Promise.resolve(DONE);
    },

    async setDefault(input) {
      if (input.accountId === null) {
        settings.remove(DEFAULT_ACCOUNT_KEY(input.provider));
        return DONE;
      }
      const record = existing(input.accountId);
      if (!record || record.provider !== input.provider) return failure('VALIDATION_FAILED', GONE);
      if (record.kind === 'api') {
        const keyState = vault.check(record.id);
        if (keyState === 'locked') return failure('VAULT_LOCKED', VAULT_LOCKED);
        if (keyState !== 'stored') return failure('VALIDATION_FAILED', NEEDS_KEY);
        settings.set(DEFAULT_ACCOUNT_KEY(input.provider), record.id, deps.now());
        return DONE;
      }
      const status = await cli.status(input.provider, record.id);
      if (status.state !== 'connected') {
        return failure('VALIDATION_FAILED', 'Conecte a conta antes de torná-la a padrão.');
      }
      settings.set(DEFAULT_ACCOUNT_KEY(input.provider), record.id, deps.now());
      return DONE;
    },

    async disconnect(input) {
      if (input.accountId !== null) {
        const record = existing(input.accountId);
        if (!record || record.provider !== input.provider) {
          return failure('VALIDATION_FAILED', GONE);
        }
        if (record.kind === 'api') return failure('VALIDATION_FAILED', API_NOT_SIGNED_IN);
      }
      const blocked = await busy(input.provider, input.accountId);
      if (blocked) return blocked;
      const result = await cli.logout(input.provider, input.accountId);
      if (!result.ok) return result;
      // Conta sem login não pode ser a padrão: um painel novo abriria pedindo login.
      resetDefaultIf(input.provider, input.accountId);
      return DONE;
    },

    async remove(input) {
      const record = existing(input.accountId);
      if (!record) return failure('VALIDATION_FAILED', GONE);
      const blocked = await busy(record.provider, record.id);
      if (blocked) return blocked;
      if (record.kind === 'api') {
        // A chave sai primeiro: se a pasta não puder ser apagada, a conta fica na lista, mas sem chave.
        vault.remove(record.id);
        resetDefaultIf(record.provider, record.id);
        const removed = await paths.removeFolder(record.provider, record.id);
        if (!removed.ok) return removed;
        accounts.markRemoved(record.id, deps.now());
        return DONE;
      }
      const logout = await cli.logout(record.provider, record.id);
      if (!logout.ok && !input.force) {
        return failure('PROCESS_START_FAILED', 'Não foi possível sair da conta pelo programa.');
      }
      const removed = await paths.removeFolder(record.provider, record.id);
      if (!removed.ok) return removed;
      accounts.markRemoved(record.id, deps.now());
      resetDefaultIf(record.provider, record.id);
      return DONE;
    },
  };
}
