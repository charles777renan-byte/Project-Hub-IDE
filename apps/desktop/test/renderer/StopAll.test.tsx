import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { AppResult, MissionDto, ProjectHubApi, ProjectSummary } from '@project-hub/contracts';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { StopAll } from '../../src/renderer/components/StopAll';
import { getToasts, notify } from '../../src/renderer/notify';

// "Parar todos" na barra de status: cancela as missões em execução, depois de uma pergunta. A API do preload é falsa.

const project: ProjectSummary = {
  id: 'p1',
  name: 'app',
  path: 'C:\\app',
  repositoryKind: 'git',
  available: true,
  defaultBranch: 'main',
};

function mission(id: string, status: MissionDto['status']): MissionDto {
  return {
    id,
    projectId: 'p1',
    title: `Missão ${id}`,
    objective: 'Objetivo',
    status,
    altersCode: false,
    acceptanceCriteria: [{ id: `${id}-c`, position: 1, text: 'Critério' }],
    createdAt: '2026-10-20T09:00:00.000Z',
    updatedAt: '2026-10-20T09:00:00.000Z',
  };
}

function installApi(
  missions: MissionDto[],
  cancel: (id: string) => Promise<AppResult<void>> = () =>
    Promise.resolve({ ok: true, data: undefined }),
) {
  const api = {
    projects: {
      list: vi.fn(() =>
        Promise.resolve<AppResult<ProjectSummary[]>>({ ok: true, data: [project] }),
      ),
    },
    missions: {
      list: vi.fn(() => Promise.resolve<AppResult<MissionDto[]>>({ ok: true, data: missions })),
      subscribe: vi.fn(() => () => {}),
      cancel: vi.fn(cancel),
    },
  };
  window.projectHub = api as unknown as ProjectHubApi;
  return api;
}

afterEach(() => {
  notify.clear();
  Reflect.deleteProperty(window, 'projectHub');
});

describe('StopAll', () => {
  it('não aparece quando nenhuma missão está em execução', async () => {
    const api = installApi([mission('m1', 'review'), mission('m2', 'planned')]);

    render(<StopAll />);
    await waitFor(() => expect(api.missions.list).toHaveBeenCalled());
    await new Promise((resolve) => setTimeout(resolve, 30));

    expect(screen.queryByRole('button', { name: 'Parar todos' })).not.toBeInTheDocument();
  });

  it('pergunta antes e só então cancela as missões em execução, sem tocar nas que esperam', async () => {
    const api = installApi([
      mission('m1', 'running'),
      mission('m2', 'running'),
      mission('m3', 'waiting_approval'),
    ]);
    render(<StopAll />);

    await userEvent.click(await screen.findByRole('button', { name: 'Parar todos' }));

    expect(screen.getByRole('group', { name: 'Cancelar 2 missões em execução?' })).toBeVisible();
    expect(api.missions.cancel).not.toHaveBeenCalled();

    await userEvent.click(screen.getByRole('button', { name: 'Parar 2 missões' }));

    await waitFor(() => expect(api.missions.cancel).toHaveBeenCalledTimes(2));
    expect(api.missions.cancel.mock.calls.map(([id]) => id).sort()).toEqual(['m1', 'm2']);
    await waitFor(() =>
      expect(getToasts().map((toast) => toast.message)).toContain('2 missões canceladas.'),
    );
  });

  it('o botão que confirma diz o efeito com o número real: "Parar 2 missões"', async () => {
    installApi([mission('m1', 'running'), mission('m2', 'running')]);
    render(<StopAll />);

    await userEvent.click(await screen.findByRole('button', { name: 'Parar todos' }));

    expect(screen.getByRole('button', { name: 'Parar 2 missões' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Cancelar' })).not.toBeInTheDocument();
  });

  it('uma missão só fica no singular, também no botão que confirma', async () => {
    installApi([mission('m1', 'running')]);
    render(<StopAll />);

    await userEvent.click(await screen.findByRole('button', { name: 'Parar todos' }));

    expect(screen.getByRole('group', { name: 'Cancelar 1 missão em execução?' })).toBeVisible();
    expect(screen.getByRole('button', { name: 'Parar 1 missão' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Parar 1 missões' })).not.toBeInTheDocument();
  });

  it('ao abrir a pergunta, "Voltar" recebe o foco, a saída segura', async () => {
    installApi([mission('m1', 'running')]);
    render(<StopAll />);

    await userEvent.click(await screen.findByRole('button', { name: 'Parar todos' }));

    expect(screen.getByRole('button', { name: 'Voltar' })).toHaveFocus();
  });

  it('o gatilho "Parar todos" é neutro; o vermelho fica só no botão que confirma', async () => {
    installApi([mission('m1', 'running'), mission('m2', 'running')]);
    render(<StopAll />);

    const gatilho = await screen.findByRole('button', { name: 'Parar todos' });
    expect(gatilho).toHaveClass('btn-secondary');
    expect(gatilho).not.toHaveClass('btn-danger');

    await userEvent.click(gatilho);

    expect(screen.getByRole('button', { name: 'Parar 2 missões' })).toHaveClass('btn-danger');
    expect(screen.getByRole('button', { name: 'Voltar' })).not.toHaveClass('btn-danger');
  });

  it('"Voltar" desfaz o pedido sem cancelar nada e devolve o foco a "Parar todos"', async () => {
    const api = installApi([mission('m1', 'running')]);
    render(<StopAll />);

    await userEvent.click(await screen.findByRole('button', { name: 'Parar todos' }));
    await userEvent.click(screen.getByRole('button', { name: 'Voltar' }));

    expect(api.missions.cancel).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Parar todos' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Parar todos' })).toHaveFocus();
  });

  it('se alguma missão não cancela, avisa quantas ficaram e segue com as outras', async () => {
    const api = installApi([mission('m1', 'running'), mission('m2', 'running')], (id) =>
      Promise.resolve(
        id === 'm2'
          ? { ok: false, error: { code: 'UNKNOWN', message: 'falha', retryable: true } }
          : { ok: true, data: undefined },
      ),
    );
    render(<StopAll />);

    await userEvent.click(await screen.findByRole('button', { name: 'Parar todos' }));
    await userEvent.click(screen.getByRole('button', { name: 'Parar 2 missões' }));

    await waitFor(() => expect(api.missions.cancel).toHaveBeenCalledTimes(2));
    await waitFor(() =>
      expect(getToasts().map((toast) => toast.message)).toContain(
        'Não foi possível cancelar 1 missão. Tente de novo.',
      ),
    );
  });

  it('uma chamada que quebra conta como falha, sem derrubar a barra de status', async () => {
    installApi([mission('m1', 'running')], () => Promise.reject(new Error('falha de IPC')));
    render(<StopAll />);

    await userEvent.click(await screen.findByRole('button', { name: 'Parar todos' }));
    await userEvent.click(screen.getByRole('button', { name: 'Parar 1 missão' }));

    await waitFor(() =>
      expect(getToasts().map((toast) => toast.message)).toContain(
        'Não foi possível cancelar 1 missão. Tente de novo.',
      ),
    );
  });
});
