import { mkdtempSync, rmSync } from 'node:fs';
import { request as httpRequest } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  HOOK_BODY_LIMIT_BYTES,
  startHookReceiver,
  type HookReceiver,
} from '../../src/terminal-host/hook-receiver';

let dir = '';
let receiver: HookReceiver | undefined;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'ph-receiver-'));
});

afterEach(async () => {
  await receiver?.close();
  receiver = undefined;
  rmSync(dir, { recursive: true, force: true });
});

/** Envia um POST cru ao receptor e devolve o status e o corpo da resposta. */
function post(
  port: number,
  path: string,
  body: Buffer,
  headers: Record<string, string> = {},
): Promise<{ status: number; text: string }> {
  return new Promise((resolve, reject) => {
    const req = httpRequest(
      {
        host: '127.0.0.1',
        port,
        path,
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'content-length': String(body.length),
          ...headers,
        },
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (chunk: Buffer) => chunks.push(chunk));
        res.on('end', () =>
          resolve({ status: res.statusCode ?? 0, text: Buffer.concat(chunks).toString('utf8') }),
        );
      },
    );
    req.on('error', reject);
    req.end(body);
  });
}

async function startWithExecution(id: string) {
  receiver = await startHookReceiver({ logDir: dir });
  const registration = receiver.registerExecution(id);
  const port = receiver.port;
  return { token: registration.token, url: registration.url, port };
}

describe('receptor de hooks', () => {
  it('aceita um evento com o token da execução e devolve o número da sequência', async () => {
    const { token, port } = await startWithExecution('exec-1');

    const response = await post(
      port,
      '/hooks/exec-1',
      Buffer.from(JSON.stringify({ hook_event_name: 'Stop', session_id: 'abc' })),
      { authorization: `Bearer ${token}` },
    );

    expect(response.status).toBe(201);
    expect(JSON.parse(response.text)).toEqual({ seq: 1 });
    expect(receiver?.readAfter('exec-1')).toEqual([
      expect.objectContaining({ seq: 1, payload: { hook_event_name: 'Stop', session_id: 'abc' } }),
    ]);
  });

  it('recusa token errado com 401 e não grava nada', async () => {
    const { port } = await startWithExecution('exec-1');

    const response = await post(port, '/hooks/exec-1', Buffer.from('{}'), {
      authorization: 'Bearer token-errado',
    });

    expect(response.status).toBe(401);
    expect(receiver?.readAfter('exec-1')).toEqual([]);
  });

  it('recusa o token de outra execução com 401', async () => {
    const first = await startWithExecution('exec-1');
    const other = receiver?.registerExecution('exec-2');

    const response = await post(first.port, '/hooks/exec-1', Buffer.from('{}'), {
      authorization: `Bearer ${other?.token ?? ''}`,
    });

    expect(response.status).toBe(401);
  });

  it('recusa uma execução que não foi registrada, com a mesma resposta de token errado', async () => {
    const { token, port } = await startWithExecution('exec-1');

    const response = await post(port, '/hooks/nao-registrada', Buffer.from('{}'), {
      authorization: `Bearer ${token}`,
    });

    expect(response.status).toBe(401);
  });

  it('recusa corpo acima de 1 MB com 413 e não grava nada', async () => {
    const { token, port } = await startWithExecution('exec-1');

    const response = await post(
      port,
      '/hooks/exec-1',
      Buffer.alloc(HOOK_BODY_LIMIT_BYTES + 1, 'a'),
      { authorization: `Bearer ${token}` },
    ).catch(() => ({ status: 0 }));

    // O servidor recusa antes de ler o corpo: o cliente recebe o 413 ou, se ainda estava enviando, a conexão cai.
    expect([413, 0]).toContain(response.status);
    expect(receiver?.readAfter('exec-1')).toEqual([]);
  });

  it('recusa corpo que não é um objeto JSON com 400', async () => {
    const { token, port } = await startWithExecution('exec-1');
    const auth = { authorization: `Bearer ${token}` };

    expect((await post(port, '/hooks/exec-1', Buffer.from('não é json'), auth)).status).toBe(400);
    expect((await post(port, '/hooks/exec-1', Buffer.from('[1,2]'), auth)).status).toBe(400);
    expect((await post(port, '/hooks/exec-1', Buffer.from('null'), auth)).status).toBe(400);
    expect(receiver?.readAfter('exec-1')).toEqual([]);
  });

  it('responde 404 para uma rota que não existe', async () => {
    const { token, port } = await startWithExecution('exec-1');

    expect(
      (await post(port, '/outra-rota', Buffer.from('{}'), { authorization: `Bearer ${token}` }))
        .status,
    ).toBe(404);
  });

  it('escuta em 127.0.0.1 e devolve a URL que o hook deve chamar', async () => {
    receiver = await startHookReceiver({ logDir: dir });
    const registration = receiver.registerExecution('exec-1');

    expect(registration.url).toBe(`http://127.0.0.1:${receiver.port}/hooks/exec-1`);
  });

  it('a sequência e o arquivo sobrevivem ao reinício do receptor', async () => {
    const first = await startWithExecution('exec-1');
    await post(first.port, '/hooks/exec-1', Buffer.from('{"n":1}'), {
      authorization: `Bearer ${first.token}`,
    });
    await post(first.port, '/hooks/exec-1', Buffer.from('{"n":2}'), {
      authorization: `Bearer ${first.token}`,
    });
    await receiver?.close();

    // Reinício: o token de antes não existe mais, então a execução é registrada de novo.
    receiver = await startHookReceiver({ logDir: dir });
    const again = receiver.registerExecution('exec-1');
    const response = await post(receiver.port, '/hooks/exec-1', Buffer.from('{"n":3}'), {
      authorization: `Bearer ${again.token}`,
    });

    expect(JSON.parse(response.text)).toEqual({ seq: 3 });
    expect(receiver.readAfter('exec-1').map((entry) => entry.seq)).toEqual([1, 2, 3]);
  });
});
