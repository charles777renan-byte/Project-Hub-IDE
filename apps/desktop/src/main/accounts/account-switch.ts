import type { AccountPick } from '@project-hub/application';
import type { AccountKind, AccountProviderId, KeyState } from '@project-hub/contracts';
import type { AccountRepository, AppSettingsRepository } from '@project-hub/database';
import type { AccountStatus } from './account-cli';
import type { AccountUse } from './account-use';
import type { AccountVault } from './account-vault';

/** A opção "trocar de conta quando o limite acabar", por programa. Guardada como `'true'` ou ausente. */
export const AUTO_SWITCH_KEY = (provider: AccountProviderId): string =>
  `accounts.autoSwitch.${provider}`;
/** Contas por chave de API entram na troca: só no Claude Code, e só se a pessoa ligar (cobram por uso). */
export const AUTO_SWITCH_API_KEY = 'accounts.autoSwitch.includeApi.claude';

export type AutoSwitchSettings = { enabled: boolean; includeApi: boolean };

/** Lê a opção do programa. Só `'true'` liga; a falta ou outro valor desliga. */
export function autoSwitchSettingsOf(
  settings: Pick<AppSettingsRepository, 'get'>,
  provider: AccountProviderId,
): AutoSwitchSettings {
  return {
    enabled: settings.get(AUTO_SWITCH_KEY(provider)) === 'true',
    includeApi: provider === 'claude' && settings.get(AUTO_SWITCH_API_KEY) === 'true',
  };
}

/** A ordem das candidatas: a padrão, a Principal e as extras na ordem de criação, sem repetir. */
export function candidateOrder(
  defaultId: string | null,
  extras: readonly string[],
): (string | null)[] {
  const order: (string | null)[] = [defaultId];
  for (const id of [null, ...extras]) if (!order.includes(id)) order.push(id);
  return order;
}

/** O que se sabe de uma candidata. `connected` só é perguntado ao programa quando o resto já passou. */
export type CandidateFacts = {
  accountId: string | null;
  removed: boolean;
  kind: AccountKind;
  keyState?: KeyState;
  connected?: boolean;
  exhaustedUntil?: string;
};

export type Eligibility =
  'eligible' | 'removed' | 'api-excluded' | 'vault-locked' | 'no-key' | 'signed-out' | 'exhausted';

/** Se a candidata serve para a troca, e o porquê quando não serve. */
export function eligibilityOf(facts: CandidateFacts, settings: AutoSwitchSettings): Eligibility {
  if (facts.removed) return 'removed';
  if (facts.kind === 'api') {
    if (!settings.includeApi) return 'api-excluded';
    if (facts.keyState === 'locked') return 'vault-locked';
    if (facts.keyState !== 'stored') return 'no-key';
  } else if (facts.connected !== true) {
    return 'signed-out';
  }
  if (facts.exhaustedUntil !== undefined) return 'exhausted';
  return 'eligible';
}

/**
 * A conta que a tela sugere para uma missão nova: a padrão, a não ser que a opção esteja ligada e a padrão
 * esgotada; aí a primeira elegível. Nenhuma elegível: a padrão (a missão espera a renovação nela).
 */
export function preferredAccount(input: {
  defaultId: string | null;
  order: readonly (string | null)[];
  facts: ReadonlyMap<string | null, CandidateFacts>;
  settings: AutoSwitchSettings;
}): string | null {
  const { defaultId, order, facts, settings } = input;
  if (!settings.enabled || facts.get(defaultId)?.exhaustedUntil === undefined) return defaultId;
  const first = order.find((id) => {
    const fact = facts.get(id);
    return fact !== undefined && eligibilityOf(fact, settings) === 'eligible';
  });
  return first === undefined ? defaultId : first;
}

export type AccountSwitch = {
  settingsOf(provider: AccountProviderId): AutoSwitchSettings;
  /** A próxima conta que serve, fora `exclude` (a que acabou de esgotar). */
  pick(provider: AccountProviderId, input: { exclude: string | null }): Promise<AccountPick>;
};

export function createAccountSwitch(deps: {
  accounts: Pick<AccountRepository, 'get' | 'list'>;
  settings: Pick<AppSettingsRepository, 'get'>;
  use: Pick<AccountUse, 'defaultOf'>;
  vault: Pick<AccountVault, 'check'>;
  status(provider: AccountProviderId, accountId: string | null): Promise<AccountStatus>;
  exhaustedUntil(provider: AccountProviderId, accountId: string | null): string | undefined;
}): AccountSwitch {
  function factsOf(provider: AccountProviderId, accountId: string | null): CandidateFacts {
    const record = accountId === null ? undefined : deps.accounts.get(accountId);
    const removed = accountId !== null && (record === undefined || record.removedAt !== undefined);
    const kind: AccountKind = record?.kind ?? 'subscription';
    const facts: CandidateFacts = { accountId, removed, kind };
    if (kind === 'api' && accountId !== null) facts.keyState = deps.vault.check(accountId);
    const until = deps.exhaustedUntil(provider, accountId);
    if (until !== undefined) facts.exhaustedUntil = until;
    return facts;
  }

  async function connected(
    provider: AccountProviderId,
    accountId: string | null,
  ): Promise<boolean> {
    try {
      return (await deps.status(provider, accountId)).state === 'connected';
    } catch {
      return false;
    }
  }

  return {
    settingsOf: (provider) => autoSwitchSettingsOf(deps.settings, provider),

    async pick(provider, { exclude }) {
      const settings = autoSwitchSettingsOf(deps.settings, provider);
      const order = candidateOrder(
        deps.use.defaultOf(provider),
        deps.accounts.list(provider).map((record) => record.id),
      );
      let soonest: string | undefined;
      const note = (until: string | undefined): void => {
        if (until === undefined) return;
        if (soonest === undefined || new Date(until).getTime() < new Date(soonest).getTime()) {
          soonest = until;
        }
      };
      note(deps.exhaustedUntil(provider, exclude));
      for (const accountId of order) {
        if (accountId === exclude) continue;
        const facts = factsOf(provider, accountId);
        note(facts.exhaustedUntil);
        // O barato primeiro: só pergunta o login ao programa quando o resto já serve.
        if (eligibilityOf({ ...facts, connected: true }, settings) !== 'eligible') continue;
        if (facts.kind === 'subscription') facts.connected = await connected(provider, accountId);
        if (eligibilityOf(facts, settings) === 'eligible') return { kind: 'account', accountId };
      }
      return soonest === undefined ? { kind: 'none' } : { kind: 'none', resetsAt: soonest };
    },
  };
}
