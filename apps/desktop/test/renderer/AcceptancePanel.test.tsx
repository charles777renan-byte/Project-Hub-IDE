import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { AcceptancePanel } from '../../src/renderer/components/workspace/AcceptancePanel';

describe('AcceptancePanel: Critérios de aceite', () => {
  it('mostra os critérios na ordem de position, cada um com "○ não verificado"', () => {
    const criteria = [
      { id: 'c2', position: 2, text: 'Segundo critério' },
      { id: 'c1', position: 1, text: 'Primeiro critério' },
    ];
    render(<AcceptancePanel criteria={criteria} />);

    const section = screen.getByRole('region', { name: 'Critérios de aceite' });
    const items = within(section).getAllByRole('listitem');
    expect(items.map((item) => item.textContent)).toEqual([
      'Primeiro critério○ não verificado',
      'Segundo critério○ não verificado',
    ]);
    // A ordenação copia o array: a ordem que o contrato entregou não muda.
    expect(criteria.map((criterion) => criterion.id)).toEqual(['c2', 'c1']);
  });

  it('marca "✓ verificado" o critério que uma verificação que passou associou', () => {
    render(
      <AcceptancePanel
        criteria={[
          { id: 'c1', position: 1, text: 'Primeiro critério' },
          { id: 'c2', position: 2, text: 'Segundo critério' },
        ]}
        verified={new Set(['Primeiro critério'])}
      />,
    );

    const section = screen.getByRole('region', { name: 'Critérios de aceite' });
    expect(within(section).getByText('✓ verificado')).toBeInTheDocument();
    expect(within(section).getByText('○ não verificado')).toBeInTheDocument();
  });

  it('sem critério, é uma frase só, sem moldura de painel', () => {
    const { container } = render(<AcceptancePanel criteria={[]} />);

    const section = screen.getByRole('region', { name: 'Critérios de aceite' });
    expect(within(section).getByText('Nenhum critério definido.')).toBeInTheDocument();
    expect(container.querySelector('.panel')).toBeNull();
  });

  it('markup no critério aparece como texto', () => {
    render(<AcceptancePanel criteria={[{ id: 'c1', position: 1, text: '<b>negrito</b>' }]} />);

    expect(screen.getByText('<b>negrito</b>')).toBeInTheDocument();
    expect(document.querySelector('b')).toBeNull();
  });
});
