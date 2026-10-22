import { existsSync } from 'node:fs';
import { tmpdir, userInfo } from 'node:os';
import { delimiter, join } from 'node:path';
import { createClaudeCodeAdapter } from '@project-hub/agent-adapters';
import type { TerminalHostClient } from '../terminal-host/client';
import { buildTerminalEnv } from '../terminal-host/env';
import { ensureTerminalHost } from '../terminal-host/ensure';
import { terminalHostPipePath } from '../terminal-host/protocol';
import { createTerminalHostPort } from './terminal-host-port';
import { createRemoteHooks } from './terminal-host-hooks';

export type ClaudeAgentOptions = {
  /** Pasta de dados do app: guarda o token, o log, os hooks e as configurações do processo de terminais. */
  dataDir: string;
  /** Arquivo empacotado do processo de terminais (`out/main/terminal-host.js`). */
  hostEntry: string;
  /** Executável que roda o processo de terminais: o do Electron, em modo Node. */
  execPath: string;
  env: NodeJS.ProcessEnv;
};

/**
 * Agente real: o Claude Code interativo, num terminal do processo de terminais. O processo sobe sob
 * demanda, na primeira operação, e continua vivo quando o app fecha. Uma só conexão é aberta por vez, para
 * dois pedidos simultâneos não subirem dois processos.
 */
export function createClaudeAgent(
  options: ClaudeAgentOptions,
): ReturnType<typeof createClaudeCodeAdapter> {
  const base = join(options.dataDir, 'terminal-host');
  const hostOptions = {
    pipePath: terminalHostPipePath(userInfo().username, process.platform, tmpdir()),
    tokenFile: join(base, 'host.token'),
    logFile: join(base, 'host.log'),
    hookLogDir: join(base, 'hooks'),
    execPath: options.execPath,
    entryPath: options.hostEntry,
  };
  let pending: Promise<TerminalHostClient> | undefined;
  const connect = (): Promise<TerminalHostClient> => {
    pending ??= ensureTerminalHost(hostOptions).finally(() => {
      pending = undefined;
    });
    return pending;
  };
  return createClaudeCodeAdapter({
    terminal: createTerminalHostPort({ connect }),
    hooks: createRemoteHooks(connect),
    command: resolveExecutable('claude', options.env),
    settingsDir: join(base, 'settings'),
    env: buildTerminalEnv(options.env),
  });
}

/**
 * Caminho completo do executável. O terminal no Windows não procura pelo PATH nem completa o `.exe`, então
 * o nome solto não abre. Sem achar, devolve o nome: a sondagem e a abertura mostram o erro.
 */
export function resolveExecutable(name: string, env: NodeJS.ProcessEnv): string {
  const path = env['PATH'] ?? env['Path'] ?? '';
  const extensions = process.platform === 'win32' ? ['.exe'] : [''];
  for (const folder of path.split(delimiter)) {
    for (const extension of extensions) {
      const candidate = join(folder, `${name}${extension}`);
      if (folder !== '' && existsSync(candidate)) return candidate;
    }
  }
  return name;
}
