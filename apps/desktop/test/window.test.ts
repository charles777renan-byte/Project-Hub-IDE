import { describe, expect, it } from 'vitest';
import { buildWebPreferences, TITLE_BAR_OVERLAY } from '../src/main/window';
import { readCss, ruleDeclarations } from './renderer/css-rules';

describe('TITLE_BAR_OVERLAY', () => {
  it('tem a cor do fundo do app (--bg) e a altura do cabeçalho menos a linha de baixo', () => {
    const tokens = ruleDeclarations(readCss('tokens.css'), ':root');
    const header = ruleDeclarations(readCss('app.css'), '.app-header');
    expect(TITLE_BAR_OVERLAY.color).toBe(tokens.get('--bg'));
    // A linha de 1px fica no último pixel do cabeçalho, abaixo da faixa de botões.
    expect(`${TITLE_BAR_OVERLAY.height + 1}px`).toBe(header.get('height'));
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
