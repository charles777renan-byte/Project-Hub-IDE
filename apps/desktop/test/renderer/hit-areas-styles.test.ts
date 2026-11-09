import { describe, expect, it } from 'vitest';
import { readCss, ruleDeclarations } from './css-rules';

/**
 * Áreas de clique (§4 do documento de UI/UX): o ícone pode ter 14 a 16 px, mas o alvo tem ao menos 24 x 24 px.
 * Estes são os controles que uma sonda no app construído achou abaixo disso; a barra de status passou a 28px para
 * caber um alvo de 24px com a borda.
 */
const px = (value: string | undefined): number => Number.parseFloat(value ?? '0');

describe('áreas de clique de ao menos 24px', () => {
  it('a barra de status tem 28px, e os contadores e os botões dela têm 24px de altura', () => {
    const status = readCss('statusbar.css');
    expect(ruleDeclarations(status, '.statusbar').get('height')).toBe('28px');
    expect(
      px(ruleDeclarations(status, '.statusbar .overview-counter').get('min-height')),
    ).toBeGreaterThanOrEqual(24);
    const button = ruleDeclarations(status, '.statusbar .confirm-inline button');
    expect(px(button.get('height'))).toBeGreaterThanOrEqual(24);
  });

  it('Lista e Grade da barra lateral e a seta de um projeto têm 24px', () => {
    const workspace = readCss('workspace.css');
    expect(
      px(ruleDeclarations(workspace, '.sidebar__seg button').get('min-height')),
    ).toBeGreaterThanOrEqual(24);
    expect(
      px(ruleDeclarations(workspace, '.sidebar__toggle').get('min-width')),
    ).toBeGreaterThanOrEqual(24);
  });

  it('o x de fechar uma aba de arquivo tem 24 x 24 px', () => {
    const close = ruleDeclarations(readCss('right-panel.css'), '.file-tabs__close');
    expect(px(close.get('width'))).toBeGreaterThanOrEqual(24);
    expect(px(close.get('height'))).toBeGreaterThanOrEqual(24);
  });
});
