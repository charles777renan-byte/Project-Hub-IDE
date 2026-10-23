import { describe, expect, it } from 'vitest';
import { readCss, ruleDeclarations } from './css-rules';

/**
 * Árvore de painéis e painel do workspace (Tarefa 8): sem cartões, sem raio, sem sombra; divisória de
 * 1px com área de pegada de 5px; cabeça de 28px e rodapé de 22px; o terminal enche o corpo. As regras
 * ficam numa seção própria no fim de workspace.css.
 */

describe('árvore de painéis e painel', () => {
  const css = readCss('workspace.css');
  // Os comentários saem na leitura: a seção começa na regra da página do workspace.
  const marker = css.indexOf('.app-main:has(.pane-tree) {');
  const section = marker >= 0 ? css.slice(marker) : '';
  const rule = (selector: string): Map<string, string> => ruleDeclarations(section, selector);

  it('a seção da árvore de painéis existe no fim do arquivo', () => {
    expect(marker).toBeGreaterThan(0);
  });

  it('a cabeça tem 28px e o rodapé 22px, ambos fixos e de uma linha', () => {
    expect(rule('.pane__head').get('height')).toBe('28px');
    expect(rule('.pane__head').get('flex')).toBe('none');
    expect(rule('.pane__foot').get('height')).toBe('22px');
    expect(rule('.pane__foot').get('flex')).toBe('none');
    expect(rule('.pane__foot').get('white-space')).toBe('nowrap');
  });

  it('a divisória desenha 1px em --line e tem 5px de área de pegada', () => {
    const separator = rule('.pane-tree__separator');
    expect(separator.get('background')).toBe('var(--line)');
    expect(separator.get('position')).toBe('relative');
    const grab = ruleDeclarations(section, '.pane-tree__separator::after');
    expect(grab.get('content')).toBe("''");
    expect(grab.get('position')).toBe('absolute');
  });

  it('a pegada vertical e a horizontal medem 5px e o cursor segue a orientação', () => {
    const vertical = ".pane-tree__separator[aria-orientation='vertical']";
    const horizontal = ".pane-tree__separator[aria-orientation='horizontal']";
    expect(rule(vertical).get('width')).toBe('1px');
    expect(rule(vertical).get('cursor')).toBe('col-resize');
    expect(rule(horizontal).get('height')).toBe('1px');
    expect(rule(horizontal).get('cursor')).toBe('row-resize');
    expect(ruleDeclarations(section, `${vertical}::after`).get('inset')).toBe('0 -2px');
    expect(ruleDeclarations(section, `${horizontal}::after`).get('inset')).toBe('-2px 0');
  });

  it('passar o mouse, arrastar e focar acende a linha em --field-line, com anel visível', () => {
    expect(rule('.pane-tree__separator:hover').get('background')).toBe('var(--field-line)');
    expect(rule('.pane-tree__separator:active').get('background')).toBe('var(--field-line)');
    const focus = rule('.pane-tree__separator:focus-visible');
    expect(focus.get('background')).toBe('var(--field-line)');
    expect(focus.get('outline')).toContain('var(--text)');
  });

  it('o painel não tem raio nem sombra que não seja uma linha interna', () => {
    const pane = rule('.pane');
    expect(pane.has('border-radius')).toBe(false);
    expect(pane.get('border')).toBe('0');
    const shadow = pane.get('box-shadow');
    expect(shadow === undefined || /^inset\b/.test(shadow)).toBe(true);
    expect(section).not.toMatch(/border-radius\s*:\s*(?!0)/);
    expect(section).not.toMatch(/box-shadow\s*:\s*(?!inset|none)/);
  });

  it('os nós da árvore enchem o pai sem estourar', () => {
    for (const selector of ['.pane-tree__panel', '.pane-tree__leaf', '.pane-tree__group']) {
      const declarations = rule(selector);
      expect(declarations.get('overflow'), selector).toBe('hidden');
      expect(declarations.get('min-width'), selector).toBe('0');
      expect(declarations.get('min-height'), selector).toBe('0');
    }
  });

  it('o corpo cresce e o espaçamento fica nele, não no terminal', () => {
    const body = rule('.pane__body');
    expect(body.get('flex')).toBe('1');
    expect(body.get('min-height')).toBe('0');
    expect(body.get('padding')).toBe('4px');
    expect(ruleDeclarations(css, '.pane__body .terminal-view').has('padding')).toBe(false);
    expect(ruleDeclarations(css, '.terminal-view').has('padding')).toBe(false);
    expect(rule('.pane__body .terminal-view').get('width')).toBe('100%');
    expect(rule('.pane__body .terminal-view').get('height')).toBe('100%');
  });

  it('a seção só usa as cores neutras do tema', () => {
    expect(section).not.toMatch(/#[0-9a-f]{3,8}\b/i);
    expect(section).not.toMatch(/\b(?:rgba?|hsla?)\(/i);
    const used = [...section.matchAll(/var\(\s*(--[\w-]+)/g)].map(([, name = '']) => name);
    expect(used.length).toBeGreaterThan(0);
    const allowed = new Set(['--bg', '--line', '--field-line', '--muted', '--text']);
    expect(used.filter((name) => !allowed.has(name) && !/^--(?:space|font)/.test(name))).toEqual(
      [],
    );
  });
});
