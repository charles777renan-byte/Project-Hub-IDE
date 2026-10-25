import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import type { Terminal } from '@xterm/xterm';
import { afterEach, describe, expect, it } from 'vitest';
import {
  E2E_HOOK_KEY,
  registerTerminalForE2e,
} from '../../src/renderer/components/terminals/e2e-hook';

// O gancho que deixa os testes de ponta a ponta lerem o terminal (o WebGL não tem texto no DOM) só pode
// existir quando o Playwright o cria. Estes testes provam que o app sozinho não expõe nada.

const asTerminal = (name: string) => ({ name }) as unknown as Terminal;

afterEach(() => {
  Reflect.deleteProperty(window, E2E_HOOK_KEY);
});

describe('registerTerminalForE2e', () => {
  it('sem o gancho não guarda nada, não cria nada no window e devolve uma função inofensiva', () => {
    const host = document.createElement('div');

    const unregister = registerTerminalForE2e(host, asTerminal('a'));

    expect(Reflect.has(window, E2E_HOOK_KEY)).toBe(false);
    expect(() => unregister()).not.toThrow();
    expect(Reflect.has(window, E2E_HOOK_KEY)).toBe(false);
  });

  it.each([
    ['sem o campo terminals', {}],
    ['com terminals que não é um Map', { terminals: [] }],
    ['com um valor que não é objeto', 'sim'],
  ])('gancho malformado (%s) não vale como gancho', (_nome, hook) => {
    Object.assign(window, { [E2E_HOOK_KEY]: hook });

    const unregister = registerTerminalForE2e(document.createElement('div'), asTerminal('a'));

    expect(() => unregister()).not.toThrow();
  });

  it('com o gancho, guarda o terminal pela área e o tira ao soltar', () => {
    const terminals = new Map<HTMLElement, Terminal>();
    Object.assign(window, { [E2E_HOOK_KEY]: { terminals } });
    const host = document.createElement('div');
    const term = asTerminal('a');

    const unregister = registerTerminalForE2e(host, term);
    expect(terminals.get(host)).toBe(term);

    unregister();
    expect(terminals.size).toBe(0);
  });

  it('soltar o terminal antigo não tira o novo que ocupou a mesma área', () => {
    const terminals = new Map<HTMLElement, Terminal>();
    Object.assign(window, { [E2E_HOOK_KEY]: { terminals } });
    const host = document.createElement('div');
    const old = registerTerminalForE2e(host, asTerminal('velho'));
    const fresh = asTerminal('novo');
    registerTerminalForE2e(host, fresh);

    old();

    expect(terminals.get(host)).toBe(fresh);
  });
});

describe('o gancho de teste não vaza para a produção', () => {
  const SRC = join(import.meta.dirname, '..', '..', 'src');
  const HOOK_FILE = 'renderer/components/terminals/e2e-hook.ts';

  function filesUnder(dir: string): string[] {
    return readdirSync(dir).flatMap((name) => {
      const path = join(dir, name);
      return statSync(path).isDirectory() ? filesUnder(path) : [path];
    });
  }

  it('só o módulo do gancho conhece a chave; preload, processo principal e CSP não', () => {
    const mentions = filesUnder(SRC)
      .filter((path) => readFileSync(path, 'utf8').includes(E2E_HOOK_KEY))
      .map((path) => relative(SRC, path).split(sep).join('/'));

    // A chave aparece só no módulo do gancho. O TerminalView usa a função, nunca a chave.
    expect(mentions).toEqual([HOOK_FILE]);
  });

  it('o preload não ganha método nenhum por causa do gancho', () => {
    const api = readFileSync(join(SRC, 'preload', 'api.ts'), 'utf8');
    const index = readFileSync(join(SRC, 'preload', 'index.ts'), 'utf8');

    expect(api + index).not.toMatch(/e2e/i);
  });

  it('a CSP do renderer e a do processo principal seguem sem unsafe-inline nem unsafe-eval', () => {
    const html = readFileSync(join(SRC, 'renderer', 'index.html'), 'utf8');
    const security = readFileSync(join(SRC, 'main', 'security.ts'), 'utf8');

    for (const text of [html, security]) {
      expect(text).not.toContain('unsafe-inline');
      expect(text).not.toContain('unsafe-eval');
    }
    expect(html).toContain("script-src 'self'");
    expect(html).toContain("style-src 'self'");
  });
});
