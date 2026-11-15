import { createServer, type Server } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { probePort } from '../src/main/preview/port-probe';

let server: Server | undefined;

function listen(): Promise<number> {
  return new Promise((resolve, reject) => {
    const created = createServer((socket) => socket.end());
    server = created;
    created.once('error', reject);
    created.listen(0, '127.0.0.1', () => {
      const address = created.address();
      if (address === null || typeof address === 'string') {
        reject(new Error('sem porta'));
        return;
      }
      resolve(address.port);
    });
  });
}

function close(): Promise<void> {
  return new Promise((resolve) => {
    const current = server;
    server = undefined;
    if (current === undefined) {
      resolve();
      return;
    }
    current.close(() => resolve());
  });
}

afterEach(close);

describe('probePort', () => {
  it('responde verdadeiro com o servidor de pé e falso depois de fechado', async () => {
    const port = await listen();
    expect(await probePort(`http://127.0.0.1:${port}/`, { timeoutMs: 500 })).toBe(true);
    expect(await probePort(`http://localhost:${port}/app?x=1`, { timeoutMs: 500 })).toBe(true);
    await close();
    expect(await probePort(`http://127.0.0.1:${port}/`, { timeoutMs: 500 })).toBe(false);
  });

  it.each(['', 'não é endereço', 'http://', 'file:///C:/x', 'http://localhost:99999/'])(
    'endereço %j responde falso, sem lançar',
    async (url) => {
      expect(await probePort(url, { timeoutMs: 200 })).toBe(false);
    },
  );

  it('só confere endereço local: host de fora responde falso sem abrir conexão', async () => {
    expect(await probePort('http://192.0.2.1:80/', { timeoutMs: 5000 })).toBe(false);
  }, 1000);
});
