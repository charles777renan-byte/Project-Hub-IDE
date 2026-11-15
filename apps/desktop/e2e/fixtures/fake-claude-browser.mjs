// CLI falso do `claude` aberto pelo menu "Abrir terminal", para os testes de ponta a ponta dos agentes no navegador.
// Roda no Node do PATH (`APP_PANEL_CLAUDE_SCRIPT`, só com `PROJECT_HUB_ENV=test`). Faz o que o Claude Code faria com
// o que o app entrega ao abrir o terminal: lê o arquivo de `--mcp-config`, troca `${VARIÁVEL}` pelo valor do
// ambiente e fala com o servidor de ferramentas do navegador por HTTP.
//
// O teste comanda as chamadas por arquivos numa pasta de troca (a pasta temporária do sistema, com o nome da pasta
// do projeto): grava `roteiro-<n>.json` com `{ name, arguments }`, e este script responde em `saida-<n>.json` com
// `{ isError, text, image }`. `__sair` grava `fim.json` e encerra o processo (o teste pede isso antes de fechar o
// app: com o processo do terminal vivo, o app aberto pelo Playwright não termina de fechar). O arquivo `acesso.json` leva o endereço e o token deste
// terminal, só para o teste conferir que um token revogado deixa de valer: o app de verdade nunca grava o token.

import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';

const args = process.argv.slice(2);
const valueOf = (flag) => {
  const at = args.indexOf(flag);
  return at === -1 ? undefined : args[at + 1];
};

const settingsFile = valueOf('--settings');
const settings = settingsFile === undefined ? {} : JSON.parse(readFileSync(settingsFile, 'utf8'));
for (const group of settings.hooks?.SessionStart ?? []) {
  for (const hook of group.hooks) {
    spawnSync(hook.command, {
      shell: true,
      input: JSON.stringify({
        hook_event_name: 'SessionStart',
        session_id: randomUUID(),
        cwd: process.cwd(),
        source: 'startup',
      }),
      env: process.env,
      stdio: ['pipe', 'ignore', 'ignore'],
    });
  }
}

const exchange = join(tmpdir(), 'ph-fake-agent', basename(process.cwd()));
mkdirSync(exchange, { recursive: true });
const write = (name, value) => {
  const target = join(exchange, name);
  writeFileSync(`${target}.tmp`, JSON.stringify(value));
  renameSync(`${target}.tmp`, target);
};

const configFile = valueOf('--mcp-config');
if (configFile === undefined) {
  console.log('claude-falso: sem navegador');
  setInterval(() => undefined, 1000);
} else {
  const expand = (text) =>
    text.replace(/\$\{([A-Z0-9_]+)\}/g, (_all, name) => process.env[name] ?? '');
  const server = JSON.parse(readFileSync(configFile, 'utf8')).mcpServers.navegador;
  const url = expand(server.url);
  const headers = Object.fromEntries(
    Object.entries(server.headers ?? {}).map(([key, value]) => [key, expand(value)]),
  );
  let id = 0;
  const rpc = async (method, params) => {
    id += 1;
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        ...headers,
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
      },
      body: JSON.stringify({ jsonrpc: '2.0', id, method, params }),
    });
    if (!response.ok) throw new Error(`HTTP ${String(response.status)}`);
    const body = await response.json();
    if (body.error !== undefined) throw new Error(body.error.message);
    return body.result;
  };

  const call = async ({ name, arguments: input }) => {
    try {
      const result = await rpc('tools/call', { name, arguments: input ?? {} });
      const content = result.content ?? [];
      return {
        isError: result.isError === true,
        text: content.find((part) => part.type === 'text')?.text ?? null,
        image: content.find((part) => part.type === 'image')?.data ?? null,
      };
    } catch (error) {
      return {
        isError: true,
        text: `falha na chamada: ${String(error?.message ?? error)}`,
        image: null,
      };
    }
  };

  const init = await rpc('initialize', {
    protocolVersion: '2025-06-18',
    capabilities: {},
    clientInfo: { name: 'claude-falso', version: '0' },
  });
  const tools = await rpc('tools/list', {});
  write('acesso.json', {
    url,
    token: (headers.Authorization ?? '').replace(/^Bearer /, ''),
    server: init.serverInfo?.name ?? null,
    tools: tools.tools.map((tool) => tool.name),
    permission: settings.permissions?.allow ?? [],
  });
  console.log('claude-falso: pronto');

  let next = 1;
  const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  for (;;) {
    const file = join(exchange, `roteiro-${String(next)}.json`);
    if (!existsSync(file)) {
      await wait(50);
      continue;
    }
    const step = JSON.parse(readFileSync(file, 'utf8'));
    if (step.name === '__sair') {
      write('fim.json', {});
      process.exit(0);
    }
    write(`saida-${String(next)}.json`, await call(step));
    next += 1;
  }
}
