import { describe, expect, it } from 'vitest';
import { readCss, ruleDeclarations } from './css-rules';

/** Acabamento do caminho do projeto (a lista de worktrees o usa): quebra em separadores. */
describe('caminho do projeto', () => {
  const appCss = readCss('app.css');

  it('.project-path quebra por break-word, não por anywhere', () => {
    const path = ruleDeclarations(appCss, '.project-path');
    expect(path.get('overflow-wrap')).toBe('break-word');
  });
});
