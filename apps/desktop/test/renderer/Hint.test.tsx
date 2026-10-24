import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { Hint } from '../../src/renderer/components/Hint';

describe('Hint', () => {
  it('mostra a dica ao focar por teclado e some com Esc', async () => {
    const user = userEvent.setup();
    render(
      <Hint label="Fecha este workspace">
        <button type="button" aria-label="Fechar workspace A">
          x
        </button>
      </Hint>,
    );
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();

    await user.tab();
    expect(await screen.findByRole('tooltip')).toHaveTextContent('Fecha este workspace');

    await user.keyboard('{Escape}');
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
  });

  it('mostra a dica ao passar o mouse, depois do atraso', async () => {
    const user = userEvent.setup();
    render(
      <Hint label="Dica do mouse">
        <button type="button">Botão</button>
      </Hint>,
    );
    await user.hover(screen.getByRole('button', { name: 'Botão' }));
    expect(await screen.findByRole('tooltip', {}, { timeout: 2000 })).toHaveTextContent(
      'Dica do mouse',
    );
  });

  it('não muda o nome acessível do botão: a dica só o descreve', async () => {
    const user = userEvent.setup();
    render(
      <Hint label="Texto da dica">
        <button type="button" aria-label="Fechar workspace A">
          x
        </button>
      </Hint>,
    );
    expect(screen.getByRole('button', { name: 'Fechar workspace A' })).toBeInTheDocument();
    await user.tab();
    await screen.findByRole('tooltip');
    const button = screen.getByRole('button', { name: 'Fechar workspace A' });
    expect(button).toHaveAccessibleName('Fechar workspace A');
    expect(button).toHaveAccessibleDescription('Texto da dica');
  });
});
