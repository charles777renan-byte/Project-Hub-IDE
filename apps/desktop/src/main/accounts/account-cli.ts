import { failure } from '@project-hub/application';
import type { AccountProviderId, AccountState, AppResult } from '@project-hub/contracts';
import type { AccountRepository } from '@project-hub/database';
import { buildTerminalEnv } from '../../terminal-host/env';
import type { PlannerRunner } from '../claude-planner';
import type { ProviderRegistry } from '../providers';
import type { AccountPaths } from './account-paths';

/** Os comandos oficiais de cada programa para entrar, ler o estado e sair. O app não fala com o serviço. */
export const ACCOUNT_COMMANDS: Record<
  AccountProviderId,
  { login: readonly string[]; status: readonly string[]; logout: readonly string[] }
> = {
  claude: {
    login: ['auth', 'login', '--claudeai'],
    status: ['auth', 'status', '--json'],
    logout: ['auth', 'logout'],
  },
  codex: { login: ['login'], status: ['login', 'status'], logout: ['logout'] },
};

/** O estado de uma conta, lido do programa. A identidade fica só em memória. */
export type AccountStatus = { state: AccountState; identity?: string; organization?: string };

const IDENTITY_MAX = 254;
const ORGANIZATION_MAX = 200;
const LOGOUT_FAILED = 'O programa não confirmou a saída da conta.';
const API_ACCOUNT = 'Conta por chave de API não entra nem sai pelo programa.';
const DEFAULT_TIMEOUT_MS = 15_000;

function text(value: unknown, max: number): string | undefined {
  return typeof value === 'string' && value !== '' && value.length <= max ? value : undefined;
}

/** Lê a resposta de `claude auth status --json`. O que não for reconhecido é `unknown`. */
export function parseClaudeStatus(stdout: string): AccountStatus {
  let parsed: unknown;
  try {
    parsed = JSON.parse(stdout.trim());
  } catch {
    return { state: 'unknown' };
  }
  if (typeof parsed !== 'object' || parsed === null) return { state: 'unknown' };
  const record = parsed as Record<string, unknown>;
  if (record['loggedIn'] === false) return { state: 'signed-out' };
  if (record['loggedIn'] !== true) return { state: 'unknown' };
  const identity = text(record['email'], IDENTITY_MAX);
  const organization = text(record['orgName'], ORGANIZATION_MAX);
  return {
    state: 'connected',
    ...(identity === undefined ? {} : { identity }),
    ...(organization === undefined ? {} : { organization }),
  };
}

/**
 * Lê a resposta de `codex login status`. O Codex escreve a frase na saída de erro, que o executor não devolve:
 * sem a frase, vale o código de saída (0 conectada, 1 desconectada). O Codex não informa quem é a conta.
 */
export function parseCodexStatus(stdout: string, exitCode: number): AccountStatus {
  if (/not logged in/i.test(stdout)) return { state: 'signed-out' };
  if (/logged in/i.test(stdout)) return { state: 'connected' };
  if (stdout.trim() !== '') return { state: 'unknown' };
  if (exitCode === 0) return { state: 'connected' };
  if (exitCode === 1) return { state: 'signed-out' };
  return { state: 'unknown' };
}

export type AccountLaunch = { command: string; args: string[]; env: Record<string, string> };

export type AccountCli = {
  status(provider: AccountProviderId, accountId: string | null): Promise<AccountStatus>;
  logout(provider: AccountProviderId, accountId: string | null): Promise<AppResult<undefined>>;
  /** O comando de login, para o terminal do login. Aqui nada é executado. */
  loginLaunch(provider: AccountProviderId, accountId: string | null): AppResult<AccountLaunch>;
};

export function createAccountCli(deps: {
  providers: ProviderRegistry;
  paths: Pick<AccountPaths, 'envOf'>;
  /** Para recusar a conta API: ela não tem login no programa. */
  accounts: Pick<AccountRepository, 'get'>;
  env: NodeJS.ProcessEnv;
  run: PlannerRunner;
  cwd: string;
  timeoutMs?: number;
}): AccountCli {
  const timeoutMs = deps.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  function isApiAccount(accountId: string | null): boolean {
    return accountId !== null && deps.accounts.get(accountId)?.kind === 'api';
  }

  /** O único lugar que transforma (programa, conta) em comando e ambiente. */
  function launchOf(
    provider: AccountProviderId,
    accountId: string | null,
    command: readonly string[],
  ): AppResult<AccountLaunch> {
    if (isApiAccount(accountId)) return failure('VALIDATION_FAILED', API_ACCOUNT);
    const extra = deps.paths.envOf(provider, accountId);
    if (!extra.ok) return extra;
    const resolution = deps.providers.resolve(provider);
    if (!resolution.ok) return failure('AGENT_UNAVAILABLE', resolution.reason);
    const { launch } = resolution;
    return {
      ok: true,
      data: {
        command: launch.command,
        args: [...(launch.prefix ?? []), ...launch.args, ...command],
        env: buildTerminalEnv(deps.env, extra.data),
      },
    };
  }

  /** Roda um comando sem terminal. A saída não é registrada em lugar nenhum. */
  async function run(
    launch: AccountLaunch,
  ): Promise<{ stdout: string; exitCode: number } | undefined> {
    try {
      return await deps.run({
        command: launch.command,
        args: launch.args,
        cwd: deps.cwd,
        env: launch.env,
        stdin: '',
        timeoutMs,
        signal: new AbortController().signal,
      });
    } catch {
      return undefined;
    }
  }

  return {
    async status(provider, accountId) {
      const launch = launchOf(provider, accountId, ACCOUNT_COMMANDS[provider].status);
      if (!launch.ok) return { state: 'unknown' };
      const output = await run(launch.data);
      if (output === undefined) return { state: 'unknown' };
      return provider === 'claude'
        ? parseClaudeStatus(output.stdout)
        : parseCodexStatus(output.stdout, output.exitCode);
    },

    async logout(provider, accountId) {
      const launch = launchOf(provider, accountId, ACCOUNT_COMMANDS[provider].logout);
      if (!launch.ok) return launch;
      const output = await run(launch.data);
      if (output === undefined || output.exitCode !== 0) {
        return failure('AGENT_UNAVAILABLE', LOGOUT_FAILED);
      }
      return { ok: true, data: undefined };
    },

    loginLaunch: (provider, accountId) =>
      launchOf(provider, accountId, ACCOUNT_COMMANDS[provider].login),
  };
}
