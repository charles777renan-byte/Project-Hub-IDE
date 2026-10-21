import { describe, expect, it } from 'vitest';
import { mediaBlock, readCss, ruleDeclarations } from './css-rules';

/**
 * Casca do app (Tarefa 3 do plano da interface do workspace): cabeçalho de 50px, item ativo da
 * navegação em magenta cheio com texto no fundo (par medido em contrast.test.ts), e a área da página
 * ocupando o resto da altura, com a rolagem dentro dela.
 */

describe('casca do app', () => {
  const appCss = readCss('app.css');

  it('a janela é uma coluna da altura da tela', () => {
    const shell = ruleDeclarations(appCss, '.app-shell');
    expect(shell.get('display')).toBe('flex');
    expect(shell.get('flex-direction')).toBe('column');
    expect(shell.get('height')).toBe('100vh');
  });

  it('o cabeçalho tem 50px, não encolhe e não quebra linha', () => {
    const header = ruleDeclarations(appCss, '.app-header');
    expect(header.get('height')).toBe('50px');
    expect(header.get('flex')).toBe('none');
    expect(header.get('flex-wrap')).toBe('nowrap');
    expect(header.get('border-bottom')).toBe('1px solid var(--line)');
  });

  it('o item ativo da navegação é magenta cheio com o texto na cor do fundo', () => {
    const active = ruleDeclarations(appCss, ".app-nav a[aria-current='page']");
    expect(active.get('background')).toBe('var(--magenta)');
    expect(active.get('color')).toBe('var(--bg)');
  });

  it('a marca leva o violeta e o vermelho no símbolo', () => {
    expect(ruleDeclarations(appCss, '.app-brand__mark::before').get('background')).toBe(
      'var(--violet)',
    );
    expect(ruleDeclarations(appCss, '.app-brand__mark::after').get('background')).toBe(
      'var(--red)',
    );
  });

  it('o anel de foco da navegação fica dentro do link, que a navegação com rolagem cortaria', () => {
    expect(ruleDeclarations(appCss, '.app-nav a:focus-visible').get('outline-offset')).toBe('-2px');
    expect(ruleDeclarations(appCss, ':focus-visible').get('outline')).toBe('2px solid var(--text)');
  });

  it('os contadores ficam no canto direito', () => {
    expect(ruleDeclarations(appCss, '.app-header__status').get('margin-left')).toBe('auto');
  });

  it('a área da página ocupa o resto da altura e rola sozinha', () => {
    const main = ruleDeclarations(appCss, '.app-main');
    expect(main.get('flex')).toBe('1');
    expect(main.get('min-height')).toBe('0');
    expect(main.get('overflow')).toBe('auto');
  });
});

describe('leitor de regras dos testes', () => {
  it('lê regras agrupadas e não confunde um seletor com o prefixo dele', () => {
    const css = '.a{color:red} .b, .a{color:blue} .a__x{color:green}';
    expect(ruleDeclarations(css, '.a').get('color')).toBe('blue');
    expect(ruleDeclarations(css, '.a__x').get('color')).toBe('green');
  });

  it('não deixa uma regra de @media passar pela regra base, e lê o bloco quando pedido', () => {
    const css = '.g{display:grid} @media (max-width: 1000px){.g{display:block}}';
    expect(ruleDeclarations(css, '.g').get('display')).toBe('grid');
    expect(ruleDeclarations(mediaBlock(css, '(max-width: 1000px)'), '.g').get('display')).toBe(
      'block',
    );
  });

  it('termina num @media sem bloco, em vez de travar', () => {
    expect(ruleDeclarations('.a{color:red} @media (x)', '.a').get('color')).toBe('red');
    expect(mediaBlock('@media (x)', '(x)')).toBe('');
  });
});

/**
 * Contadores do cabeçalho (Tarefa 7): a linha de contadores é flex, e cada contador tem um ponto de
 * 8px com a cor do próprio estado (lima para executando, violeta para aguarda você).
 */
describe('contadores do cabeçalho', () => {
  const appCss = readCss('app.css');

  it('o contêiner dos contadores é uma linha flex', () => {
    expect(ruleDeclarations(appCss, '.overview-counters').get('display')).toBe('flex');
  });

  it('o ponto de cada contador tem 8px', () => {
    const dot = ruleDeclarations(appCss, '.overview-counter::before');
    expect(dot.get('width')).toBe('8px');
    expect(dot.get('height')).toBe('8px');
  });

  it('o ponto do contador "executando" é lima', () => {
    expect(ruleDeclarations(appCss, '.overview-counter--lime::before').get('background')).toBe(
      'var(--lime)',
    );
  });

  it('o ponto do contador "aguarda você" é violeta', () => {
    expect(ruleDeclarations(appCss, '.overview-counter--violet::before').get('background')).toBe(
      'var(--violet)',
    );
  });
});
