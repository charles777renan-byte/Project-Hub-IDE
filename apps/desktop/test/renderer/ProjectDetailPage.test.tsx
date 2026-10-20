import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { MissionDto, ProjectHubApi, ProjectSummary } from '@project-hub/contracts';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter, Route, Routes } from 'react-router';
import { ProjectDetailPage } from '../../src/renderer/pages/ProjectDetailPage';
import { MissionPage } from '../../src/renderer/pages/MissionPage';
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

  it('outras abas do projeto dizem que ficam para a próxima etapa', async () => {
    installApi([]);
    renderAt('/projects/p1');

    await userEvent.click(await screen.findByRole('tab', { name: 'Repositório' }));

    expect(screen.getByText('Disponível na próxima etapa.')).toBeInTheDocument();
  });
});

describe('ProjectDetailPage: criar missão', () => {
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
