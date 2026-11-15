import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { ProviderId } from '@project-hub/contracts';

/** Variável de ambiente do terminal com o token do navegador. O token só viaja por ela. */
export const BROWSER_TOKEN_ENV = 'PROJECT_HUB_BROWSER_TOKEN';
/** Variável de ambiente do terminal com o endereço do servidor de ferramentas do navegador. */
export const BROWSER_URL_ENV = 'PROJECT_HUB_BROWSER_URL';
/** Programas que recebem o navegador nesta fase. */
export const BROWSER_PROVIDERS: readonly ProviderId[] = ['claude', 'codex'];
/** Permissão do Claude Code que libera as ferramentas do servidor `navegador` sem perguntar a cada chamada. */
export const BROWSER_PERMISSION = 'mcp__navegador';

/** O que entra no lançamento de um terminal para o programa alcançar o navegador. */
export type AgentLaunch = {
  /** Argumentos a mais, que vêm antes dos do programa. Nunca levam o token. */
  args: readonly string[];
  /** Variáveis a mais no ambiente do terminal: o endereço e o token. */
  env: Record<string, string>;
  /** Arquivos gravados para este terminal, apagados quando ele acaba. Nunca levam o token. */
  files: readonly string[];
};

export type AgentLaunchInput = {
  /** Pasta dos arquivos de configuração por terminal (a mesma dos arquivos de `--settings`). */
  dir: string;
  terminalId: string;
  /** `http://127.0.0.1:<porta>/mcp`. */
  url: string;
  token: string;
};

/**
 * O acesso ao navegador visto pelo serviço de terminais. `prepare` emite o token e devolve o que entra no
 * lançamento (`undefined`: o programa não tem o recurso); `opened` confirma que o terminal abriu; `release`
 * revoga o token, fecha as abas do terminal e apaga os arquivos, e pode ser chamado mais de uma vez.
 */
export type AgentBrowserAccess = {
  prepare(terminalId: string, projectId: string, provider: ProviderId): AgentLaunch | undefined;
  opened(terminalId: string): void;
  release(terminalId: string): void;
  /** Se o terminal tem um token vivo. */
  isActive(terminalId: string): boolean;
  /** Se o programa recebe o navegador ao abrir. */
  supports(provider: ProviderId): boolean;
};

const SERVER_URL = /^http:\/\/127\.0\.0\.1:\d{1,5}\/mcp$/;
const FILE_SAFE_ID = /^[A-Za-z0-9_-]{1,100}$/;

/**
 * Monta o que um programa recebe para alcançar o servidor do navegador. O token vai só no ambiente: o arquivo
 * do Claude Code e as opções do Codex citam o nome da variável, e cada programa a lê por conta própria.
 * Programa sem o recurso: `undefined`. Endereço que não é o do servidor local, ou id que não serve de nome
 * de arquivo: lança, e o terminal abre sem o navegador.
 */
export function agentLaunchFor(
  provider: ProviderId,
  input: AgentLaunchInput,
): AgentLaunch | undefined {
  if (!BROWSER_PROVIDERS.includes(provider)) return undefined;
  if (!SERVER_URL.test(input.url)) throw new Error('endereço do servidor do navegador inválido');
  if (!FILE_SAFE_ID.test(input.terminalId)) throw new Error('id de terminal inválido');
  const env = { [BROWSER_URL_ENV]: input.url, [BROWSER_TOKEN_ENV]: input.token };

  if (provider === 'claude') {
    mkdirSync(input.dir, { recursive: true });
    const file = join(input.dir, `${input.terminalId}.mcp.json`);
    const config = {
      mcpServers: {
        navegador: {
          type: 'http',
          url: input.url,
          headers: { Authorization: `Bearer \${${BROWSER_TOKEN_ENV}}` },
        },
      },
    };
    writeFileSync(file, JSON.stringify(config, null, 2), 'utf8');
    return { args: ['--mcp-config', file], env, files: [file] };
  }

  // Codex: o valor de `-c` é lido como TOML e, se não for, como texto; um endereço e um nome não pedem aspas.
  return {
    args: [
      '-c',
      `mcp_servers.navegador.url=${input.url}`,
      '-c',
      `mcp_servers.navegador.bearer_token_env_var=${BROWSER_TOKEN_ENV}`,
    ],
    env,
    files: [],
  };
}
