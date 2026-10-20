import { once } from 'node:events';
import { existsSync, readFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { join } from 'node:path';
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
    stop: async () => {
      // Sem derrubar as conexões presas, o `close` esperaria o Electron soltá-las.
      server.closeAllConnections();
      server.close();
      await once(server, 'close');
    },
  };
}

test('fechar durante o carregamento termina sozinho, sem caixa de erro e com código 0', async ({
  launchProcess,
  dataDir,
}) => {
  // O processo sai antes de o teste poder perguntar algo a ele: o que importa fica em arquivos.
  const showErrorBoxCalls = join(dataDir, 'show-error-box-calls.log');
  const lifecycle = join(dataDir, 'lifecycle.log');
  const unfinished = await startUnfinishedServer();
  try {
    const { app, close } = await launchProcess({ rendererUrl: unfinished.url });
    const child = app.process();
    const stderr: string[] = [];
    child.stderr?.on('data', (chunk: Buffer) => stderr.push(String(chunk)));

    // O carregamento precisa estar de fato pendente; do contrário o teste passaria sem provar nada.
    await expect.poll(() => unfinished.requests()).toBeGreaterThan(0);
    await expect
      .poll(() =>
        app.evaluate(({ BrowserWindow }) =>
          BrowserWindow.getAllWindows().some((window) => window.webContents.isLoading()),
        ),
      )
      .toBe(true);

    // Troca a caixa nativa por um gravador: se o defeito voltar, a chamada aparece sem travar o teste.
    // Registra também a ordem dos eventos de saída; `will-quit` é onde o aplicativo fecha o banco.
    const installed = await app.evaluate(
      ({ app: electronApp, BrowserWindow, dialog }, files) => {
        const fs = process.getBuiltinModule('node:fs');
        const append = (file: string, line: string) => fs.appendFileSync(file, `${line}\n`);
        const recorder = (title: string, content: string): void => {
          append(files.calls, title + '|' + content);
        };
        dialog.showErrorBox = recorder;
        electronApp.on('before-quit', () => append(files.lifecycle, 'before-quit'));
        electronApp.on('will-quit', () => append(files.lifecycle, 'will-quit'));
        for (const window of BrowserWindow.getAllWindows()) {
          window.on('close', () => append(files.lifecycle, 'window-close'));
          window.on('closed', () => append(files.lifecycle, 'window-closed'));
        }
        return dialog.showErrorBox === recorder;
      },
      { calls: showErrorBoxCalls, lifecycle },
    );
    expect(installed).toBe(true);

    // `close` rejeita se o fixture precisar encerrar o processo à força: o defeito não passa em silêncio.
    await close();
    if (child.exitCode === null && child.signalCode === null) await once(child, 'exit');
    if (child.stderr && !child.stderr.readableEnded) await once(child.stderr, 'end');

    expect(existsSync(showErrorBoxCalls)).toBe(false);
    expect(child.signalCode).toBeNull();
    expect(child.exitCode).toBe(0);
    // A saída em andamento terminou pelo caminho normal, que é onde o banco é fechado.
    expect(readFileSync(lifecycle, 'utf8')).toContain('will-quit');
    // A rejeição chegou ao tratamento (prova de que o caminho do defeito foi percorrido) e foi só registrada.
    expect(stderr.join('')).toContain('Carregamento da janela interrompido');
  } finally {
    await unfinished.stop();
  }
});
