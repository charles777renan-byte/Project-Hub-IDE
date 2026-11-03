import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ProjectHubApi } from '@project-hub/contracts';
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { GitCommitsList } from '../../src/renderer/components/right-panel/GitCommitsList';

/** A seção "Commits": só lê o histórico quando está aberta. */

let log: Mock;

beforeEach(() => {
  log = vi.fn(() =>
    Promise.resolve({
      ok: true,
      data: [
        {
          sha: 'a'.repeat(40),
          shortSha: 'aaaaaaa',
          author: 'Ana',
          date: new Date(Date.now() - 3 * 3_600_000).toISOString(),
          refs: [],
          subject: 'feat: primeiro',
        },
      ],
    }),
  );
  window.projectHub = { git: { log } } as unknown as ProjectHubApi;
});

afterEach(() => vi.restoreAllMocks());

describe('GitCommitsList', () => {
  it('fechada, não chama log', async () => {
    render(<GitCommitsList projectId="p1" reloadKey={0} />);

    await Promise.resolve();
    expect(log).not.toHaveBeenCalled();
  });

  it('ao abrir, chama log e mostra assunto, autor e data relativa', async () => {
    const user = userEvent.setup();
    render(<GitCommitsList projectId="p1" reloadKey={0} />);

    await user.click(screen.getByRole('button', { name: /Commits/ }));

    expect(await screen.findByText('feat: primeiro')).toBeInTheDocument();
    expect(log).toHaveBeenCalledWith({ projectId: 'p1' });
    expect(screen.getByText(/Ana/)).toBeInTheDocument();
    expect(screen.getByText(/há 3 horas/)).toBeInTheDocument();
  });

  it('aberta, recarrega quando a chave muda', async () => {
    const user = userEvent.setup();
    const { rerender } = render(<GitCommitsList projectId="p1" reloadKey={0} />);
    await user.click(screen.getByRole('button', { name: /Commits/ }));
    await waitFor(() => expect(log).toHaveBeenCalledTimes(1));

    rerender(<GitCommitsList projectId="p1" reloadKey={1} />);

    await waitFor(() => expect(log).toHaveBeenCalledTimes(2));
  });
});
