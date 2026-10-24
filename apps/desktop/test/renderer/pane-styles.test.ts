import { describe, expect, it } from 'vitest';
import { readCss, ruleDeclarations } from './css-rules';

/**
 * Árvore de painéis e painel do workspace (identidade visual, Tarefa 7): cada painel é um cartão
 * (--surface, raio de cartão, contorno de 1px por sombra interna) com 8px de vão entre os cartões; as
 * divisórias são vãos transparentes de 8px, com um traço no meio ao passar o mouse, arrastar ou focar;
 * o xterm fica num fundo opaco --bg (#080614), com margem de 4px, sem o brilho da casca sob o texto.
 * Cabeça de 28px e rodapé de 22px. As regras ficam numa seção própria no fim de workspace.css.
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

  it('a divisória é um vão transparente de 8px, e o mouse segue a orientação', () => {
    const separator = rule('.pane-tree__separator');
    expect(separator.get('background')).toBe('transparent');
    expect(separator.get('position')).toBe('relative');
    expect(separator.get('flex')).toBe('none');
    const vertical = ".pane-tree__separator[aria-orientation='vertical']";
    const horizontal = ".pane-tree__separator[aria-orientation='horizontal']";
    expect(rule(vertical).get('width')).toBe('8px');
    expect(rule(vertical).get('cursor')).toBe('col-resize');
    expect(rule(horizontal).get('height')).toBe('8px');
    expect(rule(horizontal).get('cursor')).toBe('row-resize');
  });

  it('passar o mouse, arrastar e focar acende um traço de 2px em --field-line no meio do vão', () => {
    const vertical = ".pane-tree__separator[aria-orientation='vertical']";
    const horizontal = ".pane-tree__separator[aria-orientation='horizontal']";
    for (const state of [':hover', ':active', ':focus-visible']) {
      expect(rule(`${vertical}${state}`).get('background'), vertical + state).toBe(
        'linear-gradient(var(--field-line), var(--field-line)) center / 2px 100% no-repeat',
      );
      expect(rule(`${horizontal}${state}`).get('background'), horizontal + state).toBe(
        'linear-gradient(var(--field-line), var(--field-line)) center / 100% 2px no-repeat',
      );
    }
    // Foco por teclado: o anel lima do sistema, no vão entre os cartões.
    expect(rule('.pane-tree__separator:focus-visible').get('outline')).toContain('var(--focus)');
  });

  it('o painel é um cartão: --surface, raio de cartão e contorno de 1px por sombra interna', () => {
    const pane = rule('.pane');
    expect(pane.get('border-radius')).toBe('var(--radius-card)');
    expect(pane.get('background')).toBe('var(--surface)');
    expect(pane.get('border')).toBe('0');
    // Corta o conteúdo no raio do cartão.
    expect(pane.get('overflow')).toBe('hidden');
    expect(pane.get('box-shadow')).toBe('inset 0 0 0 1px var(--line)');
    // Só sombras internas: uma externa seria cortada pelo overflow da árvore.
    expect(section).not.toMatch(/box-shadow\s*:\s*(?!inset|none|\s)/);
  });

  it('o painel ativo ganha o contorno em --muted (3:1); o foco do teclado, o anel --focus no cartão', () => {
    expect(rule(".pane[data-active='true']").get('box-shadow')).toBe(
      'inset 0 0 0 1px var(--muted)',
    );
    // Mesma especificidade: o anel de foco só vence o contorno do painel ativo se vier depois dele.
    expect(css.indexOf('.pane:focus-within')).toBeGreaterThan(
      css.indexOf(".pane[data-active='true']"),
    );
    // O anel vai no cartão (o xterm tem `outline: none` no CSS vendorizado): vale para o terminal e
    // para os botões do painel, e o próprio cartão (tabindex -1) não desenha outline.
    expect(rule('.pane:focus-within').get('box-shadow')).toBe('inset 0 0 0 2px var(--focus)');
    expect(rule('.pane:focus').get('outline')).toBe('none');
  });

  it('os nós da árvore enchem o pai sem estourar', () => {
    for (const selector of ['.pane-tree__panel', '.pane-tree__leaf', '.pane-tree__group']) {
      const declarations = rule(selector);
      expect(declarations.get('overflow'), selector).toBe('hidden');
      expect(declarations.get('min-width'), selector).toBe('0');
      expect(declarations.get('min-height'), selector).toBe('0');
    }
  });

  it('o corpo é o fundo opaco do terminal (--bg = #080614), com margem de 4px e o respiro dentro', () => {
    const body = rule('.pane__body');
    expect(body.get('flex')).toBe('1');
    expect(body.get('min-height')).toBe('0');
    expect(body.get('background')).toBe('var(--bg)');
    expect(body.get('margin')).toBe('0 4px 4px');
    expect(body.get('padding')).toBe('4px');
    expect(body.get('border-radius')).toBe('var(--radius)');
    expect(body.get('overflow')).toBe('hidden');
    // O --bg do tema é o mesmo preto que o TerminalView entrega ao xterm.
    expect(ruleDeclarations(readCss('tokens.css'), ':root').get('--bg')).toBe('#080614');
  });

  it('o terminal não ganha padding nem muda de medida: o respiro fica no corpo', () => {
    expect(ruleDeclarations(css, '.pane__body .terminal-view').has('padding')).toBe(false);
    expect(ruleDeclarations(css, '.terminal-view').has('padding')).toBe(false);
    expect(rule('.pane__body .terminal-view').get('width')).toBe('100%');
    expect(rule('.pane__body .terminal-view').get('height')).toBe('100%');
  });

  it('a regra do xterm que preserva os espaços continua (célula só de espaço não colapsa)', () => {
    const rows = ruleDeclarations(readCss('app.css'), '.terminal-view .xterm-rows');
    expect(rows.get('white-space')).toBe('pre');
    // O viewport do xterm vem preto puro do xterm.css: a sobra abaixo da última linha usa o mesmo --bg do corpo.
    expect(
      ruleDeclarations(readCss('app.css'), '.terminal-view .xterm-viewport').get(
        'background-color',
      ),
    ).toBe('var(--bg)');
    // O xterm não tem padding próprio: o ajuste mede o contêiner, e um padding dele empurraria a última
    // coluna para fora da borda do fundo opaco (texto colado na borda).
    expect(ruleDeclarations(readCss('app.css'), '.terminal-view .xterm').get('padding')).toBe('0');
  });

  it('a seção só usa as cores neutras do tema', () => {
    expect(section).not.toMatch(/#[0-9a-f]{3,8}\b/i);
    expect(section).not.toMatch(/\b(?:rgba?|hsla?)\(/i);
    const used = [...section.matchAll(/var\(\s*(--[\w-]+)/g)].map(([, name = '']) => name);
    expect(used.length).toBeGreaterThan(0);
    // --focus: o anel de foco lima é o mesmo em toda a interface (identidade visual).
    // --surface: o fundo do cartão. --radius*: raios, que não são cor.
    const allowed = new Set([
      '--bg',
      '--surface',
      '--line',
      '--field-line',
      '--muted',
      '--text',
      '--focus',
    ]);
    expect(
      used.filter((name) => !allowed.has(name) && !/^--(?:space|font|radius)/.test(name)),
    ).toEqual([]);
  });

  it('o aviso da sessão encerrada é flex e as ações não encolhem (Limpar painel não é cortado)', () => {
    expect(rule('.pane__notice').get('display')).toBe('flex');
    expect(rule('.pane__notice > span:first-child').get('min-width')).toBe('0');
    expect(rule('.pane__actions').get('flex')).toBe('none');
  });

  it('o estado vazio é centrado e em --muted; no painel, o texto tem respiro e não encosta na borda', () => {
    const empty = rule('.empty-state');
    expect(empty.get('display')).toBe('flex');
    expect(empty.get('flex-direction')).toBe('column');
    expect(empty.get('align-items')).toBe('center');
    expect(empty.get('color')).toBe('var(--muted)');
    expect(rule('.empty-state .empty-state__title').get('color')).toBe('var(--text)');
    expect(rule('.empty-state .empty-state__hint').get('overflow-wrap')).toBe('anywhere');
    // O "… não foi encontrado no PATH" ficava colado na borda esquerda do painel.
    expect(rule('.pane__launcher').get('padding')).toBe('0');
    expect(rule(".pane__launcher [role='alert']").get('padding')).toBe('0 var(--space-3)');
  });
});
