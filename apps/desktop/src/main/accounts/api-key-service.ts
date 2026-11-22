import { failure } from '@project-hub/application';
import type { AccountProviderId, AppResult } from '@project-hub/contracts';
import type { AccountRepository, AppSettingsRepository } from '@project-hub/database';
import { ACCOUNT_REMOVED } from './account-use';
import { VAULT_LOCKED, VAULT_UNAVAILABLE, type AccountVault } from './account-vault';
import { DEFAULT_ACCOUNT_KEY } from './accounts-service';
import {
  API_KEY_ONLY_CLAUDE,
  apiKeyProblem,
  isApiKeyProvider,
  keyProblemText,
} from './api-key-shape';
import type { ClaudeKeyApproval } from './claude-key-approval';

export { API_KEY_ONLY_CLAUDE } from './api-key-shape';
export const NOT_API_ACCOUNT = 'Esta conta não usa chave de API.';

type KeyTarget = { provider: AccountProviderId; accountId: string };

export type ApiKeyService = {
  /** Lê a chave da área de transferência e a guarda no cofre. Devolve só os 4 últimos caracteres. */
  paste(input: KeyTarget): Promise<AppResult<{ last4: string }>>;
  remove(input: KeyTarget): Promise<AppResult<undefined>>;
};

export function createApiKeyService(deps: {
  accounts: Pick<AccountRepository, 'get'>;
  settings: Pick<AppSettingsRepository, 'get' | 'remove'>;
  vault: Pick<AccountVault, 'put' | 'remove' | 'status'>;
  /** A área de transferência do Electron: a leitura é assíncrona desde o Electron 44. */
  clipboard: { readText(): Promise<string>; clear(): void };
  /** Abre a janela da senha se o cofre estiver vazio ou trancado. */
  ensureUnlocked(): Promise<'unlocked' | 'cancelled'>;
  approval: Pick<ClaudeKeyApproval, 'grant' | 'revoke'>;
}): ApiKeyService {
  /** A conta API de um programa com chave, ou a frase da recusa. */
  function apiAccount(input: KeyTarget): AppResult<undefined> {
    if (!isApiKeyProvider(input.provider)) return failure('VALIDATION_FAILED', API_KEY_ONLY_CLAUDE);
    const account = deps.accounts.get(input.accountId);
    if (account === undefined || account.removedAt !== undefined) {
      return failure('VALIDATION_FAILED', ACCOUNT_REMOVED);
    }
    if (account.provider !== input.provider) return failure('VALIDATION_FAILED', ACCOUNT_REMOVED);
    if (account.kind !== 'api') return failure('VALIDATION_FAILED', NOT_API_ACCOUNT);
    return { ok: true, data: undefined };
  }

  /** O texto da área de transferência. Imagem, vazio ou erro ao ler viram texto vazio. */
  async function readClipboard(): Promise<string> {
    try {
      return await deps.clipboard.readText();
    } catch {
      return '';
    }
  }

  return {
    async paste(input) {
      const target = apiAccount(input);
      if (!target.ok) return target;
      if (!deps.vault.status().available) return failure('VALIDATION_FAILED', VAULT_UNAVAILABLE);
      if (deps.vault.status().state !== 'unlocked') {
        if ((await deps.ensureUnlocked()) !== 'unlocked') {
          return failure('VAULT_LOCKED', VAULT_LOCKED);
        }
      }
      const raw = await readClipboard();
      const key = raw.trim();
      const problem = apiKeyProblem(key);
      if (problem !== undefined) return failure('VALIDATION_FAILED', keyProblemText(problem));
      const stored = deps.vault.put(input.accountId, key);
      if (!stored.ok) return stored;
      // Só limpa se a área de transferência ainda tem o mesmo texto: a pessoa pode ter copiado outra coisa.
      if ((await readClipboard()) === raw) {
        try {
          deps.clipboard.clear();
        } catch {
          // Sem limpar, a chave continua só onde a pessoa a pôs.
        }
      }
      try {
        if (!(await deps.approval.grant(input.accountId, key))) {
          console.warn('A aprovação da chave não foi gravada: o .claude.json da conta não é JSON.');
        }
      } catch {
        console.warn('A aprovação da chave não foi gravada no .claude.json da conta.');
      }
      return { ok: true, data: { last4: stored.data.last4 } };
    },

    async remove(input) {
      const target = apiAccount(input);
      if (!target.ok) return target;
      deps.vault.remove(input.accountId);
      try {
        await deps.approval.revoke(input.accountId);
      } catch {
        console.warn('A aprovação da chave não foi tirada do .claude.json da conta.');
      }
      // Conta API sem chave não abre nada: a padrão volta à Principal.
      const defaultKey = DEFAULT_ACCOUNT_KEY(input.provider);
      if (deps.settings.get(defaultKey) === input.accountId) deps.settings.remove(defaultKey);
      return { ok: true, data: undefined };
    },
  };
}
