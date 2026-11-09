import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { readCss, ruleDeclarations } from './css-rules';

/**
 * A cápsula das ferramentas dos terminais na faixa do projeto (terminal-tools.css): Grade | Abas e "+ Terminal"
 * juntos, na régua de 28px da faixa, num fundo de cartão com fio. O + de Terminal é ciano (a cor de terminal da
 * identidade); o lima fica com Nova missão. Faltando espaço na faixa, "Terminal" sai e ficam os ícones.
 */

/** O conteúdo do bloco `@container <query> { ... }`, ou texto vazio. */
function containerBlock(css: string, query: string): string {
  const start = css.indexOf(`@container ${query}`);
  if (start < 0) return '';
  const open = css.indexOf('{', start);
  let depth = 0;
  for (let index = open; index < css.length; index += 1) {
    if (css[index] === '{') depth += 1;
    if (css[index] === '}') depth -= 1;
    if (depth === 0) return css.slice(open + 1, index);
  }
  return '';
}

describe('terminal-tools.css', () => {
  const css = readCss('terminal-tools.css');
  const rule = (selector: string): Map<string, string> => ruleDeclarations(css, selector);

  it('é ligado depois do off-grid.css, para vencer as medidas da barra antiga', () => {
    const html = readFileSync(resolve(import.meta.dirname, '../../src/renderer/index.html'), 'utf8');
    const offGrid = html.indexOf('./styles/off-grid.css');
    const tools = html.indexOf('./styles/terminal-tools.css');
    expect(offGrid).toBeGreaterThan(0);
    expect(tools).toBeGreaterThan(offGrid);
  });

  it('a cápsula é um cartão de 32px com fio, e os controles dentro dela têm 28px', () => {
    const capsule = rule('.workspace__controls');
    expect(capsule.get('height')).toBe('32px');
    expect(capsule.get('background')).toBe('var(--surface)');
    expect(capsule.get('box-shadow')).toBe('inset 0 0 0 1px var(--line)');
    expect(rule('.workspace__controls .workspace__layout-btn').get('height')).toBe('28px');
    expect(rule('.workspace__controls .workspace__open').get('height')).toBe('28px');
  });

  it('o fio entre o seletor e o gatilho é a divisória do tema', () => {
    const sep = rule('.workspace__controls-sep');
    expect(sep.get('width')).toBe('1px');
    expect(sep.get('background')).toBe('var(--line)');
  });

  it('o + de Terminal é ciano, e o lima não aparece aqui', () => {
    expect(rule('.workspace__controls .workspace__open > svg:first-child').get('color')).toBe(
      'var(--cyan)',
    );
    expect(css).not.toContain('var(--accent)');
    expect(css).not.toContain('var(--lime)');
    expect(css).not.toMatch(/#[0-9a-f]{3,8}\b/i);
  });

  it('a barra só cresce na faixa quando há terminais fora da grade', () => {
    expect(rule('.project-header__tools .workspace__toolbar').get('flex')).toBe('0 1 auto');
    expect(rule('.project-header__tools .workspace__toolbar:has(.off-grid)').get('flex')).toBe(
      '1 1 auto',
    );
  });

  it('com a faixa estreita, "Terminal" sai e o gatilho fica só com os ícones', () => {
    const narrow = containerBlock(css, 'project-header (max-width: 860px)');
    expect(ruleDeclarations(narrow, '.workspace__controls .workspace__open-label').get('display')).toBe(
      'none',
    );
  });
});
