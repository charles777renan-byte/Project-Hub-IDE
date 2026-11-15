import { request } from 'node:http';
import { afterEach, describe, expect, it } from 'vitest';
import { createAgentBrowser, type AgentPageHandle } from '../src/main/browser/agent/agent-browser';
import { startAgentServer, type AgentServer } from '../src/main/browser/agent/agent-server';
import { createAgentTokens } from '../src/main/browser/agent/agent-tokens';

// O servidor de ferramentas de verdade, numa porta de 127.0.0.1, com o serviço das abas de verdade e páginas
// falsas. As chamadas vão por HTTP, como as de um agente.

type Reply = { status: number; body: string };

/** Uma chamada HTTP crua: deixa o teste mandar o `Host` e o `Origin` que quiser. */
function call(
  url: string,
  options: { method?: string; headers?: Record<string, string>; body?: string } = {},
): Promise<Reply> {
  return new Promise((resolve, reject) => {
    const req = request(
      url,
      { method: options.method ?? 'POST', headers: options.headers ?? {} },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (chunk: Buffer) => chunks.push(chunk));
        res.on('end', () =>
          resolve({ status: res.statusCode ?? 0, body: Buffer.concat(chunks).toString('utf8') }),
        );
      },
    );
    req.on('error', reject);
    req.end(options.body);
  });
}

type Pending = { resolve(): void };

function setup() {
  const tokens = createAgentTokens();
  const pendingLoads: Pending[] = [];
  let hold = false;
  let nextId = 0;
  const browser = createAgentBrowser({
    pages: (_projectId, events) =>
      ({
        load(url: string) {
          events.onChange({ url, title: `título de ${url}`, loading: false });
          if (!hold) return Promise.resolve();
          return new Promise<void>((resolve) => pendingLoads.push({ resolve }));
        },
        text: () => Promise.resolve('texto da página'),
        park: () => undefined,
        show: () => undefined,
        destroy: () => undefined,
      }) as unknown as AgentPageHandle,
    projectExists: () => true,
    terminalTitle: (terminalId) => terminalId,
    previewUrl: () => undefined,
    changed: () => undefined,
    shortcut: () => undefined,
    newId: () => `tab-${++nextId}`,
  });
  return {
    tokens,
    browser,
    pendingLoads,
    holdLoads() {
      hold = true;
    },
  };
}

let server: AgentServer | undefined;
afterEach(async () => {
  await server?.close();
  server = undefined;
});

const JSON_HEADERS = {
  'content-type': 'application/json',
  accept: 'application/json, text/event-stream',
};

function rpc(id: number, method: string, params: unknown = {}): string {
  return JSON.stringify({ jsonrpc: '2.0', id, method, params });
}

async function ask(url: string, token: string, method: string, params: unknown = {}) {
  const reply = await call(url, {
    headers: { ...JSON_HEADERS, authorization: `Bearer ${token}` },
    body: rpc(1, method, params),
  });
  expect(reply.status).toBe(200);
  return JSON.parse(reply.body) as {
    result?: {
      tools?: { name: string }[];
      content?: { type: string; text?: string }[];
      isError?: boolean;
      serverInfo?: { name: string };
    };
    error?: { message: string };
  };
}

const INIT = {
  protocolVersion: '2025-06-18',
  capabilities: {},
  clientInfo: { name: 'teste', version: '0' },
};

describe('servidor de ferramentas do navegador', () => {
  it('escuta só em 127.0.0.1, numa porta escolhida pelo sistema, no caminho /mcp', async () => {
    const { tokens, browser } = setup();
    server = await startAgentServer({ tokens, browser });
    expect(server.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/mcp$/);
  });

  it('recusa quem não traz um token vivo, com corpo vazio', async () => {
    const { tokens, browser } = setup();
    server = await startAgentServer({ tokens, browser });
    const body = rpc(1, 'tools/list');
    const none = await call(server.url, { headers: JSON_HEADERS, body });
    expect(none).toEqual({ status: 401, body: '' });
    const wrong = await call(server.url, {
      headers: { ...JSON_HEADERS, authorization: 'Bearer adivinhado' },
      body,
    });
    expect(wrong).toEqual({ status: 401, body: '' });
    const basic = await call(server.url, {
      headers: { ...JSON_HEADERS, authorization: 'Basic abc' },
      body,
    });
    expect(basic).toEqual({ status: 401, body: '' });

    const token = tokens.issue({ terminalId: 'term-a', projectId: 'p1' });
    tokens.revoke('term-a');
    const revoked = await call(server.url, {
      headers: { ...JSON_HEADERS, authorization: `Bearer ${token}` },
      body,
    });
    expect(revoked).toEqual({ status: 401, body: '' });
  });

  it('recusa a chamada de uma página de navegador: Host trocado ou Origin presente, mesmo com token', async () => {
    const { tokens, browser } = setup();
    server = await startAgentServer({ tokens, browser });
    const token = tokens.issue({ terminalId: 'term-a', projectId: 'p1' });
    const auth = { ...JSON_HEADERS, authorization: `Bearer ${token}` };
    const port = new URL(server.url).port;
    const body = rpc(1, 'tools/list');

    const host = await call(server.url, { headers: { ...auth, host: `localhost:${port}` }, body });
    expect(host).toEqual({ status: 403, body: '' });
    const rebound = await call(server.url, { headers: { ...auth, host: 'evil.test' }, body });
    expect(rebound).toEqual({ status: 403, body: '' });
    const origin = await call(server.url, {
      headers: { ...auth, origin: `http://127.0.0.1:${port}` },
      body,
    });
    expect(origin).toEqual({ status: 403, body: '' });
    const nullOrigin = await call(server.url, { headers: { ...auth, origin: 'null' }, body });
    expect(nullOrigin).toEqual({ status: 403, body: '' });
  });

  it('recusa caminho, método e corpo fora do combinado', async () => {
    const { tokens, browser } = setup();
    server = await startAgentServer({ tokens, browser });
    const token = tokens.issue({ terminalId: 'term-a', projectId: 'p1' });
    const auth = { ...JSON_HEADERS, authorization: `Bearer ${token}` };
    const other = server.url.replace('/mcp', '/outro');

    expect((await call(other, { headers: auth, body: rpc(1, 'tools/list') })).status).toBe(404);
    expect((await call(server.url, { method: 'GET', headers: auth })).status).toBe(405);
    expect((await call(server.url, { method: 'DELETE', headers: auth })).status).toBe(405);
    const huge = await call(server.url, { headers: auth, body: 'x'.repeat(2 * 1024 * 1024) });
    expect(huge.status).toBe(413);
    const broken = await call(server.url, { headers: auth, body: '{não é json' });
    expect(broken.status).toBe(400);
    // Sem token, o caminho errado não diz nem que está errado.
    expect((await call(other, { headers: JSON_HEADERS, body: '' })).status).toBe(401);
  });

  it('com token, apresenta o servidor e as 13 ferramentas', async () => {
    const { tokens, browser } = setup();
    server = await startAgentServer({ tokens, browser });
    const token = tokens.issue({ terminalId: 'term-a', projectId: 'p1' });
    const init = await ask(server.url, token, 'initialize', INIT);
    expect(init.result?.serverInfo?.name).toBe('navegador');
    const list = await ask(server.url, token, 'tools/list');
    expect(list.result?.tools).toHaveLength(13);
    expect(list.result?.tools?.[0]?.name).toBe('browser_tabs');
  });

  it('cada token só enxerga as abas do seu terminal e do seu projeto', async () => {
    const { tokens, browser } = setup();
    server = await startAgentServer({ tokens, browser });
    const a = tokens.issue({ terminalId: 'term-a', projectId: 'p1' });
    const b = tokens.issue({ terminalId: 'term-b', projectId: 'p2' });

    const opened = await ask(server.url, a, 'tools/call', {
      name: 'browser_open',
      arguments: { url: 'http://localhost:1/' },
    });
    expect(opened.result?.isError).not.toBe(true);
    const tab = JSON.parse(opened.result?.content?.[0]?.text ?? '{}') as { id: string };

    const mine = await ask(server.url, a, 'tools/call', { name: 'browser_tabs', arguments: {} });
    expect(JSON.parse(mine.result?.content?.[0]?.text ?? '{}')).toMatchObject({
      tabs: [{ id: tab.id }],
    });
    const theirs = await ask(server.url, b, 'tools/call', { name: 'browser_tabs', arguments: {} });
    expect(JSON.parse(theirs.result?.content?.[0]?.text ?? '{}')).toEqual({ tabs: [] });
    const stolen = await ask(server.url, b, 'tools/call', {
      name: 'browser_read_text',
      arguments: { tabId: tab.id },
    });
    expect(stolen.result?.isError).toBe(true);
    expect(stolen.result?.content?.[0]?.text).toBe('A aba não existe mais.');
  });

  it('entrada inválida e ferramenta desconhecida voltam como erro da chamada, não como queda', async () => {
    const { tokens, browser } = setup();
    server = await startAgentServer({ tokens, browser });
    const token = tokens.issue({ terminalId: 'term-a', projectId: 'p1' });
    const bad = await ask(server.url, token, 'tools/call', {
      name: 'browser_open',
      arguments: { url: 7 },
    });
    expect(bad.result?.isError).toBe(true);
    expect(bad.result?.content?.[0]?.text).toMatch(/^Entrada inválida/);
    const unknown = await ask(server.url, token, 'tools/call', {
      name: 'browser_apagar_tudo',
      arguments: {},
    });
    expect(unknown.result?.isError).toBe(true);
    // O servidor segue de pé.
    expect((await ask(server.url, token, 'tools/list')).result?.tools).toHaveLength(13);
  });

  it('o terminal que morre no meio de uma navegação solta a chamada com erro', async () => {
    const { tokens, browser, pendingLoads, holdLoads } = setup();
    server = await startAgentServer({ tokens, browser });
    const token = tokens.issue({ terminalId: 'term-a', projectId: 'p1' });
    const opened = await ask(server.url, token, 'tools/call', {
      name: 'browser_open',
      arguments: { url: 'http://localhost:1/' },
    });
    const tab = JSON.parse(opened.result?.content?.[0]?.text ?? '{}') as { id: string };

    holdLoads();
    const pending = ask(server.url, token, 'tools/call', {
      name: 'browser_navigate',
      arguments: { tabId: tab.id, url: 'http://localhost:2/' },
    });
    await expect.poll(() => pendingLoads.length).toBe(1);
    tokens.revoke('term-a');
    browser.endTerminal('term-a');

    const reply = await pending;
    expect(reply.result?.isError).toBe(true);
    expect(reply.result?.content?.[0]?.text).toBe('A aba não existe mais.');
    expect(browser.tabsOf('p1')).toEqual([]);
  });
});
