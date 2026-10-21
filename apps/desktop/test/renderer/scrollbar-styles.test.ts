import { describe, expect, it } from 'vitest';
import { readCss, ruleDeclarations } from './css-rules';

/**
 * Barras de rolagem do app (app.css): finas e invisíveis por padrão, e visíveis quando o mouse passa
 * sobre o elemento que rola, sobre o painel dele, ou quando o foco entra ali. O teste lê o CSS de
 * verdade, então trocar a regra derruba-o.
 */

const VISIBLE = /^color-mix\(/;

describe('barras de rolagem', () => {
  const appCss = readCss('app.css');

  it('são finas e transparentes por padrão', () => {
    const all = ruleDeclarations(appCss, '*');
    expect(all.get('scrollbar-width')).toBe('thin');
    expect(all.get('scrollbar-color')).toBe('transparent transparent');
  });

  it('aparecem no elemento que está sob o mouse ou com foco dentro dele', () => {
    expect(ruleDeclarations(appCss, '*:hover').get('scrollbar-color')).toMatch(VISIBLE);
    expect(ruleDeclarations(appCss, '*:focus-within').get('scrollbar-color')).toMatch(VISIBLE);
  });

  it('aparecem no corpo do painel quando o mouse passa sobre o painel ou o foco entra nele', () => {
    expect(ruleDeclarations(appCss, '.panel:hover .panel__body').get('scrollbar-color')).toMatch(
      VISIBLE,
    );
    expect(
      ruleDeclarations(appCss, '.panel:focus-within .panel__body').get('scrollbar-color'),
    ).toMatch(VISIBLE);
  });
});
