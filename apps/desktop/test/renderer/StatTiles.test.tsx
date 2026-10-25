import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { StatTiles } from '../../src/renderer/components/home/StatTiles';

describe('StatTiles (pílulas)', () => {
  it('mostra os três números recebidos', () => {
    render(<StatTiles running={2} waiting={3} failed={1} loaded />);

    expect(screen.getByText('Executando').nextElementSibling).toHaveTextContent('2');
    expect(screen.getByText('Aguardando você').nextElementSibling).toHaveTextContent('3');
    expect(screen.getByText('Falharam').nextElementSibling).toHaveTextContent('1');
  });

  it('antes da primeira leitura mostra traço, não zero', () => {
    render(<StatTiles running={0} waiting={0} failed={0} loaded={false} />);

    for (const label of ['Executando', 'Aguardando você', 'Falharam']) {
      expect(screen.getByText(label).nextElementSibling).toHaveTextContent('—');
    }
  });

  it('só a pílula de falhas leva a marca de vermelho', () => {
    const { container } = render(<StatTiles running={0} waiting={0} failed={4} loaded />);

    const danger = container.querySelectorAll('.stat-pill--danger');
    expect(danger).toHaveLength(1);
    expect(danger[0]).toHaveTextContent('Falharam');
  });
});
