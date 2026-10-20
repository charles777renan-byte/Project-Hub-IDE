import type { ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import { existsSync, readFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { join } from 'node:path';
import type { ElectronApplication } from '@playwright/test';
import { expect, test } from './fixtures';

// Fechar o aplicativo enquanto o renderer ainda carrega (defeito corrigido em `index.ts`). Fechar faz
// o `loadURL`/`loadFile` rejeitar com ERR_FAILED, igual a uma falha real, e o tratamento antigo abria
// `dialog.showErrorBox`, uma caixa modal que travava o encerramento. Aqui o carregamento fica pendente
// de forma determinística: um servidor local recebe o pedido e nunca termina a resposta.

/**
 * Servidor em 127.0.0.1, porta livre, que recebe o pedido e nunca termina a resposta. Ele envia só o
 * cabeçalho e o começo do HTML: sem nenhum byte, a janela fica sem documento e o Playwright não
 * consegue anexar ao alvo (`electron.launch` não termina). Com o começo do documento, o navegador
 * confirma a navegação, mas o carregamento (`isLoading`) segue pendente.
 */
async function startUnfinishedServer(): Promise<{
  url: string;
  requests: () => number;
  /** Derruba as conexões abertas no meio da resposta: o carregamento falha de verdade. */
  dropConnections(): void;
  stop(): Promise<void>;
}> {
  let requests = 0;
  const server: Server = createServer((_request, response) => {
    requests += 1;
    response.writeHead(200, { 'content-type': 'text/html' });
    response.write('<!doctype html><html><body>');
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const { port } = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${port}/`,
    requests: () => requests,
    dropConnections: () => server.closeAllConnections(),
    stop: async () => {
      // Sem derrubar as conexões presas, o `close` esperaria o Electron soltá-las.
      server.closeAllConnections();
      server.close();
      await once(server, 'close');
    },
  };
}

/** Espera o carregamento da janela principal começar e ficar pendente (guarda contra passe vazio). */
async function waitForPendingLoad(
  app: ElectronApplication,
  server: { requests: () => number },
): Promise<void> {
  await expect.poll(() => server.requests()).toBeGreaterThan(0);
  await expect
    .poll(() =>
      app.evaluate(({ BrowserWindow }) =>
        BrowserWindow.getAllWindows().some((window) => window.webContents.isLoading()),
      ),
    )
    .toBe(true);
}

/**
 * Troca a caixa nativa por um gravador (uma linha JSON por chamada em `files.calls`) e registra a
 * ordem dos eventos de saída em `files.lifecycle`. `will-quit` é onde o aplicativo fecha o banco.
 */
async function installRecorders(
  app: ElectronApplication,
  files: { calls: string; lifecycle: string },
): Promise<boolean> {
  return app.evaluate(({ app: electronApp, BrowserWindow, dialog }, paths) => {
    const fs = process.getBuiltinModule('node:fs');
    const append = (file: string, line: string) => fs.appendFileSync(file, `${line}\n`);
    const recorder = (title: string, content: string): void => {
      append(paths.calls, JSON.stringify({ title, content }));
    };
    dialog.showErrorBox = recorder;
    electronApp.on('before-quit', () => append(paths.lifecycle, 'before-quit'));
    electronApp.on('will-quit', () => append(paths.lifecycle, 'will-quit'));
    for (const window of BrowserWindow.getAllWindows()) {
      window.on('close', () => append(paths.lifecycle, 'window-close'));
      window.on('closed', () => append(paths.lifecycle, 'window-closed'));
    }
    return dialog.showErrorBox === recorder;
  }, files);
}

/** Linhas de um arquivo de registro; vazio se o arquivo nunca foi criado. */
function readLines(file: string): string[] {
  return existsSync(file)
    ? readFileSync(file, 'utf8')
        .split('\n')
        .filter((line) => line !== '')
    : [];
}

/** Prazo para o processo sair sozinho depois do gatilho; passado, o teste falha em vez de esperar o limite geral. */
const EXIT_DEADLINE_MS = 15_000;

/** Espera o processo terminar sozinho, sem o caminho de encerramento à força do fixture. */
async function waitForExit(child: ChildProcess): Promise<void> {
  const exited = (async () => {
    if (child.exitCode === null && child.signalCode === null) await once(child, 'exit');
    if (child.stderr && !child.stderr.readableEnded) await once(child.stderr, 'end');
  })();
  let timer: NodeJS.Timeout | undefined;
  const expired = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(
      () => reject(new Error(`O processo não saiu sozinho em ${EXIT_DEADLINE_MS} ms.`)),
      EXIT_DEADLINE_MS,
    );
  });
  try {
    await Promise.race([exited, expired]);
  } finally {
    clearTimeout(timer);
  }
}

test('fechar durante o carregamento termina sozinho, sem caixa de erro e com código 0', async ({
  launchProcess,
  dataDir,
}) => {
  // O processo sai antes de o teste poder perguntar algo a ele: o que importa fica em arquivos.
  const files = {
    calls: join(dataDir, 'show-error-box-calls.log'),
    lifecycle: join(dataDir, 'lifecycle.log'),
  };
  const unfinished = await startUnfinishedServer();
  try {
    const { app, close } = await launchProcess({ rendererUrl: unfinished.url });
    const child = app.process();
    const stderr: string[] = [];
    child.stderr?.on('data', (chunk: Buffer) => stderr.push(String(chunk)));

    await waitForPendingLoad(app, unfinished);
    expect(await installRecorders(app, files)).toBe(true);

    // `close` rejeita se o fixture precisar encerrar o processo à força: o defeito não passa em silêncio.
    await close();
    await waitForExit(child);

    expect(readLines(files.calls)).toEqual([]);
    expect(child.signalCode).toBeNull();
    expect(child.exitCode).toBe(0);
    // A saída em andamento terminou pelo caminho normal, que é onde o banco é fechado.
    expect(readLines(files.lifecycle)).toContain('will-quit');
    // A rejeição chegou ao tratamento (prova de que o caminho do defeito foi percorrido) e foi só registrada.
    expect(stderr.join('')).toContain('Carregamento da janela interrompido');
  } finally {
    await unfinished.stop();
  }
});

// O contraponto: a mesma rejeição do carregamento, mas com o aplicativo vivo e nenhuma saída pedida, é
// falha real. Garante, pela fiação de produção, que o estado "fechando" não está sempre ligado.
test('uma falha real de carregamento, com o app vivo, mostra a caixa e sai com código 1', async ({
  launchProcess,
  dataDir,
}) => {
  const files = {
    calls: join(dataDir, 'show-error-box-calls.log'),
    lifecycle: join(dataDir, 'lifecycle.log'),
  };
  const unfinished = await startUnfinishedServer();
  try {
    const { app } = await launchProcess({ rendererUrl: unfinished.url });
    const child = app.process();
    const stderr: string[] = [];
    child.stderr?.on('data', (chunk: Buffer) => stderr.push(String(chunk)));

    await waitForPendingLoad(app, unfinished);
    expect(await installRecorders(app, files)).toBe(true);

    // Corta a conexão no meio do corpo, sem fechar o aplicativo.
    unfinished.dropConnections();
    await waitForExit(child);

    // Uma caixa só, com o texto da falha de inicialização; o gravador não bloqueia, e `app.exit(1)` sai.
    const calls = readLines(files.calls).map(
      (line) => JSON.parse(line) as { title: string; content: string },
    );
    expect(calls).toHaveLength(1);
    expect(calls[0]?.title).toBe('Project Hub');
    expect(calls[0]?.content).toContain('Não foi possível iniciar o Project Hub.');
    expect(child.signalCode).toBeNull();
    expect(child.exitCode).toBe(1);
    // Nenhuma saída foi pedida antes da falha: era o carregamento que falhava, não o fechamento.
    expect(readLines(files.lifecycle)).not.toContain('before-quit');
    expect(stderr.join('')).toContain('Falha ao iniciar o aplicativo');
    expect(stderr.join('')).not.toContain('Carregamento da janela interrompido');
  } finally {
    await unfinished.stop();
  }
});
