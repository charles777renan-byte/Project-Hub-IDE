import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ProjectHubApi, WorktreeDto } from '@project-hub/contracts';
import { MemoryRouter } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { WorktreesTab } from '../../src/renderer/components/WorktreesTab';

const done: WorktreeDto = {
  missionId: 'm1',
  missionTitle: 'Ajustar login',
  status: 'succeeded',
  path: 'C:\\worktrees\\app\\m1',
  branch: 'ph/m1-ajustar-login',
};
const running: WorktreeDto = {
  missionId: 'm2',
  missionTitle: 'Criar relatório',
  status: 'running',
  path: 'C:\\worktrees\\app\\m2',
  branch: 'ph/m2-criar-relatorio',
};

type RemoveResult = { ok: true; data: undefined } | { ok: false; error: Record<string, unknown> };

function installApi(lists: WorktreeDto[][], remove?: () => Promise<RemoveResult>) {
  const list = vi.fn();
  for (const data of lists) list.mockResolvedValueOnce({ ok: true, data });
  list.mockResolvedValue({ ok: true, data: lists[lists.length - 1] ?? [] });
  const api = {
    worktrees: {
      list,
      remove: vi.fn(remove ?? (() => Promise.resolve({ ok: true as const, data: undefined }))),
    },
    missions: { subscribe: vi.fn(() => () => undefined) },
  };
  window.projectHub = api as unknown as ProjectHubApi;
  return api;
}

function renderTab() {
  return render(
    <MemoryRouter>
      <WorktreesTab projectId="p1" />
    </MemoryRouter>,
  );
}

afterEach(() => {
  Reflect.deleteProperty(window, 'projectHub');
});

describe('WorktreesTab', () => {
  it('mostra pasta, branch, missão e estado de cada worktree', async () => {
    const api = installApi([[done, running]]);
    renderTab();

    const items = await screen.findAllByRole('listitem');
    expect(api.worktrees.list).toHaveBeenCalledWith('p1');
    const first = within(items[0]!);
    expect(first.getByText('C:\\worktrees\\app\\m1')).toBeInTheDocument();
    expect(first.getByText('ph/m1-ajustar-login')).toBeInTheDocument();
    expect(first.getByRole('link', { name: 'Ajustar login' })).toBeInTheDocument();
    expect(first.getByText('Concluída')).toBeInTheDocument();
    expect(within(items[1]!).getByText('Em execução')).toBeInTheDocument();
    expect(first.getByText('Concluída').querySelector('svg')).toHaveAttribute(
      'aria-hidden',
      'true',
    );
  });

  it('mostra a lista vazia', async () => {
    installApi([[]]);
    renderTab();

    expect(await screen.findByText('Nenhum worktree neste projeto.')).toBeInTheDocument();
  });

  it('missão que ainda não terminou não oferece o botão Remover', async () => {
    installApi([[running]]);
    renderTab();

    expect(await screen.findByText('Criar relatório')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Remover' })).not.toBeInTheDocument();
    expect(screen.getByText('Em uso pela missão.')).toBeInTheDocument();
  });

  it('pede confirmação antes de remover, e Voltar desiste sem chamar a remoção', async () => {
    const api = installApi([[done]]);
    renderTab();

    await userEvent.click(await screen.findByRole('button', { name: 'Remover' }));

    expect(api.worktrees.remove).not.toHaveBeenCalled();
    expect(screen.getByText(/A branch continua no repositório/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Voltar' }));
    expect(api.worktrees.remove).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Remover' })).toBeInTheDocument();
  });

  it('missão que falhou ou foi cancelada não oferece o botão Remover', async () => {
    installApi([
      [
        { ...done, missionId: 'm3', missionTitle: 'Falhou aqui', status: 'failed' },
        { ...done, missionId: 'm4', missionTitle: 'Cancelada aqui', status: 'cancelled' },
      ],
    ]);
    renderTab();

    expect(await screen.findByText('Falhou aqui')).toBeInTheDocument();
    expect(screen.getByText('Cancelada aqui')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Remover' })).not.toBeInTheDocument();
  });

  it('a confirmação não menciona Tentar de novo', async () => {
    installApi([[done]]);
    renderTab();

    await userEvent.click(await screen.findByRole('button', { name: 'Remover' }));

    expect(screen.queryByText(/Tentar de novo/)).not.toBeInTheDocument();
  });

  it('confirmar remove pelo id da missão e atualiza a lista', async () => {
    const api = installApi([[done], []]);
    renderTab();

    await userEvent.click(await screen.findByRole('button', { name: 'Remover' }));
    await userEvent.click(screen.getByRole('button', { name: 'Remover worktree' }));

    expect(api.worktrees.remove).toHaveBeenCalledWith('m1');
    expect(await screen.findByText('Nenhum worktree neste projeto.')).toBeInTheDocument();
  });

  it('recusa por alteração não salva mostra a mensagem e os arquivos que impedem, e mantém o worktree', async () => {
    installApi([[done]], () =>
      Promise.resolve({
        ok: false,
        error: {
          code: 'WORKTREE_HAS_UNSAVED_CHANGES',
          message: 'O worktree tem alterações não salvas e não foi removido.',
          details: { files: ['src/login.ts', 'rascunho.txt'] },
          retryable: false,
        },
      }),
    );
    renderTab();

    await userEvent.click(await screen.findByRole('button', { name: 'Remover' }));
    await userEvent.click(screen.getByRole('button', { name: 'Remover worktree' }));

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('O worktree tem alterações não salvas e não foi removido.');
    expect(within(alert).getByText('src/login.ts')).toBeInTheDocument();
    expect(within(alert).getByText('rascunho.txt')).toBeInTheDocument();
    expect(screen.getByText('C:\\worktrees\\app\\m1')).toBeInTheDocument();
  });

  it('outra recusa mostra só a mensagem', async () => {
    installApi([[done]], () =>
      Promise.resolve({
        ok: false,
        error: {
          code: 'MISSION_INVALID_STATE',
          message: 'Cancele a missão antes.',
          retryable: false,
        },
      }),
    );
    renderTab();

    await userEvent.click(await screen.findByRole('button', { name: 'Remover' }));
    await userEvent.click(screen.getByRole('button', { name: 'Remover worktree' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Cancele a missão antes.');
  });

  it('mostra o texto do Git como texto, sem interpretar marcação', async () => {
    installApi([[{ ...done, branch: 'ph/<b>negrito</b>' }]]);
    const { container } = renderTab();

    expect(await screen.findByText('ph/<b>negrito</b>')).toBeInTheDocument();
    expect(container.querySelector('b')).toBeNull();
  });

  it('erro ao carregar mostra a mensagem', async () => {
    window.projectHub = {
      worktrees: {
        list: vi.fn(() =>
          Promise.resolve({
            ok: false,
            error: {
              code: 'PROJECT_NOT_FOUND',
              message: 'O projeto não foi encontrado.',
              retryable: false,
            },
          }),
        ),
      },
      missions: { subscribe: vi.fn(() => () => undefined) },
    } as unknown as ProjectHubApi;
    renderTab();

    expect(await screen.findByRole('alert')).toHaveTextContent('O projeto não foi encontrado.');
  });
});
