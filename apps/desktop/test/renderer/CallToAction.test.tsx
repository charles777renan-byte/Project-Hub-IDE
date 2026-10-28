import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router';
import { describe, expect, it } from 'vitest';
import { CallToAction } from '../../src/renderer/components/home/CallToAction';
import { ROUTE_PATHS } from '../../src/renderer/routes';

function Where() {
  return <p data-testid="where">{useLocation().pathname}</p>;
}

describe('CallToAction', () => {
  it('"Começar →" leva ao Início', async () => {
    render(
      <MemoryRouter initialEntries={['/outra']}>
        <Routes>
          <Route path={ROUTE_PATHS.home} element={<Where />} />
          <Route path="*" element={<CallToAction />} />
        </Routes>
      </MemoryRouter>,
    );

    expect(screen.getByRole('heading', { name: 'Nova missão' })).toBeInTheDocument();
    expect(
      screen.getByText('Descreva o trabalho e acompanhe o agente em um só lugar'),
    ).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Começar →' }));

    await waitFor(() => expect(screen.getByTestId('where')).toHaveTextContent(ROUTE_PATHS.home));
  });
});
