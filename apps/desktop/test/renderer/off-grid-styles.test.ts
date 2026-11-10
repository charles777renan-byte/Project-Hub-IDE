import { describe, expect, it } from 'vitest';
import { mediaBlock, readCss, ruleDeclarations } from './css-rules';

/**
 * A faixa "Fora da grade" da barra do workspace (off-grid.css): fichas de 24px, em repouso transparentes e
 * em --muted, com o tom do estado (--warn aguardando, --danger erro), anel de foco do app e um brilho curto na
 * ficha que acabou de chegar, que o "reduzir movimento" desliga. Só tokens: nenhuma cor literal.
 */

describe('o "+N" no cabeçalho do projeto (terminal-tools.css)', () => {
  // O gatilho de ícone do cabeçalho do projeto (project.css) tem 28px de largura e ícone de 16px. O "+N" tem texto
  // e seta: com a largura fixa, a seta saía do botão e ficava por baixo do seletor Grade | Abas.
  const tools = readCss('terminal-tools.css');

  it('o botão tem a largura do conteúdo, e não os 28px do gatilho de ícone do cabeçalho', () => {
    const trigger = ruleDeclarations(
      tools,
      '.project-header__tools .off-grid__more .menu-acoes__gatilho--icone',
    );
    expect(trigger.get('width')).toBe('auto');
    expect(trigger.get('display')).toBe('inline-flex');
    expect(trigger.get('padding')).toBe('0 var(--space-2)');
  });

  it('a seta fica com 12px, e não os 16px do ícone do cabeçalho', () => {
    const arrow = ruleDeclarations(
      tools,
      '.project-header__tools .off-grid__more .menu-acoes__gatilho--icone svg',
    );
    expect(arrow.get('width')).toBe('12px');
    expect(arrow.get('height')).toBe('12px');
  });
});

describe('off-grid.css', () => {
  const css = readCss('off-grid.css');
  const rule = (selector: string): Map<string, string> => ruleDeclarations(css, selector);

  it('o grupo vai para a direita da barra e se encolhe sem estourar', () => {
    expect(rule('.off-grid').get('margin-left')).toBe('auto');
    expect(rule('.off-grid').get('min-width')).toBe('0');
    expect(rule('.off-grid').get('container-type')).toBe('inline-size');
  });

  it('a ficha tem 24px de altura e no máximo 11rem de largura', () => {
    expect(rule('.off-grid__chip').get('height')).toBe('24px');
    expect(rule('.off-grid__chip').get('max-width')).toBe('11rem');
  });

  it('em repouso a ficha é transparente e usa --muted', () => {
    expect(rule('.off-grid__chip').get('background')).toBe('transparent');
    expect(rule('.off-grid__chip').get('color')).toBe('var(--muted)');
  });

  it('com o mouse em cima, o fundo é --line', () => {
    expect(rule('.off-grid__chip:hover').get('background')).toBe('var(--line)');
  });

  it('o foco do teclado desenha o anel de 2px em --focus', () => {
    expect(rule('.off-grid__chip:focus-visible').get('outline')).toBe('2px solid var(--focus)');
  });

  it('aguardando usa --warn e erro usa --danger', () => {
    expect(rule('.off-grid__chip--waiting').get('--tone')).toBe('var(--warn)');
    expect(rule('.off-grid__chip--waiting').get('color')).toContain('var(--warn)');
    expect(rule('.off-grid__chip--error').get('--tone')).toBe('var(--danger)');
    expect(rule('.off-grid__chip--error').get('background')).toContain('var(--danger)');
  });

  it('a ficha que chegou brilha por 420ms e o "reduzir movimento" tira a animação', () => {
    const arriving = rule(".off-grid__chip[data-arriving='true']");
    expect(arriving.get('animation')).toContain('420ms');
    expect(arriving.get('animation')).toContain('var(--ease)');
    expect(css).toMatch(/@keyframes off-grid-arrive/);
    const reduced = mediaBlock(css, '(prefers-reduced-motion: reduce)');
    expect(reduced).toContain("[data-arriving='true']");
    expect(reduced).toMatch(/animation:\s*none/);
  });

  it('com o grupo estreito, o texto "Fora da grade" some e a contagem fica', () => {
    const block = /@container\s*\(max-width:[^)]+\)\s*\{([\s\S]*?\})\s*\}/.exec(css)?.[1] ?? '';
    expect(block).toContain('.off-grid__label-text');
    expect(block).toMatch(/display:\s*none/);
    expect(block).not.toContain('.off-grid__count');
  });

  it('não tem nenhuma cor literal: só tokens', () => {
    expect(css).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
  });
});
