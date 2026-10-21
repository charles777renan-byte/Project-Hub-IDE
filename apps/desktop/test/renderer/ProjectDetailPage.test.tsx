import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { AppResult, MissionDto, ProjectHubApi, ProjectSummary } from '@project-hub/contracts';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter, Route, Routes } from 'react-router';
import { ProjectDetailPage } from '../../src/renderer/pages/ProjectDetailPage';
import { MissionPage } from '../../src/renderer/pages/MissionPage';
import { PROJECTS_CHANGED_EVENT } from '../../src/renderer/projects-events';
import { ROUTE_PATHS } from '../../src/renderer/routes';

const project: ProjectSummary = {
  id: 'p1',
  name: 'Project Hub',
  path: 'C:\\Projetos\\Project Hub',
  repositoryKind: 'git',
  available: true,
  defaultBranch: 'main',
};

function missionOf(overrides: Partial<MissionDto>): MissionDto {
  return {
    id: 'm1',
    projectId: 'p1',
    title: 'Ajustar login',
    objective: 'Corrigir o login',
    status: 'draft',
    altersCode: false,
    acceptanceCriteria: [{ id: 'c1', position: 1, text: 'Login funciona' }],
    createdAt: '2026-10-20T09:00:00.000Z',
    updatedAt: '2026-10-20T09:00:00.000Z',
    ...overrides,
  };
}

function installApi(missions: MissionDto[]) {
  const api = {
    projects: {
      list: vi.fn(() => Promise.resolve({ ok: true, data: [project] })),
      archive: vi.fn(() => Promise.resolve<AppResult<void>>({ ok: true, data: undefined })),
      remove: vi.fn(() => Promise.resolve<AppResult<void>>({ ok: true, data: undefined })),
    },
    missions: {
      list: vi.fn(() => Promise.resolve({ ok: true, data: missions })),
      create: vi.fn(() => Promise.resolve({ ok: true, data: missionOf({ id: 'nova' }) })),
      plan: vi.fn(() => Promise.resolve({ ok: true, data: { missionId: 'nova', steps: [] } })),
      get: vi.fn(() =>
        Promise.resolve({
          ok: true,
          data: {
            mission: missionOf({ id: 'nova' }),
            project: { id: 'p1', name: 'Project Hub', path: 'C:\\x', defaultBranch: 'main' },
            steps: [],
            executions: [],
            pendingApprovals: [],
            events: [],
          },
        }),
      ),
      subscribe: vi.fn(() => () => undefined),
    },
  };
  window.projectHub = api as unknown as ProjectHubApi;
  return api;
}

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path={ROUTE_PATHS.projects} element={<p>Lista de projetos</p>} />
        <Route path={ROUTE_PATHS.projectDetail} element={<ProjectDetailPage />} />
        <Route path={ROUTE_PATHS.missionDetail} element={<MissionPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

afterEach(() => {
  Reflect.deleteProperty(window, 'projectHub');
});

describe('ProjectDetailPage: cabeçalho e aba Missões', () => {
  it('mostra nome, pasta e branch no cabeçalho, e a aba Missões aberta', async () => {
    installApi([]);
    renderAt('/projects/p1');

    expect(
      await screen.findByRole('heading', { level: 1, name: 'Project Hub' }),
    ).toBeInTheDocument();
    expect(screen.getByText('C:\\Projetos\\Project Hub')).toBeInTheDocument();
    expect(screen.getByText('Branch: main')).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Missões' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByText('Nenhuma missão ainda. Crie a primeira.')).toBeInTheDocument();
  });

  it('cada missão vira um cartão com a situação e a ação necessária', async () => {
    installApi([
      missionOf({ id: 'm1', title: 'Ajustar login', status: 'planned' }),
      missionOf({ id: 'm2', title: 'Documentar API', status: 'running' }),
    ]);
    renderAt('/projects/p1');

    const list = await screen.findByRole('list', { name: 'Missões do projeto' });
    const cards = within(list).getAllByRole('article');
    expect(cards).toHaveLength(2);
    expect(
      within(cards[0]!).getByText('O plano está pronto e espera a sua aprovação.'),
    ).toBeInTheDocument();
    expect(within(cards[0]!).getByText('Aprovar plano')).toBeInTheDocument();
    expect(cards[0]).toHaveClass('mission-card--attention');
    expect(cards[1]).not.toHaveClass('mission-card--attention');
    expect(within(cards[1]!).getByText('Em execução')).toBeInTheDocument();
  });

  it('o caminho do cabeçalho ganha um ponto de quebra depois de cada separador', async () => {
    installApi([]);
    const { container } = renderAt('/projects/p1');
    await screen.findByRole('heading', { level: 1, name: 'Project Hub' });

    const path = container.querySelector('.project-path');
    expect(path).not.toBeNull();
    expect(path!.querySelectorAll('wbr')).toHaveLength(2);
  });
});

describe('ProjectDetailPage: outras abas', () => {
  it('Visão geral mostra as contagens das missões por situação', async () => {
    installApi([
      missionOf({ id: 'a', status: 'running' }),
      missionOf({ id: 'b', status: 'running' }),
      missionOf({ id: 'c', status: 'planned' }),
      missionOf({ id: 'd', status: 'waiting_input' }),
      missionOf({ id: 'e', status: 'succeeded' }),
      missionOf({ id: 'f', status: 'failed' }),
    ]);
    renderAt('/projects/p1');

    await userEvent.click(await screen.findByRole('tab', { name: 'Visão geral' }));

    const panel = screen.getByRole('tabpanel');
    const counts = within(panel).getByRole('list', { name: 'Missões por situação' });
    const itemOf = (label: string) => within(counts).getByText(label).closest('li') as HTMLElement;
    expect(itemOf('Total')).toHaveTextContent('6');
    expect(itemOf('Em execução')).toHaveTextContent('2');
    expect(itemOf('Aguardando você')).toHaveTextContent('2');
    expect(itemOf('Concluídas')).toHaveTextContent('1');
    expect(itemOf('Falharam')).toHaveTextContent('1');
    expect(screen.queryByText('Disponível na próxima etapa.')).not.toBeInTheDocument();
  });

  it('Repositório mostra o tipo, a branch padrão e a pasta', async () => {
    installApi([]);
    renderAt('/projects/p1');

    await userEvent.click(await screen.findByRole('tab', { name: 'Repositório' }));

    const panel = screen.getByRole('tabpanel');
    expect(within(panel).getByText('Repositório Git')).toBeInTheDocument();
    expect(within(panel).getByText('main')).toBeInTheDocument();
    expect(within(panel).getByText('C:\\Projetos\\Project Hub')).toBeInTheDocument();
    expect(screen.queryByText('Disponível na próxima etapa.')).not.toBeInTheDocument();
  });

  it('a aba Worktrees lista os worktrees do projeto', async () => {
    const api = installApi([]);
    Object.assign(api, {
      worktrees: {
        list: vi.fn(() =>
          Promise.resolve({
            ok: true,
            data: [
              {
                missionId: 'm1',
                missionTitle: 'Ajustar login',
                status: 'failed',
                path: 'C:\\worktrees\\app\\m1',
                branch: 'ph/m1-ajustar-login',
              },
            ],
          }),
        ),
      },
    });
    renderAt('/projects/p1');

    await userEvent.click(await screen.findByRole('tab', { name: 'Worktrees' }));

    expect(await screen.findByText('ph/m1-ajustar-login')).toBeInTheDocument();
    expect(screen.queryByText('Disponível na próxima etapa.')).not.toBeInTheDocument();
  });

  it('Configurações e permissões mantém o texto de próxima etapa', async () => {
    installApi([]);
    renderAt('/projects/p1');

    await userEvent.click(await screen.findByRole('tab', { name: 'Configurações e permissões' }));
    expect(screen.getByText('Disponível na próxima etapa.')).toBeInTheDocument();
  });
});

describe('ProjectDetailPage: criar missão', () => {
  it('em projeto sem Git, o aviso aparece e desabilita Criar missão, sem marcar "altera código"', async () => {
    const api = installApi([]);
    api.projects.list.mockResolvedValue({
      ok: true,
      data: [{ ...project, repositoryKind: 'none', defaultBranch: undefined }],
    } as never);
    renderAt('/projects/p1');
    await screen.findByText('Nenhuma missão ainda. Crie a primeira.');

    await userEvent.click(screen.getByRole('button', { name: 'Criar missão' }));
    const form = screen.getByRole('form', { name: 'Nova missão' });

    expect(within(form).getByText(/Este projeto não é um repositório Git/)).toBeInTheDocument();
    expect(within(form).getByRole('button', { name: 'Criar missão' })).toBeDisabled();
  });

  it('criar e planejar leva ao workspace da missão', async () => {
    const api = installApi([]);
    renderAt('/projects/p1');
    await screen.findByText('Nenhuma missão ainda. Crie a primeira.');

    await userEvent.click(screen.getByRole('button', { name: 'Criar missão' }));
    await userEvent.type(screen.getByLabelText('Título'), 'Nova missão');
    await userEvent.type(screen.getByLabelText('Objetivo'), 'Fazer algo');
    await userEvent.type(screen.getByLabelText('Critérios de aceite'), 'Algo pronto');
    await userEvent.click(screen.getByRole('button', { name: 'Criar missão' }));

    expect(api.missions.create).toHaveBeenCalledWith({
      projectId: 'p1',
      title: 'Nova missão',
      objective: 'Fazer algo',
      acceptanceCriteria: ['Algo pronto'],
      altersCode: false,
    });
    expect(api.missions.plan).toHaveBeenCalledWith('nova');
    expect(
      await screen.findByRole('heading', { level: 1, name: 'Ajustar login' }),
    ).toBeInTheDocument();
  });

  it('somente planejar fica na lista e avisa que o plano aguarda revisão', async () => {
    const api = installApi([]);
    renderAt('/projects/p1');
    await screen.findByText('Nenhuma missão ainda. Crie a primeira.');

    await userEvent.click(screen.getByRole('button', { name: 'Criar missão' }));
    await userEvent.type(screen.getByLabelText('Título'), 'Nova missão');
    await userEvent.type(screen.getByLabelText('Objetivo'), 'Fazer algo');
    await userEvent.type(screen.getByLabelText('Critérios de aceite'), 'Algo pronto');
    await userEvent.click(screen.getByLabelText('Somente planejar'));
    await userEvent.click(screen.getByRole('button', { name: 'Criar missão' }));

    expect(await screen.findByText(/Plano gerado\. Abra a missão/)).toBeInTheDocument();
    expect(api.missions.plan).toHaveBeenCalledWith('nova');
  });

  it('a falha ao criar aparece como alerta e a lista continua', async () => {
    const api = installApi([]);
    api.missions.create.mockResolvedValueOnce({
      ok: false,
      error: {
        code: 'VALIDATION_FAILED',
        message: 'Informe ao menos um critério de aceite.',
        retryable: false,
      },
    } as unknown as { ok: true; data: MissionDto });
    renderAt('/projects/p1');
    await screen.findByText('Nenhuma missão ainda. Crie a primeira.');

    await userEvent.click(screen.getByRole('button', { name: 'Criar missão' }));
    await userEvent.type(screen.getByLabelText('Título'), 'Nova missão');
    await userEvent.type(screen.getByLabelText('Objetivo'), 'Fazer algo');
    await userEvent.type(screen.getByLabelText('Critérios de aceite'), 'Algo');
    await userEvent.click(screen.getByRole('button', { name: 'Criar missão' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Informe ao menos um critério de aceite.',
    );
    expect(api.missions.plan).not.toHaveBeenCalled();
  });
});

describe('ProjectDetailPage: arquivar e remover', () => {
  it('Arquivar projeto arquiva, avisa a barra lateral e volta à lista de projetos', async () => {
    const api = installApi([]);
    const avisos = vi.fn();
    window.addEventListener(PROJECTS_CHANGED_EVENT, avisos);
    const user = userEvent.setup();
    renderAt('/projects/p1');

    await user.click(await screen.findByRole('button', { name: 'Arquivar projeto' }));

    expect(api.projects.archive).toHaveBeenCalledWith('p1');
    expect(await screen.findByText('Lista de projetos')).toBeInTheDocument();
    expect(avisos).toHaveBeenCalled();
    window.removeEventListener(PROJECTS_CHANGED_EVENT, avisos);
  });

  it('Remover da lista pede confirmação antes de tirar o projeto', async () => {
    const api = installApi([]);
    const user = userEvent.setup();
    renderAt('/projects/p1');

    await user.click(await screen.findByRole('button', { name: 'Remover da lista' }));
    expect(api.projects.remove).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: 'Remover' }));

    expect(api.projects.remove).toHaveBeenCalledWith('p1');
    expect(await screen.findByText('Lista de projetos')).toBeInTheDocument();
  });

  it('falha ao arquivar mostra a mensagem da API e o projeto segue na tela', async () => {
    const api = installApi([]);
    api.projects.archive.mockResolvedValueOnce({
      ok: false,
      error: {
        code: 'MISSION_INVALID_STATE',
        message:
          'Há missões em andamento neste projeto. Cancele ou aguarde antes de arquivar ou remover.',
        retryable: false,
      },
    });
    const user = userEvent.setup();
    renderAt('/projects/p1');

    await user.click(await screen.findByRole('button', { name: 'Arquivar projeto' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Há missões em andamento');
    expect(screen.getByRole('heading', { level: 1, name: 'Project Hub' })).toBeInTheDocument();
    expect(screen.queryByText('Lista de projetos')).not.toBeInTheDocument();
  });
});
