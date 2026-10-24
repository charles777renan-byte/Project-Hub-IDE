import { describe, expect, it } from 'vitest';
import { readCss, ruleDeclarations } from './css-rules';

/**
 * Forma do painel (Tarefa 2 do plano da interface do workspace): faixa de 3px na cor do acento,
 * raio de 12px por um token próprio e uma classe `panel--<acento>` por acento. O teste lê os CSS de
 * verdade e confere as regras por texto, então trocar o token de um acento ou o raio derruba-o.
 */

const ACCENTS = ['violet', 'red', 'blue', 'magenta', 'orange', 'lime', 'cyan', 'yellow'] as const;

describe('forma do painel', () => {
  const appCss = readCss('app.css');
  const tokensCss = readCss('tokens.css');

  // Atualizado na identidade visual: --radius dos controles subiu de 2px para 8px e o raio do painel
  // passou a ser o alias de --radius-card (12px).
  it('define --radius-panel como alias de --radius-card (12px) e --radius em 8px', () => {
    const root = ruleDeclarations(tokensCss, ':root');
    expect(root.get('--radius-card')).toBe('12px');
    expect(root.get('--radius-panel')).toBe('var(--radius-card)');
    expect(root.get('--radius')).toBe('8px');
  });

  it.each(ACCENTS)('panel--%s aponta --panel-accent para o token do acento', (accent) => {
    expect(ruleDeclarations(appCss, `.panel--${accent}`).get('--panel-accent')).toBe(
      `var(--${accent})`,
    );
  });

  // Atualizado na identidade visual (Tarefa 5): o painel virou cartão (B1). Superfície opaca --surface,
  // raio --radius-card, contorno de 1px por sombra interna e --shadow-card; a faixa colorida de 3px do
  // topo saiu (o acento fica no ponto do cabeçalho) e o fundo deixou de ser translúcido.
  it('.panel é um cartão: --surface, --radius-card, contorno por sombra interna e sem faixa no topo', () => {
    const panel = ruleDeclarations(appCss, '.panel');
    expect(panel.get('border-radius')).toBe('var(--radius-card)');
    expect(panel.get('background')).toBe('var(--surface)');
    expect(panel.get('box-shadow')?.replaceAll(/\s+/g, ' ')).toBe(
      'inset 0 0 0 1px var(--line), var(--shadow-card)',
    );
    expect(panel.has('border')).toBe(false);
    expect(panel.has('border-top')).toBe(false);
    expect(panel.get('min-height')).toBe('0');
    expect(panel.get('overflow')).toBe('hidden');
  });

  it('o ponto usa a cor do acento e o corpo rola sem estourar o painel', () => {
    expect(ruleDeclarations(appCss, '.panel__dot').get('background')).toBe('var(--panel-accent)');
    const body = ruleDeclarations(appCss, '.panel__body');
    expect(body.get('overflow')).toBe('auto');
    expect(body.get('min-height')).toBe('0');
  });

  it('o título do painel usa --text; a meta e o estado vazio, --muted, com o título do vazio em --text', () => {
    expect(ruleDeclarations(appCss, '.panel__title').get('color')).toBe('var(--text)');
    expect(ruleDeclarations(appCss, '.panel__meta').get('color')).toBe('var(--muted)');
    expect(ruleDeclarations(appCss, '.panel__empty').get('color')).toBe('var(--muted)');
    expect(
      ruleDeclarations(readCss('workspace.css'), '.empty-state .empty-state__title').get('color'),
    ).toBe('var(--text)');
  });
});
