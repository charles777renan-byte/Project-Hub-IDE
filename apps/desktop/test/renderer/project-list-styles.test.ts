import { describe, expect, it } from 'vitest';
import { readCss, ruleDeclarations } from './css-rules';

/** Acabamento da lista de projetos (Tarefa 9): sem bolinhas e com o caminho quebrando em separadores. */
describe('lista de projetos e caminho', () => {
  const appCss = readCss('app.css');

  it('.project-list não mostra marcador nem recuo do navegador', () => {
    const list = ruleDeclarations(appCss, '.project-list');
    expect(list.get('list-style')).toBe('none');
    expect(list.get('margin')).toBe('0');
    expect(list.get('padding')).toBe('0');
  });

  it('.project-path quebra por break-word, não por anywhere', () => {
    const path = ruleDeclarations(appCss, '.project-path');
    expect(path.get('overflow-wrap')).toBe('break-word');
  });
});
