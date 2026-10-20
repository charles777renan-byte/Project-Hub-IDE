import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ApprovalDto } from '@project-hub/contracts';
import { describe, expect, it, vi } from 'vitest';
import { ApprovalCard } from '../../src/renderer/components/ApprovalCard';

const approval: ApprovalDto = {
  id: 'ap1',
  missionId: 'm1',
  executionId: 'e1',
  actionType: 'write_outside_worktree',
  title: 'Gravar fora do worktree',
  rationale: 'O roteiro pediu a gravação de um arquivo.',
  commandPreview: 'copy a.txt C:\\outra\\a.txt',
  affectedResources: ['C:\\outra\\a.txt', 'C:\\outra'],
  status: 'pending',
  requestedAt: '2026-10-20T09:00:00.000Z',
};

describe('ApprovalCard', () => {
  it('mostra ação, motivo e recursos e chama decide com a escolha da pessoa', async () => {
    const onDecide = vi.fn();
    render(<ApprovalCard approval={approval} busy={false} onDecide={onDecide} />);

    const card = screen.getByRole('region', { name: 'Gravar fora do worktree' });
    expect(within(card).getByText('O roteiro pediu a gravação de um arquivo.')).toBeInTheDocument();
    expect(within(card).getByText('C:\\outra\\a.txt')).toBeInTheDocument();
    expect(within(card).getByText('copy a.txt C:\\outra\\a.txt')).toBeInTheDocument();

    await userEvent.click(within(card).getByRole('button', { name: 'Aprovar' }));
    await userEvent.click(within(card).getByRole('button', { name: 'Recusar' }));

    expect(onDecide).toHaveBeenNthCalledWith(1, 'approved');
    expect(onDecide).toHaveBeenNthCalledWith(2, 'rejected');
  });

  it('com a operação em andamento, os botões ficam desabilitados', () => {
    render(<ApprovalCard approval={approval} busy onDecide={vi.fn()} />);

    expect(screen.getByRole('button', { name: 'Aprovar' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Recusar' })).toBeDisabled();
  });
});
