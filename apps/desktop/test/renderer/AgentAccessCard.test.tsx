import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { AgentAccessCard } from '../../src/renderer/components/right-panel/AgentAccessCard';

const ACCESS = {
  supported: true,
  programs: [
    { label: 'Claude Code', access: true },
    { label: 'Codex', access: true },
    { label: 'Antigravity CLI', access: false },
  ],
};

const card = () => screen.getByRole('region', { name: 'Agentes e o navegador' });

describe('AgentAccessCard', () => {
  it('lista cada programa e diz, em texto, se ele alcança o navegador', () => {
    render(<AgentAccessCard access={ACCESS} onClose={vi.fn()} />);
    const items = within(card()).getAllByRole('listitem');
    expect(items.map((item) => item.textContent)).toEqual([
      'Claude Code: alcança o navegador',
      'Codex: alcança o navegador',
      'Antigravity CLI: ainda não alcança',
    ]);
    expect(within(card()).getByText(/terminal novo/)).toBeInTheDocument();
  });

  it('no sistema sem o recurso, só diz que os agentes ainda não alcançam o navegador', () => {
    render(
      <AgentAccessCard
        access={{ supported: false, programs: ACCESS.programs }}
        onClose={vi.fn()}
      />,
    );
    expect(
      within(card()).getByText('Neste sistema os agentes ainda não alcançam o navegador.'),
    ).toBeInTheDocument();
    expect(within(card()).queryByRole('list')).toBeNull();
  });

  it('enquanto a resposta não chega, diz que está carregando', () => {
    render(<AgentAccessCard access={null} onClose={vi.fn()} />);
    expect(within(card()).getByRole('status')).toHaveTextContent('Carregando…');
    expect(within(card()).queryByRole('list')).toBeNull();
  });

  it('"Fechar" avisa quem abriu', async () => {
    const onClose = vi.fn();
    render(<AgentAccessCard access={ACCESS} onClose={onClose} />);
    await userEvent.setup().click(screen.getByRole('button', { name: 'Fechar' }));
    expect(onClose).toHaveBeenCalledOnce();
  });
});
