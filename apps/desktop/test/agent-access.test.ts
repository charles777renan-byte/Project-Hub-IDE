import { existsSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createAgentBrowserAccess } from '../src/main/browser/agent/agent-access';
import { createAgentTokens } from '../src/main/browser/agent/agent-tokens';

// O acesso ao navegador que o serviço de terminais recebe: token, lançamento, fim do terminal e limpeza.

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'ph-agent-access-'));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

function setup(options: { url?: string | undefined } = {}) {
  const tokens = createAgentTokens();
  const ended: string[] = [];
  const exits = new Map<string, () => void>();
  const access = createAgentBrowserAccess({
    tokens,
    url: () => ('url' in options ? options.url : 'http://127.0.0.1:4000/mcp'),
    dir,
    endTerminal: (terminalId) => void ended.push(terminalId),
    onExit: (terminalId, exited) => void exits.set(terminalId, exited),
  });
  return { tokens, ended, exits, access };
}

describe('acesso dos terminais ao navegador', () => {
  it('prepara o Claude: emite um token do terminal e do projeto, que só aparece no ambiente', () => {
    const { access, tokens } = setup();
    const launch = access.prepare('term-1', 'p1', 'claude');
    const file = join(dir, 'term-1.mcp.json');
    expect(launch?.args).toEqual(['--mcp-config', file]);
    expect(existsSync(file)).toBe(true);
    const token = launch?.env['PROJECT_HUB_BROWSER_TOKEN'] ?? '';
    expect(tokens.resolve(token)).toEqual({ terminalId: 'term-1', projectId: 'p1' });
    expect(access.isActive('term-1')).toBe(true);
  });

  it('programa sem o recurso não ganha token', () => {
    const { access } = setup();
    expect(access.prepare('term-1', 'p1', 'antigravity')).toBeUndefined();
    expect(access.isActive('term-1')).toBe(false);
    expect(access.supports('antigravity')).toBe(false);
    expect(access.supports('shell')).toBe(false);
    expect(access.supports('claude')).toBe(true);
    expect(access.supports('codex')).toBe(true);
  });

  it('sem servidor no ar, ninguém ganha o navegador e nenhum programa é dado como suportado', () => {
    const { access } = setup({ url: undefined });
    expect(access.prepare('term-1', 'p1', 'claude')).toBeUndefined();
    expect(access.isActive('term-1')).toBe(false);
    expect(access.supports('claude')).toBe(false);
    expect(readdirSync(dir)).toEqual([]);
  });

  it('release revoga o token, fecha as abas do terminal e apaga o arquivo, e pode repetir', () => {
    const { access, tokens, ended } = setup();
    const launch = access.prepare('term-1', 'p1', 'claude');
    const token = launch?.env['PROJECT_HUB_BROWSER_TOKEN'] ?? '';
    access.release('term-1');
    access.release('term-1');
    expect(tokens.resolve(token)).toBeUndefined();
    expect(access.isActive('term-1')).toBe(false);
    expect(ended).toEqual(['term-1', 'term-1']);
    expect(existsSync(join(dir, 'term-1.mcp.json'))).toBe(false);
  });

  it('o terminal que acaba sozinho solta o navegador', () => {
    const { access, exits, ended } = setup();
    access.prepare('term-1', 'p1', 'codex');
    access.opened('term-1');
    exits.get('term-1')?.();
    expect(access.isActive('term-1')).toBe(false);
    expect(ended).toEqual(['term-1']);
  });

  it('falha ao montar o lançamento não deixa token para trás', () => {
    const { access } = setup({ url: 'http://evil.test/mcp' });
    expect(() => access.prepare('term-1', 'p1', 'claude')).toThrow();
    expect(access.isActive('term-1')).toBe(false);
  });

  it('dispose revoga todos e apaga os arquivos de --mcp-config que sobraram na pasta', () => {
    const { access } = setup();
    access.prepare('term-1', 'p1', 'claude');
    access.prepare('term-2', 'p1', 'claude');
    writeFileSync(join(dir, 'antigo.mcp.json'), '{}', 'utf8');
    writeFileSync(join(dir, 'term-1.settings.json'), '{}', 'utf8');
    access.dispose();
    expect(access.isActive('term-1')).toBe(false);
    expect(access.isActive('term-2')).toBe(false);
    // Os arquivos de --settings são de outro dono e ficam.
    expect(readdirSync(dir)).toEqual(['term-1.settings.json']);
  });
});
