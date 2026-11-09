import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router';
import { describe, expect, it, vi } from 'vitest';
import type { TerminalSummary } from '@project-hub/contracts';
import { SidebarRail } from '../../src/renderer/components/SidebarRail';

// A lateral recolhida: um botão por agente vivo, quem aguarda primeiro, com "título — estado" no nome acessível.

const terminals: TerminalSummary[] = [
  { id: 't1', projectId: 'p1', title: 'Corrige login', provider: 'claude', state: 'running' },
  { id: 't2', projectId: 'p1', title: 'Revisa PR', provider: 'claude', state: 'waiting' },
  { id: 't3', projectId: 'p2', title: 'Antigo', provider: 'shell', state: 'exited' },
] as unknown as TerminalSummary[];

vi.mock('../../src/renderer/terminals-data', () => ({
  TERMINALS_POLL_MS: 2_000,
  useTerminals: () => ({ terminals, error: null, loaded: true, reload: () => undefined }),
}));

function Where() {
  const location = useLocation();
  return (
    <p data-testid="where">
      {location.pathname} {JSON.stringify(location.state)}
    </p>
  );
}

function renderRail(onExpand = vi.fn()) {
  render(
    <MemoryRouter>
      <SidebarRail onExpand={onExpand} />
      <Routes>
        <Route path="*" element={<Where />} />
      </Routes>
    </MemoryRouter>,
  );
  return onExpand;
}

describe('SidebarRail', () => {
  it('lista só os agentes vivos, quem aguarda primeiro, com título e estado no nome', () => {
    renderRail();
    const list = within(screen.getByRole('navigation', { name: 'Agentes' })).getAllByRole(
      'listitem',
    );
    expect(list.map((item) => within(item).getByRole('button').getAttribute('aria-label'))).toEqual(
      ['Revisa PR — Aguardando', 'Corrige login — Ativo'],
    );
  });

  it('clicar num agente leva ao terminal no workspace do projeto', async () => {
    const user = userEvent.setup();
    renderRail();
    await user.click(screen.getByRole('button', { name: 'Corrige login — Ativo' }));
    expect(screen.getByTestId('where')).toHaveTextContent('/workspaces/p1');
    expect(screen.getByTestId('where')).toHaveTextContent('"showTerminal":"t1"');
  });

  it('o botão do topo expande a lateral', async () => {
    const user = userEvent.setup();
    const onExpand = renderRail();
    await user.click(screen.getByRole('button', { name: 'Expandir barra lateral' }));
    expect(onExpand).toHaveBeenCalledOnce();
  });
});
