import { describe, expect, it } from 'vitest';
import { readCss, ruleDeclarations } from './css-rules';

/**
 * Fundo topográfico (TopographicBackground). O que fica sólido e o que fica translúcido é decisão de
 * leitura e de janela: a faixa dos botões do Windows é opaca, então a barra superior não pode ser translúcida.
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
    expect(ruleDeclarations(readCss('workspace.css'), '.app-shell').get('isolation')).toBe(
      'isolate',
    );
  });

  it('a barra superior continua sólida, porque a faixa dos botões do Windows é opaca', () => {
    expect(ruleDeclarations(readCss('workspace.css'), '.topbar').get('background')).toBe(
      'var(--bg)',
    );
  });

  // Atualizado na identidade visual (Tarefa 5): .panel passou a cartão opaco (--surface); os demais
  // cartões das telas antigas seguem translúcidos até a camada 2.
  it('cartões das telas antigas são translúcidos, com a mesma cor-base; o painel é opaco', () => {
    expect(ruleDeclarations(appCss, ':root').get('--surface-glass')).toBe(
      'color-mix(in srgb, var(--panel) 86%, transparent)',
    );
    expect(ruleDeclarations(appCss, '.panel').get('background')).toBe('var(--surface)');
    expect(ruleDeclarations(appCss, '.mission-card').get('background')).toBe(
      'var(--surface-glass)',
    );
    expect(ruleDeclarations(appCss, '.form').get('background')).toBe('var(--surface-glass)');
  });

  // Atualizado (Tarefa 5): a barra lateral virou cartão opaco; o canvas é opaco (pinta --bg), então o
  // brilho do app é desenhado por cima dele, numa camada do próprio fundo topográfico.
  it('a barra lateral é opaca e o brilho do app aparece sobre o fundo topográfico', () => {
    expect(ruleDeclarations(readCss('workspace.css'), '.sidebar').get('background')).toBe(
      'var(--surface)',
    );
    expect(ruleDeclarations(appCss, '.topo-background::after').get('background')).toBe(
      'var(--glow-app)',
    );
  });

  it('blocos de código e de decisão continuam sólidos, para a leitura', () => {
    expect(ruleDeclarations(appCss, '.decision-card pre').get('background')).toBe('var(--bg)');
  });
});
