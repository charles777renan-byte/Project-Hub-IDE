import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Forma do painel (Tarefa 2 do plano da interface do workspace): faixa de 3px na cor do acento,
 * raio de 12px por um token próprio e uma classe `panel--<acento>` por acento. O teste lê os CSS de
 * verdade e confere as regras por texto, então trocar o token de um acento ou o raio derruba-o.
 */

const stylesDirectory = resolve(import.meta.dirname, '../../src/renderer/styles');
const readCss = (name: string) =>
  readFileSync(join(stylesDirectory, name), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');

const ACCENTS = ['violet', 'red', 'blue', 'magenta', 'orange', 'lime', 'cyan', 'yellow'] as const;

/** As declarações da regra cujo seletor é exatamente `selector` (sem agrupar com outros). */
function ruleDeclarations(css: string, selector: string): Map<string, string> {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = new RegExp(`(?:^|\\})\\s*${escaped}\\s*\\{([^}]*)\\}`).exec(css);
  const found = new Map<string, string>();
  for (const [, name, value] of (match?.[1] ?? '').matchAll(
    /([\w-]+)\s*:\s*([^;]+?)\s*(?:;|$)/g,
  )) {
    if (name !== undefined && value !== undefined) {
      found.set(name, value);
    }
  }
  return found;
}

describe('forma do painel', () => {
  const appCss = readCss('app.css');
  const tokensCss = readCss('tokens.css');

  it('define --radius-panel como 12px e mantém --radius em 2px', () => {
    const root = ruleDeclarations(tokensCss, ':root');
    expect(root.get('--radius-panel')).toBe('12px');
    expect(root.get('--radius')).toBe('2px');
  });

  it.each(ACCENTS)('panel--%s aponta --panel-accent para o token do acento', (accent) => {
    expect(ruleDeclarations(appCss, `.panel--${accent}`).get('--panel-accent')).toBe(
      `var(--${accent})`,
    );
  });

  it('.panel usa --radius-panel, a borda e a faixa de 3px na cor do acento', () => {
    const panel = ruleDeclarations(appCss, '.panel');
    expect(panel.get('border-radius')).toBe('var(--radius-panel)');
    expect(panel.get('border')).toBe('1px solid var(--line)');
    expect(panel.get('border-top')).toBe('3px solid var(--panel-accent)');
    expect(panel.get('background')).toBe('var(--panel)');
    expect(panel.get('min-height')).toBe('0');
    expect(panel.get('overflow')).toBe('hidden');
  });

  it('o ponto usa a cor do acento e o corpo rola sem estourar o painel', () => {
    expect(ruleDeclarations(appCss, '.panel__dot').get('background')).toBe('var(--panel-accent)');
    const body = ruleDeclarations(appCss, '.panel__body');
    expect(body.get('overflow')).toBe('auto');
    expect(body.get('min-height')).toBe('0');
  });
});
