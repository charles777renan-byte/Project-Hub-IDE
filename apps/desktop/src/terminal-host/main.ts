import { appendFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { startHookReceiver } from './hook-receiver';
import { startTerminalHost } from './host';
import { PtyManager } from './pty-manager';
import { TerminalCommands } from './terminal-commands';
import { createHostToken, writeHostToken } from './token';

/** Sem sessões e sem app conectado, o processo encerra depois deste tempo. */
const DEFAULT_IDLE_TIMEOUT_MS = 30 * 60 * 1000;

/**
 * Ponto de entrada do processo de terminais. Roda separado do app, com o executável do Electron em modo
 * Node. Recebe o pipe, o arquivo do token e o log pela linha de comando. Não tem janela e não tem console:
 * tudo o que importa vai para o log.
 */
function argValue(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index === -1 ? undefined : process.argv[index + 1];
}

const logFile = argValue('--log-file');

function log(line: string): void {
  if (logFile === undefined) return;
  mkdirSync(dirname(logFile), { recursive: true });
  appendFileSync(logFile, `${new Date().toISOString()} ${line}\n`);
}

async function main(): Promise<void> {
  const pipePath = argValue('--pipe');
  const tokenFile = argValue('--token-file');
  if (pipePath === undefined || tokenFile === undefined) {
    log('faltam --pipe e --token-file');
    process.exit(2);
  }
  // O processo cria o próprio token e só o grava depois de abrir o pipe: um segundo processo que perde a
  // disputa pelo pipe sai sem sobrescrever o token do que ficou.
  const token = createHostToken();
  const manager = new PtyManager();
  const hookLogDir = argValue('--hook-log-dir');
  const receiver =
    hookLogDir === undefined ? undefined : await startHookReceiver({ logDir: hookLogDir });
  let touchHost: () => void = () => undefined;
  const commands = new TerminalCommands(manager, () => touchHost(), receiver);

  const idle = argValue('--idle-timeout-ms');
  const host = await startTerminalHost({
    pipePath,
    token,
    idleTimeoutMs: idle === undefined ? DEFAULT_IDLE_TIMEOUT_MS : Number(idle),
    getSessionCount: () => manager.aliveCount(),
    handleTerminal: (request, sink) => commands.handle(request, sink),
    onConnectionClosed: (sink) => commands.releaseConnection(sink),
    onStop: (reason) => {
      log(`encerrando: ${reason}`);
      process.exit(0);
    },
  });
  touchHost = () => host.touch();
  writeHostToken(tokenFile, token);
  log(`ouvindo em ${pipePath} (pid ${process.pid})`);

  for (const signal of ['SIGTERM', 'SIGINT'] as const) {
    process.on(signal, () => {
      log(`sinal ${signal}`);
      void manager
        .killAll()
        .then(() => host.close())
        .then(() => process.exit(0));
    });
  }
}

process.on('uncaughtException', (error) => {
  log(`erro não tratado: ${String(error)}`);
  process.exit(1);
});

main().catch((error: unknown) => {
  log(`falha ao iniciar: ${String(error)}`);
  process.exit(1);
});
