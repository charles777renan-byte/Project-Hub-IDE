import { describe, expect, it } from 'vitest';
import { readCss, ruleDeclarations } from './css-rules';

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
