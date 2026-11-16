import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  BROWSER_PERMISSION,
  BROWSER_PROVIDERS,
  BROWSER_TOKEN_ENV,
  BROWSER_URL_ENV,
  agentLaunchFor,
} from '../src/main/browser/agent/agent-launch';

// O que cada programa recebe para alcançar o servidor do navegador. O token só pode ir pelo ambiente.

const TOKEN = 'tok_SEGREDO-0123456789abcdefghijklmnopqrstuv';
const URL = 'http://127.0.0.1:51234/mcp';

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'ph-agent-launch-'));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

const input = () => ({ dir: join(dir, 'settings'), terminalId: 'term-1', url: URL, token: TOKEN });

describe('lançamento do navegador para cada programa', () => {
  it('só Claude Code e Codex têm o recurso', () => {
    expect(BROWSER_PROVIDERS).toEqual(['claude', 'codex']);
    expect(BROWSER_PERMISSION).toBe('mcp__navegador');
    for (const provider of ['antigravity', 'opencode', 'freebuff', 'shell'] as const) {
      expect(agentLaunchFor(provider, input())).toBeUndefined();
    }
  });

  it('Claude Code: um arquivo de --mcp-config que cita a variável do token, e o token no ambiente', () => {
    const launch = agentLaunchFor('claude', input());
    const file = join(dir, 'settings', 'term-1.mcp.json');
    expect(launch).toEqual({
      args: ['--mcp-config', file],
      env: { [BROWSER_URL_ENV]: URL, [BROWSER_TOKEN_ENV]: TOKEN },
      files: [file],
    });
    const written = readFileSync(file, 'utf8');
    expect(JSON.parse(written)).toEqual({
      mcpServers: {
        navegador: {
          type: 'http',
          url: URL,
          headers: { Authorization: 'Bearer ${PROJECT_HUB_BROWSER_TOKEN}' },
        },
      },
    });
    expect(written).not.toContain(TOKEN);
    expect(JSON.stringify(launch?.args)).not.toContain(TOKEN);
  });

  it('Codex: o endereço e o nome da variável em opções -c, sem arquivo, e o token no ambiente', () => {
    const launch = agentLaunchFor('codex', input());
    expect(launch).toEqual({
      args: [
        '-c',
        `mcp_servers.navegador.url=${URL}`,
        '-c',
        'mcp_servers.navegador.bearer_token_env_var=PROJECT_HUB_BROWSER_TOKEN',
      ],
      env: { [BROWSER_URL_ENV]: URL, [BROWSER_TOKEN_ENV]: TOKEN },
      files: [],
    });
    expect(JSON.stringify(launch?.args)).not.toContain(TOKEN);
  });

  it('recusa endereço que não é o do servidor local e id que não serve de nome de arquivo', () => {
    expect(() => agentLaunchFor('claude', { ...input(), url: 'http://evil.test/mcp' })).toThrow();
    expect(() =>
      agentLaunchFor('codex', { ...input(), url: 'http://127.0.0.1:1/mcp" x' }),
    ).toThrow();
    expect(() => agentLaunchFor('claude', { ...input(), terminalId: '../fora' })).toThrow();
  });
});
