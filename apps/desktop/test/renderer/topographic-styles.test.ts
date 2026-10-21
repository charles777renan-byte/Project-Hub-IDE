import { describe, expect, it } from 'vitest';
import { readCss, ruleDeclarations } from './css-rules';

/**
 * Fundo topográfico (TopographicBackground). O que fica sólido e o que fica translúcido é decisão de
 * leitura e de janela: a faixa dos botões do Windows é opaca, então o cabeçalho não pode ser translúcido.
 */
describe('fundo topográfico: estilos', () => {
  const appCss = readCss('app.css');

  it('o fundo fica atrás do conteúdo e não recebe cliques', () => {
    const layer = ruleDeclarations(appCss, '.topo-background');
    expect(layer.get('position')).toBe('absolute');
    expect(layer.get('z-index')).toBe('-1');
    expect(layer.get('pointer-events')).toBe('none');
  });

  it('a janela cria um contexto de empilhamento próprio', () => {
    expect(ruleDeclarations(appCss, '.app-shell').get('isolation')).toBe('isolate');
  });

  it('o cabeçalho continua sólido, porque a faixa dos botões do Windows é opaca', () => {
    expect(ruleDeclarations(appCss, '.app-header').get('background')).toBe('var(--bg)');
  });

  it('painéis e cartões são translúcidos, com a mesma cor-base', () => {
    expect(ruleDeclarations(appCss, ':root').get('--surface-glass')).toBe(
      'color-mix(in srgb, var(--panel) 86%, transparent)',
    );
    expect(ruleDeclarations(appCss, '.panel').get('background')).toBe('var(--surface-glass)');
    expect(ruleDeclarations(appCss, '.mission-card').get('background')).toBe(
      'var(--surface-glass)',
    );
    expect(ruleDeclarations(appCss, '.form').get('background')).toBe('var(--surface-glass)');
  });

  it('a barra lateral é translúcida', () => {
    expect(ruleDeclarations(appCss, '.sidebar').get('background')).toBe(
      'color-mix(in srgb, var(--bg) 80%, transparent)',
    );
  });

  it('blocos de código e de decisão continuam sólidos, para a leitura', () => {
    expect(ruleDeclarations(appCss, '.decision-card pre').get('background')).toBe('var(--bg)');
  });
});
