import { describe, expect, it } from 'vitest';
import { buildWebPreferences, TITLE_BAR_OVERLAY } from '../src/main/window';
import { readCss, ruleDeclarations } from './renderer/css-rules';

describe('TITLE_BAR_OVERLAY', () => {
  it('tem a cor do fundo do app (--bg) e a altura da barra superior menos a linha de baixo', () => {
    const tokens = ruleDeclarations(readCss('tokens.css'), ':root');
    const topbar = ruleDeclarations(readCss('workspace.css'), '.topbar');
    expect(TITLE_BAR_OVERLAY.color).toBe(tokens.get('--bg'));
    // A linha de 1px fica no último pixel da barra superior, abaixo da faixa de botões.
    expect(`${TITLE_BAR_OVERLAY.height + 1}px`).toBe(topbar.get('height'));
  });
});

describe('buildWebPreferences', () => {
  it('preferências de segurança fixas', () => {
    expect(buildWebPreferences('/p/preload.js')).toMatchObject({
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      webSecurity: true,
    });
  });

  it('usa o preload recebido e não acrescenta outras opções', () => {
    expect(buildWebPreferences('/p/preload.js')).toEqual({
      preload: '/p/preload.js',
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      webSecurity: true,
    });
  });
});
