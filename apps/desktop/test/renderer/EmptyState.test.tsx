import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { EmptyState } from '../../src/renderer/components/EmptyState';
import { Inbox } from '../../src/renderer/components/Icon';

describe('EmptyState', () => {
  it('mostra o título, a dica e a ação', () => {
    render(
      <EmptyState
        icon={Inbox}
        title="Nada por aqui"
        hint="Comece criando algo."
        action={<button type="button">Criar</button>}
      />,
    );
    expect(screen.getByText('Nada por aqui')).toHaveClass('empty-state__title');
    expect(screen.getByText('Comece criando algo.')).toHaveClass('empty-state__hint');
    expect(screen.getByRole('button', { name: 'Criar' })).toBeInTheDocument();
  });

  it('o ícone é decorativo: aria-hidden e fora da árvore de acessibilidade', () => {
    const { container } = render(<EmptyState icon={Inbox} title="Nada por aqui" />);
    const icon = container.querySelector('svg');
    expect(icon).not.toBeNull();
    expect(icon).toHaveAttribute('aria-hidden', 'true');
    expect(screen.queryByRole('img')).not.toBeInTheDocument();
  });

  it('sem dica nem ação, não desenha nenhum dos dois', () => {
    const { container } = render(<EmptyState icon={Inbox} title="Nada por aqui" />);
    expect(container.querySelector('.empty-state__hint')).toBeNull();
    expect(container.querySelector('.empty-state__action')).toBeNull();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('o título com marcação aparece como texto', () => {
    render(<EmptyState icon={Inbox} title="<b>x</b>" />);
    expect(screen.getByText('<b>x</b>')).toBeInTheDocument();
  });
});
