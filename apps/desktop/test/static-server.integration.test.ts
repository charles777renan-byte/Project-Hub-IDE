import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { request } from 'node:http';
import { connect, createServer, type Server } from 'node:net';
import { networkInterfaces, tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import {
  contentTypeOf,
  createStaticServers,
  type StaticServers,
} from '../src/main/preview/static-server';

const SECRET = 'SEGREDO-QUE-NAO-PODE-SAIR';

let base: string;
let root: string;
let outside: string;
let hasLink = false;
let servers: StaticServers | undefined;
const roots = new Map<string, string>();

beforeAll(() => {
  base = mkdtempSync(join(tmpdir(), 'ph-estatico-'));
  root = join(base, 'site');
  outside = join(base, 'fora');
  mkdirSync(join(root, 'css'), { recursive: true });
  mkdirSync(join(root, 'sub', 'vazia'), { recursive: true });
  mkdirSync(join(root, '.git'), { recursive: true });
  mkdirSync(join(root, 'a', '.b'), { recursive: true });
  mkdirSync(outside, { recursive: true });
  writeFileSync(join(root, 'index.html'), '<h1>Início</h1>');
  writeFileSync(join(root, 'css', 'site.css'), 'body { color: red; }');
  writeFileSync(join(root, 'sub', 'index.html'), '<h1>Sub</h1>');
  writeFileSync(join(root, '.env'), SECRET);
  writeFileSync(join(root, '.git', 'config'), SECRET);
  writeFileSync(join(root, 'a', '.b', 'c.txt'), SECRET);
  writeFileSync(join(root, 'dados.bin'), Buffer.from([0, 1, 2, 3]));
  writeFileSync(join(outside, 'segredo.txt'), SECRET);
  writeFileSync(join(base, 'x'), SECRET);
  try {
    // A junção não pede privilégio no Windows; nos outros sistemas, vira um link comum de pasta.
    symlinkSync(outside, join(root, 'link'), 'junction');
    hasLink = true;
  } catch {
    hasLink = false;
  }
  roots.set('p1', root);
  roots.set('p2', root);
});

afterAll(() => {
  rmSync(base, { recursive: true, force: true });
});

afterEach(async () => {
  await servers?.closeAll();
  servers = undefined;
});

function start(): StaticServers {
  const created = createStaticServers({ rootOf: (projectId) => roots.get(projectId) });
  servers = created;
  return created;
}

type Reply = {
  status: number;
  headers: Record<string, string | string[] | undefined>;
  body: string;
};

function ask(
  port: number,
  path: string,
  options: { method?: string; host?: string } = {},
): Promise<Reply> {
  return new Promise((resolve, reject) => {
    const req = request(
      {
        host: '127.0.0.1',
        port,
        path,
        method: options.method ?? 'GET',
        headers: { Host: options.host ?? `127.0.0.1:${port}` },
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (chunk: Buffer) => chunks.push(chunk));
        res.on('end', () =>
          resolve({
            status: res.statusCode ?? 0,
            headers: res.headers,
            body: Buffer.concat(chunks).toString('utf8'),
          }),
        );
        res.on('error', reject);
      },
    );
    req.on('error', reject);
    req.end();
  });
}

/** Tenta abrir uma conexão TCP; `true` se o outro lado aceitou. */
function connects(host: string, port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = connect({ host, port });
    const done = (value: boolean) => {
      socket.destroy();
      resolve(value);
    };
    socket.setTimeout(1000, () => done(false));
    socket.once('connect', () => done(true));
    socket.once('error', () => done(false));
  });
}

describe('contentTypeOf', () => {
  it.each([
    ['index.html', 'text/html; charset=utf-8'],
    ['a/b/PAGINA.HTM', 'text/html; charset=utf-8'],
    ['site.css', 'text/css; charset=utf-8'],
    ['app.js', 'text/javascript; charset=utf-8'],
    ['app.mjs', 'text/javascript; charset=utf-8'],
    ['dados.json', 'application/json; charset=utf-8'],
    ['logo.svg', 'image/svg+xml'],
    ['foto.png', 'image/png'],
    ['foto.jpeg', 'image/jpeg'],
    ['foto.webp', 'image/webp'],
    ['favicon.ico', 'image/x-icon'],
    ['fonte.woff2', 'font/woff2'],
    ['som.mp3', 'audio/mpeg'],
    ['filme.mp4', 'video/mp4'],
    ['modulo.wasm', 'application/wasm'],
    ['leia.txt', 'text/plain; charset=utf-8'],
    ['dados.bin', 'application/octet-stream'],
    ['sem-extensao', 'application/octet-stream'],
  ])('%s → %s', (path, type) => {
    expect(contentTypeOf(path)).toBe(type);
  });
});

describe('servidor de site estático', () => {
  it('entrega a página inicial com os cabeçalhos de segurança e sem CORS', async () => {
    const { port, origin } = await start().ensure('p1');
    expect(origin).toBe(`http://127.0.0.1:${port}`);

    for (const path of ['/', '/index.html', '/?v=1']) {
      const reply = await ask(port, path);
      expect(reply.status).toBe(200);
      expect(reply.body).toBe('<h1>Início</h1>');
      expect(reply.headers['content-type']).toBe('text/html; charset=utf-8');
      expect(reply.headers['x-content-type-options']).toBe('nosniff');
      expect(reply.headers['cache-control']).toBe('no-store');
      expect(reply.headers['access-control-allow-origin']).toBeUndefined();
    }
  });

  it('entrega arquivos de subpasta com o tipo certo e o index.html da pasta', async () => {
    const { port } = await start().ensure('p1');

    const css = await ask(port, '/css/site.css');
    expect(css.status).toBe(200);
    expect(css.headers['content-type']).toBe('text/css; charset=utf-8');
    expect(css.body).toBe('body { color: red; }');

    const sub = await ask(port, '/sub/');
    expect(sub.status).toBe(200);
    expect(sub.body).toBe('<h1>Sub</h1>');

    const bin = await ask(port, '/dados.bin');
    expect(bin.status).toBe(200);
    expect(bin.headers['content-type']).toBe('application/octet-stream');
    expect(bin.headers['content-length']).toBe('4');
  });

  it('pasta pedida sem a barra final é redirecionada para a forma com barra, dentro do próprio servidor', async () => {
    const { port } = await start().ensure('p1');

    const reply = await ask(port, '/sub');
    expect(reply.status).toBe(302);
    expect(reply.headers.location).toBe('/sub/');

    // Barras repetidas não viram um redirecionamento para outro servidor.
    const doubled = await ask(port, '//sub');
    expect(doubled.status).toBe(302);
    expect(doubled.headers.location).toBe('/sub/');
  });

  it('pasta sem index.html e caminho que não existe respondem 404, sem listar nada', async () => {
    const { port } = await start().ensure('p1');

    for (const path of ['/sub/vazia/', '/nao-existe', '/css/', '/index.html/x']) {
      const reply = await ask(port, path);
      expect(reply.status, path).toBe(404);
      expect(reply.body).not.toContain('site.css');
    }
  });

  it('nunca entrega arquivo de fora da pasta, a pasta .git nem arquivo que começa com ponto', async () => {
    const { port } = await start().ensure('p1');
    const paths = [
      '/../x',
      '/%2e%2e/x',
      '/..%2fx',
      '/..%5cx',
      '/css/..%2f..%2fx',
      '/.env',
      '/%2eenv',
      '/.git/config',
      '/.GIT/config',
      '/a/.b/c.txt',
      '/C:/Windows/win.ini',
      '/index.html::$DATA',
      '/index.html%00.png',
      `/${'a'.repeat(5000)}`,
    ];
    if (hasLink) paths.push('/link/segredo.txt', '/link/');

    for (const path of paths) {
      const reply = await ask(port, path);
      expect([400, 404, 414], path).toContain(reply.status);
      expect(reply.body, path).not.toContain(SECRET);
    }

    // Um caminho mal codificado é pedido inválido, não erro do servidor.
    expect((await ask(port, '/%E0%A4%A')).status).toBe(400);
    // Depois de tudo isso, o servidor continua de pé.
    expect((await ask(port, '/')).status).toBe(200);
  });

  it('só atende pedidos feitos ao próprio endereço local', async () => {
    const { port } = await start().ensure('p1');

    expect((await ask(port, '/', { host: 'evil.test' })).status).toBe(403);
    expect((await ask(port, '/', { host: `evil.test:${port}` })).status).toBe(403);
    expect((await ask(port, '/', { host: `127.0.0.1:${port + 1}` })).status).toBe(403);
    expect((await ask(port, '/', { host: `localhost:${port}` })).status).toBe(200);
    expect((await ask(port, '/', { host: `LOCALHOST:${port}` })).status).toBe(200);
  });

  it('só aceita GET e HEAD', async () => {
    const { port } = await start().ensure('p1');

    for (const method of ['POST', 'PUT', 'DELETE', 'OPTIONS']) {
      const reply = await ask(port, '/', { method });
      expect(reply.status, method).toBe(405);
      expect(reply.headers.allow).toBe('GET, HEAD');
    }

    const head = await ask(port, '/', { method: 'HEAD' });
    expect(head.status).toBe(200);
    expect(head.body).toBe('');
    expect(head.headers['content-type']).toBe('text/html; charset=utf-8');
  });

  it('só escuta no endereço local', async () => {
    const { port } = await start().ensure('p1');

    expect(await connects('127.0.0.1', port)).toBe(true);
    const external = Object.values(networkInterfaces())
      .flatMap((entries) => entries ?? [])
      .filter((entry) => entry.family === 'IPv4' && !entry.internal)
      .map((entry) => entry.address);
    for (const address of external) {
      expect(await connects(address, port), address).toBe(false);
    }
    expect(await connects('::1', port)).toBe(false);
  });
});

describe('createStaticServers', () => {
  it('reaproveita o servidor do projeto, mesmo com dois pedidos ao mesmo tempo', async () => {
    const created = start();

    const [first, second] = await Promise.all([created.ensure('p1'), created.ensure('p1')]);
    const third = await created.ensure('p1');

    expect(second.port).toBe(first.port);
    expect(third.port).toBe(first.port);
    expect(created.originOf('p1')).toBe(first.origin);
  });

  it('cada projeto tem o seu servidor', async () => {
    const created = start();
    const one = await created.ensure('p1');
    const two = await created.ensure('p2');
    expect(two.port).not.toBe(one.port);
  });

  it('volta para a porta pedida quando ela está livre e usa outra quando está ocupada', async () => {
    const created = start();
    const { port } = await created.ensure('p1');
    await created.close('p1');
    expect(created.originOf('p1')).toBeUndefined();

    expect((await created.ensure('p1', port)).port).toBe(port);

    const busy: Server = createServer();
    const busyPort = await new Promise<number>((resolve, reject) => {
      busy.once('error', reject);
      busy.listen(0, '127.0.0.1', () => {
        const address = busy.address();
        if (address === null || typeof address === 'string') reject(new Error('sem porta'));
        else resolve(address.port);
      });
    });
    try {
      const other = await created.ensure('p2', busyPort);
      expect(other.port).not.toBe(busyPort);
      expect((await ask(other.port, '/')).status).toBe(200);
    } finally {
      await new Promise<void>((resolve) => busy.close(() => resolve()));
    }
  });

  it.each([0, -1, 70000, 1.5, Number.NaN])(
    'ignora a porta pedida inválida %s',
    async (preferred) => {
      const { port } = await start().ensure('p1', preferred);
      expect(port).toBeGreaterThan(0);
      expect((await ask(port, '/')).status).toBe(200);
    },
  );

  it('fechar derruba o servidor e esquece o endereço', async () => {
    const created = start();
    const { port } = await created.ensure('p1');

    await created.close('p1');

    expect(created.originOf('p1')).toBeUndefined();
    expect(await connects('127.0.0.1', port)).toBe(false);
    // Fechar o que não existe não é erro.
    await created.close('p1');
    await created.close('nunca-existiu');
  });

  it('projeto sem pasta: recusa criar o servidor', async () => {
    const created = start();
    await expect(created.ensure('sem-pasta')).rejects.toThrow();
    expect(created.originOf('sem-pasta')).toBeUndefined();
  });

  it('projeto que perdeu a pasta depois de aberto responde 404', async () => {
    const created = start();
    roots.set('p3', root);
    const { port } = await created.ensure('p3');
    roots.delete('p3');

    expect((await ask(port, '/')).status).toBe(404);
  });
});
