import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { PaneContext } from '../../src/renderer/workspace/PaneContext';

/** O contexto da última resposta no cabeçalho do painel: rótulo, barra, porcentagem e o detalhe para o leitor de tela. */
describe('PaneContext', () => {
  it('sem contexto não desenha nada, nunca um zero', () => {
    const { container } = render(<PaneContext context={undefined} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('com 38% mostra o rótulo, a porcentagem, o nível normal e a barra com 38% de largura', () => {
    const { container } = render(
      <PaneContext context={{ usedTokens: 76_000, windowTokens: 200_000 }} />,
    );
    const root = container.querySelector('.pane__context') as HTMLElement;
    expect(root).toHaveAttribute('data-level', 'normal');
    expect(root).toHaveAttribute('title', 'Contexto: 76.000 de 200.000 tokens (38%)');
    expect(screen.getByText('contexto')).toBeInTheDocument();
    expect(screen.getByText('38%')).toBeInTheDocument();
    const fill = root.querySelector('.pane__context-bar > .pane__context-fill') as HTMLElement;
    expect(fill.style.width).toBe('38%');
  });

  it('a partir de 80% o nível é high', () => {
    const { container } = render(
      <PaneContext context={{ usedTokens: 168_000, windowTokens: 200_000 }} />,
    );
    expect(container.querySelector('.pane__context')).toHaveAttribute('data-level', 'high');
    expect(screen.getByText('84%')).toBeInTheDocument();
  });

  it('uso maior que a janela mostra 100%, com a barra cheia', () => {
    const { container } = render(
      <PaneContext context={{ usedTokens: 250_000, windowTokens: 200_000 }} />,
    );
    expect(screen.getByText('100%')).toBeInTheDocument();
    expect((container.querySelector('.pane__context-fill') as HTMLElement).style.width).toBe(
      '100%',
    );
  });

  it('o leitor de tela lê o detalhe inteiro; a barra e o rótulo visual ficam escondidos dele', () => {
    const { container } = render(
      <PaneContext context={{ usedTokens: 76_000, windowTokens: 200_000 }} />,
    );
    const spoken = container.querySelector('.pane__context-sr') as HTMLElement;
    expect(spoken).toHaveTextContent('Contexto: 76.000 de 200.000 tokens (38%)');
    expect(spoken).not.toHaveAttribute('aria-hidden');
    expect(container.querySelector('.pane__context-bar')).toHaveAttribute('aria-hidden', 'true');
    expect(screen.getByText('38%')).toHaveAttribute('aria-hidden', 'true');
    expect(screen.getByText('contexto')).toHaveAttribute('aria-hidden', 'true');
  });
});
