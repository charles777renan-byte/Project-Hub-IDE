import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { PaneContext } from '../../src/renderer/workspace/PaneContext';

/** O contexto da última resposta no cabeçalho do painel: um fio sem texto à vista e o detalhe para o leitor de tela. */
describe('PaneContext', () => {
  const fillOf = (container: HTMLElement) =>
    container.querySelector('.pane__context > .pane__context-fill') as HTMLElement;

  it('sem contexto não desenha nada, nunca um zero', () => {
    const { container } = render(<PaneContext context={undefined} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('com 38% o nível é normal, o fio tem 38% de largura e não há texto à vista', () => {
    const { container } = render(
      <PaneContext context={{ usedTokens: 76_000, windowTokens: 200_000 }} />,
    );
    const root = container.querySelector('.pane__context') as HTMLElement;
    expect(root).toHaveAttribute('data-level', 'normal');
    expect(fillOf(container).style.width).toBe('38%');
    expect(root.querySelector('small, b')).toBeNull();
  });

  it('a partir de 80% o nível é high', () => {
    const { container } = render(
      <PaneContext context={{ usedTokens: 168_000, windowTokens: 200_000 }} />,
    );
    expect(container.querySelector('.pane__context')).toHaveAttribute('data-level', 'high');
    expect(fillOf(container).style.width).toBe('84%');
  });

  it('uso maior que a janela mostra o fio cheio, em 100%', () => {
    const { container } = render(
      <PaneContext context={{ usedTokens: 250_000, windowTokens: 200_000 }} />,
    );
    expect(fillOf(container).style.width).toBe('100%');
  });

  it('o leitor de tela lê o detalhe inteiro; o fio visual fica escondido dele', () => {
    const { container } = render(
      <PaneContext context={{ usedTokens: 76_000, windowTokens: 200_000 }} />,
    );
    const spoken = container.querySelector('.pane__context-sr') as HTMLElement;
    expect(spoken).toHaveTextContent('Contexto: 76.000 de 200.000 tokens (38%)');
    expect(spoken).not.toHaveAttribute('aria-hidden');
    expect(fillOf(container)).toHaveAttribute('aria-hidden', 'true');
  });
});
