import { lstat, mkdir, realpath, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { failure } from '@project-hub/application';
import {
  accountIdSchema,
  type AccountKind,
  type AccountProviderId,
  type AppResult,
  type ProviderId,
} from '@project-hub/contracts';
import type { AccountRepository } from '@project-hub/database';

/** A variável que faz cada programa usar outra pasta de configuração, e com ela outra conta. */
export const ACCOUNT_ENV_VARIABLE: Record<AccountProviderId, string> = {
  claude: 'CLAUDE_CONFIG_DIR',
  codex: 'CODEX_HOME',
};

/**
 * O provedor do Codex de uma conta por chave de API. O provedor embutido (`openai`) exige login; um provedor próprio
 * com `env_key` lê a chave do ambiente (`OPENAI_API_KEY`, posta por `launchEnv`) e abre sem login, no `exec` e no
 * interativo (conferido com o Codex 0.169 e chave falsa, 2026-11-22). Vai por `-c` a cada abertura, sem gravar o
 * `config.toml`: o `-c` vence o arquivo, então um `config.toml` alterado na pasta da conta não desvia a chave para
 * outro endereço. A última opção força o filtro do Codex que tira as variáveis com `KEY`, `SECRET` e `TOKEN` do
 * ambiente dos comandos que o agente roda. Os valores não têm aspas, chaves, `<` nem espaço: passam também por um
 * `codex.cmd`. A chave nunca está aqui, só no ambiente.
 */
export const CODEX_API_PROVIDER_ARGS: readonly string[] = [
  '-c',
  'model_provider=openai-chave-api',
  '-c',
  'model_providers.openai-chave-api.name=OpenAI',
  '-c',
  'model_providers.openai-chave-api.base_url=https://api.openai.com/v1',
  '-c',
  'model_providers.openai-chave-api.env_key=OPENAI_API_KEY',
  '-c',
  'model_providers.openai-chave-api.wire_api=responses',
  '-c',
  'model_providers.openai-chave-api.requires_openai_auth=false',
  '-c',
  'shell_environment_policy.ignore_default_excludes=false',
];

/**
 * Opções que uma conta extra põe na linha do programa, antes dos extras do lançamento (a retomada). O Codex
 * interativo abre um servidor de fundo com um socket dentro da pasta da conta, e o caminho do socket tem limite
 * (108 caracteres no Windows): a pasta de uma conta extra, dentro da pasta de dados do app, passa dele, e o Codex
 * nem abre. Com `--no-daemon`, ele roda sem o servidor de fundo, como ele mesmo sugere no erro. A Principal
 * (`~/.codex`) fica como sempre. A conta por chave de API do Codex leva também o provedor (`CODEX_API_PROVIDER_ARGS`).
 */
export function accountLaunchArgs(
  provider: ProviderId,
  accountId: string | null,
  kind: AccountKind,
): readonly string[] {
  if (provider !== 'codex' || accountId === null) return [];
  return kind === 'api' ? ['--no-daemon', ...CODEX_API_PROVIDER_ARGS] : ['--no-daemon'];
}

/** A área das contas extras, dentro da pasta de dados do app. A Principal não mora aqui. */
export function accountsRoot(dataDir: string): string {
  return join(dataDir, 'accounts');
}

export type AccountPaths = {
  folderOf(provider: AccountProviderId, id: string): string;
  ensureFolder(provider: AccountProviderId, id: string): Promise<string>;
  /**
   * O ambiente de uma conta. `null` é a Principal: nenhuma variável. Conta desconhecida, removida ou de outro
   * programa é erro, e nunca ambiente vazio, para um painel não cair na Principal sem a pessoa saber.
   */
  envOf(provider: AccountProviderId, accountId: string | null): AppResult<Record<string, string>>;
  /** Apaga a pasta de uma conta extra. Só dentro da área das contas, com nome de UUID e sem link ou junção. */
  removeFolder(provider: AccountProviderId, id: string): Promise<AppResult<undefined>>;
};

const GONE = 'A conta não existe mais.';
const REFUSED = 'A pasta da conta não está onde o app a criou. Nada foi apagado.';
const BUSY =
  'Não foi possível apagar a pasta da conta. Feche os programas que a usam e tente de novo.';

function isMissing(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT';
}

export function createAccountPaths(deps: {
  root: string;
  accounts: Pick<AccountRepository, 'get'>;
}): AccountPaths {
  const folderOf = (provider: AccountProviderId, id: string): string =>
    join(deps.root, provider, id);

  return {
    folderOf,

    async ensureFolder(provider, id) {
      if (!accountIdSchema.safeParse(id).success) throw new Error('Id de conta inválido.');
      const folder = folderOf(provider, id);
      await mkdir(folder, { recursive: true });
      return folder;
    },

    envOf(provider, accountId) {
      if (accountId === null) return { ok: true, data: {} };
      if (!accountIdSchema.safeParse(accountId).success) return failure('VALIDATION_FAILED', GONE);
      const account = deps.accounts.get(accountId);
      if (!account || account.removedAt !== undefined || account.provider !== provider) {
        return failure('VALIDATION_FAILED', GONE);
      }
      return {
        ok: true,
        data: { [ACCOUNT_ENV_VARIABLE[provider]]: folderOf(provider, accountId) },
      };
    },

    async removeFolder(provider, id) {
      if (!accountIdSchema.safeParse(id).success) return failure('VALIDATION_FAILED', REFUSED);
      const folder = folderOf(provider, id);
      try {
        const stat = await lstat(folder);
        if (stat.isSymbolicLink() || !stat.isDirectory()) {
          return failure('VALIDATION_FAILED', REFUSED);
        }
        // A pasta do programa ou a raiz podem ser uma junção: o caminho real tem de ser o esperado.
        const expected = join(await realpath(deps.root), provider, id);
        if ((await realpath(folder)) !== expected) return failure('VALIDATION_FAILED', REFUSED);
      } catch (error) {
        if (isMissing(error)) return { ok: true, data: undefined };
        return failure('UNKNOWN', BUSY);
      }
      try {
        await rm(folder, { recursive: true, force: false });
      } catch (error) {
        if (isMissing(error)) return { ok: true, data: undefined };
        return failure('UNKNOWN', BUSY);
      }
      return { ok: true, data: undefined };
    },
  };
}
