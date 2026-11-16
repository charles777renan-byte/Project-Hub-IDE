import { readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import {
  BROWSER_PROVIDERS,
  agentLaunchFor,
  type AgentBrowserAccess,
  type AgentLaunch,
} from './agent-launch';
import type { AgentTokens } from './agent-tokens';

export type AgentBrowserAccessDeps = {
  tokens: AgentTokens;
  /** O endereço do servidor de ferramentas, ou `undefined` enquanto ele não está no ar. */
  url(): string | undefined;
  /** Pasta dos arquivos de configuração por terminal. */
  dir: string;
  /** Fecha as abas que o terminal abriu. */
  endTerminal(terminalId: string): void;
  /** Avisa quando o processo do terminal acaba. */
  onExit(terminalId: string, exited: () => void): void;
};

/** O acesso com o fim do app: revoga tudo e apaga os arquivos. */
export type DisposableAgentBrowserAccess = AgentBrowserAccess & { dispose(): void };

/** Os nomes dos arquivos da pasta, ou nenhum se ela não existe. */
function namesIn(dir: string): string[] {
  try {
    return readdirSync(dir);
  } catch {
    return [];
  }
}

function remove(file: string): void {
  try {
    rmSync(file, { force: true });
  } catch {
    // Um arquivo preso não impede de soltar o terminal; ele não guarda o token.
  }
}

/**
 * O acesso ao navegador que o serviço de terminais recebe. O token nasce em `prepare`, vive só na memória (aqui
 * dentro, o registro guarda um resumo dele) e no ambiente do terminal, e morre em `release`: quando o terminal
 * fecha, quando não abre ou quando o processo dele acaba sozinho.
 */
export function createAgentBrowserAccess(
  deps: AgentBrowserAccessDeps,
): DisposableAgentBrowserAccess {
  const files = new Map<string, readonly string[]>();

  function release(terminalId: string): void {
    deps.tokens.revoke(terminalId);
    deps.endTerminal(terminalId);
    for (const file of files.get(terminalId) ?? []) remove(file);
    files.delete(terminalId);
  }

  return {
    prepare(terminalId, projectId, provider): AgentLaunch | undefined {
      const url = deps.url();
      if (url === undefined || !BROWSER_PROVIDERS.includes(provider)) return undefined;
      const token = deps.tokens.issue({ terminalId, projectId });
      try {
        const launch = agentLaunchFor(provider, { dir: deps.dir, terminalId, url, token });
        if (launch === undefined) {
          deps.tokens.revoke(terminalId);
          return undefined;
        }
        files.set(terminalId, launch.files);
        return launch;
      } catch (error) {
        deps.tokens.revoke(terminalId);
        throw error;
      }
    },

    opened(terminalId) {
      deps.onExit(terminalId, () => release(terminalId));
    },

    release,

    isActive: (terminalId) => deps.tokens.has(terminalId),

    supports: (provider) => deps.url() !== undefined && BROWSER_PROVIDERS.includes(provider),

    dispose() {
      for (const terminalId of [...files.keys()]) release(terminalId);
      deps.tokens.clear();
      // O que sobrou de uma execução que não fechou direito. Os arquivos não guardam o token, só o endereço.
      for (const name of namesIn(deps.dir)) {
        if (name.endsWith('.mcp.json')) remove(join(deps.dir, name));
      }
    },
  };
}
