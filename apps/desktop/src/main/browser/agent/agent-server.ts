import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import type { AgentBrowser } from './agent-browser';
import { AGENT_TOOLS } from './agent-tools';
import type { AgentIdentity, AgentTokens } from './agent-tokens';

export type AgentServer = {
  /** `http://127.0.0.1:<porta>/mcp`. */
  url: string;
  close(): Promise<void>;
};

export type AgentServerDeps = { tokens: AgentTokens; browser: AgentBrowser };

const HOST = '127.0.0.1';
const PATH = '/mcp';
/** Maior corpo aceito. Uma chamada de ferramenta é pequena; o maior texto que entra é o de `browser_type`. */
const BODY_MAX = 1024 * 1024;

/** Encerra a resposta sem corpo: a recusa não conta o motivo. */
function refuse(res: ServerResponse, status: number): void {
  res.writeHead(status, { 'content-length': '0', connection: 'close' });
  res.end();
}

function bearerOf(req: IncomingMessage): string | undefined {
  const header = req.headers.authorization;
  if (header === undefined) return undefined;
  const match = /^Bearer ([A-Za-z0-9_-]{1,200})$/.exec(header);
  return match?.[1];
}

/** Lê o corpo até o limite. `null`: passou do limite. */
function readBody(req: IncomingMessage): Promise<string | null> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    let over = false;
    req.on('data', (chunk: Buffer) => {
      if (over) return;
      size += chunk.length;
      if (size > BODY_MAX) {
        over = true;
        chunks.length = 0;
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(over ? null : Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

/**
 * Um servidor MCP para uma chamada, já amarrado a quem a fez. O servidor não guarda sessão: cada pedido traz o
 * token, e é dele que saem o terminal e o projeto. Usa o `Server` de baixo nível da biblioteca, com os schemas
 * escritos por este app, para a lista de ferramentas ser exatamente a de `AGENT_TOOLS`.
 */
function mcpFor(who: AgentIdentity, browser: AgentBrowser): Server {
  const server = new Server(
    { name: 'navegador', version: '1.0.0' },
    { capabilities: { tools: {} } },
  );
  server.setRequestHandler(ListToolsRequestSchema, () =>
    Promise.resolve({
      tools: AGENT_TOOLS.map((tool) => ({
        name: tool.name,
        description: tool.description,
        inputSchema: { type: 'object' as const, ...tool.inputSchema },
      })),
    }),
  );
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const tool = AGENT_TOOLS.find((candidate) => candidate.name === request.params.name);
    if (tool === undefined) {
      return {
        isError: true,
        content: [{ type: 'text' as const, text: 'Essa ferramenta não existe.' }],
      };
    }
    const result = await tool.run(who, request.params.arguments ?? {}, browser);
    if (!result.ok) {
      return { isError: true, content: [{ type: 'text' as const, text: result.message }] };
    }
    if ('image' in result) {
      return {
        content: [
          { type: 'image' as const, data: result.image.base64, mimeType: result.image.mimeType },
        ],
      };
    }
    return { content: [{ type: 'text' as const, text: result.text }] };
  });
  return server;
}

/**
 * Sobe o servidor de ferramentas do navegador, só em `127.0.0.1`, numa porta que o sistema escolhe. Uma chamada
 * só entra com um token vivo, com o `Host` deste servidor e sem `Origin`: as duas últimas barram uma página de
 * navegador que tente chamá-lo (uma página sempre manda `Origin` num POST, e um nome que aponte para cá por DNS
 * chega com outro `Host`). Tudo é conferido antes de ler o corpo.
 */
export async function startAgentServer(deps: AgentServerDeps): Promise<AgentServer> {
  let authority = '';

  const handle = async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    const token = bearerOf(req);
    const who = token === undefined ? undefined : deps.tokens.resolve(token);
    if (who === undefined) return refuse(res, 401);
    if (req.headers.host !== authority || req.headers.origin !== undefined) {
      return refuse(res, 403);
    }
    if (req.url !== PATH) return refuse(res, 404);
    if (req.method !== 'POST') return refuse(res, 405);

    const body = await readBody(req);
    if (body === null) return refuse(res, 413);
    let message: unknown;
    try {
      message = JSON.parse(body);
    } catch {
      return refuse(res, 400);
    }

    const server = mcpFor(who, deps.browser);
    // Sem gerador de sessão, o transporte não guarda estado entre chamadas.
    const transport = new StreamableHTTPServerTransport({ enableJsonResponse: true });
    res.on('close', () => {
      transport.close().catch(() => undefined);
      server.close().catch(() => undefined);
    });
    await server.connect(transport);
    await transport.handleRequest(req, res, message);
  };

  const http = createServer((req, res) => {
    handle(req, res).catch(() => {
      if (!res.headersSent) refuse(res, 500);
      else res.destroy();
    });
  });
  // Uma chamada que espera uma navegação não é cortada pelo tempo padrão de ociosidade.
  http.requestTimeout = 0;

  await new Promise<void>((resolve, reject) => {
    http.once('error', reject);
    http.listen(0, HOST, () => {
      http.off('error', reject);
      resolve();
    });
  });
  const { port } = http.address() as AddressInfo;
  authority = `${HOST}:${String(port)}`;

  return {
    url: `http://${authority}${PATH}`,
    close: () =>
      new Promise<void>((resolve) => {
        http.close(() => resolve());
        http.closeAllConnections();
      }),
  };
}
