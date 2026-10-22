import { spawn, type ChildProcess } from 'node:child_process';
import { connectTerminalHost, TerminalHostError, type TerminalHostClient } from './client';
import { readHostToken } from './token';

export type EnsureTerminalHostOptions = {
  pipePath: string;
  tokenFile: string;
  /** Executável que roda o processo: o próprio Electron, com ELECTRON_RUN_AS_NODE=1. */
  execPath: string;
  /** Arquivo de entrada do processo de terminais, já empacotado. */
  entryPath: string;
  logFile: string;
  /** Pasta do registro de eventos de hook. */
  hookLogDir: string;
  /** Tempo sem sessões e sem app conectado até o processo novo encerrar. Padrão: 30 minutos. */
  idleTimeoutMs?: number;
  /** Tempo máximo para o processo novo aceitar conexões. Padrão: 10 segundos. */
  startTimeoutMs?: number;
};

const RETRY_MS = 150;

/**
 * Devolve uma conexão com o processo de terminais. Se ele já está de pé, reaproveita. Se não, sobe um
 * processo novo, desligado do app, com um token novo. Se o processo existe mas não aceita o token
 * guardado, o erro sobe: não se sobe outro por cima dele.
 */
export async function ensureTerminalHost(
  options: EnsureTerminalHostOptions,
): Promise<TerminalHostClient> {
  const storedToken = readHostToken(options.tokenFile);
  if (storedToken !== undefined) {
    try {
      return await connectTerminalHost({ pipePath: options.pipePath, token: storedToken });
    } catch (error) {
      if (!isUnreachable(error)) throw error;
    }
  }

  let spawnError: Error | undefined;
  const child = spawnTerminalHost(options);
  child.on('error', (error) => {
    spawnError = error;
  });
  return waitForHost(options, () => spawnError);
}

/** Sobe o processo de terminais sem vínculo com o app: sobrevive quando o app fecha. */
export function spawnTerminalHost(options: EnsureTerminalHostOptions): ChildProcess {
  const args = [
    options.entryPath,
    '--pipe',
    options.pipePath,
    '--token-file',
    options.tokenFile,
    '--log-file',
    options.logFile,
    '--hook-log-dir',
    options.hookLogDir,
  ];
  if (options.idleTimeoutMs !== undefined) {
    args.push('--idle-timeout-ms', String(options.idleTimeoutMs));
  }
  const child = spawn(options.execPath, args, {
    detached: true,
    stdio: 'ignore',
    windowsHide: true,
    env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
  });
  child.unref();
  return child;
}

async function waitForHost(
  options: EnsureTerminalHostOptions,
  spawnError: () => Error | undefined,
): Promise<TerminalHostClient> {
  const deadline = Date.now() + (options.startTimeoutMs ?? 10_000);
  let lastError: unknown;
  while (Date.now() <= deadline) {
    const error = spawnError();
    if (error !== undefined) throw error;
    // O token vem do arquivo que o processo novo grava depois de abrir o pipe. Enquanto ele não grava, ou
    // com o token antigo ainda no arquivo, a conexão falha e a espera continua.
    const token = readHostToken(options.tokenFile);
    if (token !== undefined) {
      try {
        return await connectTerminalHost({ pipePath: options.pipePath, token });
      } catch (error) {
        lastError = error;
        if (!isUnreachable(error) && !isAuthFailed(error)) throw error;
      }
    }
    await sleep(RETRY_MS);
  }
  if (lastError instanceof TerminalHostError && lastError.code === 'AUTH_FAILED') throw lastError;
  throw new TerminalHostError('TIMEOUT', 'o processo de terminais não ficou pronto a tempo');
}

function isAuthFailed(error: unknown): boolean {
  return error instanceof TerminalHostError && error.code === 'AUTH_FAILED';
}

function isUnreachable(error: unknown): boolean {
  return error instanceof TerminalHostError && error.code === 'UNREACHABLE';
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
