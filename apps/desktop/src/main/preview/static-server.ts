import { createReadStream } from 'node:fs';
import { realpath, stat } from 'node:fs/promises';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { extname, relative, sep } from 'node:path';
import { resolveInProject } from '../files/resolve-in-project';

/** O único endereço em que o servidor escuta. */
const HOST = '127.0.0.1';

/** Maior caminho de pedido aceito. Um site estático não tem endereço desse tamanho. */
const URL_MAX = 2048;

const TEXT = '; charset=utf-8';

/** Tipo de conteúdo por extensão. O que não está aqui vai como `application/octet-stream`. */
const CONTENT_TYPES: Readonly<Record<string, string>> = {
  '.html': `text/html${TEXT}`,
  '.htm': `text/html${TEXT}`,
  '.css': `text/css${TEXT}`,
  '.js': `text/javascript${TEXT}`,
  '.mjs': `text/javascript${TEXT}`,
  '.json': `application/json${TEXT}`,
  '.map': `application/json${TEXT}`,
  '.webmanifest': `application/manifest+json${TEXT}`,
  '.txt': `text/plain${TEXT}`,
  '.md': `text/plain${TEXT}`,
  '.csv': `text/csv${TEXT}`,
  '.xml': `application/xml${TEXT}`,
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.bmp': 'image/bmp',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.otf': 'font/otf',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.ogg': 'audio/ogg',
  '.m4a': 'audio/mp4',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.wasm': 'application/wasm',
};

export function contentTypeOf(path: string): string {
  return CONTENT_TYPES[extname(path).toLowerCase()] ?? 'application/octet-stream';
}

export type StaticServers = {
  /** O servidor do projeto, criado no primeiro uso. Tenta `preferredPort`; ocupada, usa uma porta livre. */
  ensure(projectId: string, preferredPort?: number): Promise<{ origin: string; port: number }>;
  /** A origem do servidor do projeto, se ele está de pé. */
  originOf(projectId: string): string | undefined;
  close(projectId: string): Promise<void>;
  closeAll(): Promise<void>;
};

type Running = { server: Server; origin: string; port: number };

function isPort(value: number | undefined): value is number {
  return value !== undefined && Number.isInteger(value) && value >= 1 && value <= 65535;
}

/** Abre a escuta em `port` (0 = qualquer porta livre) e devolve a porta que valeu. */
function listen(server: Server, port: number): Promise<number> {
  return new Promise((resolve, reject) => {
    const onError = (error: Error) => reject(error);
    server.once('error', onError);
    server.listen(port, HOST, () => {
      server.off('error', onError);
      const address = server.address();
      if (address === null || typeof address === 'string') reject(new Error('Servidor sem porta.'));
      else resolve(address.port);
    });
  });
}

function shut(server: Server): Promise<void> {
  return new Promise((resolve) => {
    server.close(() => resolve());
    // As conexões abertas (uma página carregando) não seguram o fechamento.
    server.closeAllConnections();
  });
}

/** Responde sem corpo. Os cabeçalhos de segurança já foram postos por quem chama. */
function refuse(res: ServerResponse, status: number, headers: Record<string, string> = {}): void {
  res.writeHead(status, { ...headers, 'Content-Length': '0' });
  res.end();
}

/**
 * Os segmentos do caminho pedido, já decodificados, ou o código da recusa. Qualquer segmento que começa com
 * ponto é recusado aqui: `..`, `.git`, `.env`, `.vscode`. O resto da conferência (unidade, `\`, link que sai
 * da pasta) é de `resolveInProject`.
 */
function segmentsOf(url: string): { segments: string[]; isDir: boolean } | number {
  if (url.length > URL_MAX) return 414;
  if (!url.startsWith('/')) return 400;
  const raw = url.split('?', 1)[0] ?? '/';
  let decoded: string;
  try {
    decoded = decodeURIComponent(raw);
  } catch {
    return 400;
  }
  const segments = decoded.split('/').filter((segment) => segment !== '');
  if (segments.some((segment) => segment.startsWith('.'))) return 404;
  return { segments, isDir: decoded.endsWith('/') };
}

/** O caminho real de `segments` dentro de `root`, ou `undefined` se ele sai da pasta ou passa por nome com ponto. */
async function locate(root: string, segments: readonly string[]): Promise<string | undefined> {
  try {
    const target = await resolveInProject(root, segments.join('/'), { allowRoot: true });
    // Um link de dentro da pasta pode apontar para uma pasta com ponto: o nome real também é conferido.
    const real = relative(await realpath(root), target);
    if (real !== '' && real.split(sep).some((segment) => segment.startsWith('.'))) return undefined;
    return target;
  } catch {
    return undefined;
  }
}

async function kindOf(
  path: string,
): Promise<{ kind: 'file'; size: number } | { kind: 'dir' } | undefined> {
  try {
    const info = await stat(path);
    if (info.isFile()) return { kind: 'file', size: info.size };
    return info.isDirectory() ? { kind: 'dir' } : undefined;
  } catch {
    return undefined;
  }
}

async function serve(
  req: IncomingMessage,
  res: ServerResponse,
  root: string | undefined,
  port: number,
): Promise<void> {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Cache-Control', 'no-store');

  if (req.method !== 'GET' && req.method !== 'HEAD') {
    refuse(res, 405, { Allow: 'GET, HEAD' });
    return;
  }
  // Um site de fora pode apontar um nome dele para 127.0.0.1; o nome pedido precisa ser o deste servidor.
  const host = (req.headers.host ?? '').toLowerCase();
  if (host !== `${HOST}:${port}` && host !== `localhost:${port}`) {
    refuse(res, 403);
    return;
  }
  const parsed = segmentsOf(req.url ?? '/');
  if (typeof parsed === 'number') {
    refuse(res, parsed);
    return;
  }
  if (root === undefined) {
    refuse(res, 404);
    return;
  }

  let { segments } = parsed;
  let target = await locate(root, segments);
  let found = target === undefined ? undefined : await kindOf(target);
  if (found?.kind === 'dir') {
    if (!parsed.isDir && segments.length > 0) {
      // Sem a barra final, os endereços relativos da página apontariam para a pasta de cima. O destino é montado
      // dos segmentos já conferidos, e nunca do texto pedido: começa sempre com uma barra só.
      refuse(res, 302, { Location: `/${segments.map(encodeURIComponent).join('/')}/` });
      return;
    }
    segments = [...segments, 'index.html'];
    target = await locate(root, segments);
    found = target === undefined ? undefined : await kindOf(target);
  }
  if (target === undefined || found?.kind !== 'file') {
    refuse(res, 404);
    return;
  }

  res.writeHead(200, {
    'Content-Type': contentTypeOf(target),
    'Content-Length': String(found.size),
  });
  if (req.method === 'HEAD') {
    res.end();
    return;
  }
  const stream = createReadStream(target);
  // O arquivo pode sumir ou ser trocado no meio da entrega: a conexão cai, o processo não.
  stream.on('error', () => res.destroy());
  res.on('close', () => stream.destroy());
  stream.pipe(res);
}

/**
 * Os servidores de site estático, um por projeto, no processo principal. Cada um só escuta em `127.0.0.1`, só
 * atende `GET` e `HEAD` feitos ao próprio endereço e só entrega arquivo de dentro da pasta do projeto.
 */
export function createStaticServers(deps: {
  rootOf(projectId: string): string | undefined;
}): StaticServers {
  const running = new Map<string, Running>();
  const starting = new Map<string, Promise<Running>>();

  async function open(projectId: string, preferredPort: number | undefined): Promise<Running> {
    if (deps.rootOf(projectId) === undefined) throw new Error('Projeto sem pasta.');
    let port = 0;
    const create = () =>
      createServer((req, res) => {
        // A pasta é lida a cada pedido: um projeto removido para de ser servido na hora.
        serve(req, res, deps.rootOf(projectId), port).catch(() => {
          if (res.headersSent) res.destroy();
          else refuse(res, 500);
        });
      });

    let server = create();
    try {
      port = await listen(server, isPort(preferredPort) ? preferredPort : 0);
    } catch (error) {
      if (!isPort(preferredPort)) throw error;
      // A porta da última vez está ocupada: vale qualquer porta livre.
      server = create();
      port = await listen(server, 0);
    }
    const entry = { server, port, origin: `http://${HOST}:${port}` };
    running.set(projectId, entry);
    return entry;
  }

  async function ensure(
    projectId: string,
    preferredPort?: number,
  ): Promise<{ origin: string; port: number }> {
    // Sem `await` até a promessa estar guardada: dois pedidos seguidos caem no mesmo servidor.
    let pending = starting.get(projectId);
    const current = running.get(projectId);
    if (current === undefined && pending === undefined) {
      pending = open(projectId, preferredPort).finally(() => starting.delete(projectId));
      starting.set(projectId, pending);
    }
    const entry = current ?? (await pending);
    if (entry === undefined) throw new Error('Servidor sem porta.');
    return { origin: entry.origin, port: entry.port };
  }

  async function close(projectId: string): Promise<void> {
    // Um servidor ainda subindo é esperado, para não sobrar aberto depois do fechamento.
    const entry = running.get(projectId) ?? (await starting.get(projectId)?.catch(() => undefined));
    if (entry === undefined) return;
    running.delete(projectId);
    await shut(entry.server);
  }

  return {
    ensure,
    originOf: (projectId) => running.get(projectId)?.origin,
    close,
    async closeAll() {
      const ids = new Set([...running.keys(), ...starting.keys()]);
      await Promise.all([...ids].map((id) => close(id)));
    },
  };
}
