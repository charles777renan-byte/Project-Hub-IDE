import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type {
  AppResult,
  MissionDto,
  MissionStepDto,
  MissionViewDto,
  ProjectHubApi,
  ProjectSummary,
} from '@project-hub/contracts';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ProjectMissions } from '../../src/renderer/components/project/ProjectMissions';
import { ROUTE_PATHS } from '../../src/renderer/routes';

/**
 * Visão Missões da aba do projeto: a lista com progresso (reaproveita o quadro do Início), o estado vazio com
 * o botão Nova missão e o formulário compacto, que abre pelo pedido da rota (`state.newMission` ou
 * `?nova-missao=1`). Criar chama só `missions.create`; o plano nunca é gerado aqui (usa a cota do Claude).
 */

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

function step(id: string, status: MissionStepDto['status']): MissionStepDto {
  return { id, position: 1, title: id, status, agent: 'claude-code', role: 'general' };
}

type Options = {
  missions?: MissionDto[];
  projects?: 'pending' | 'error' | ProjectSummary[];
  steps?: MissionStepDto[];
};

function installApi({ missions = [], projects = [project], steps = [] }: Options = {}) {
  const api = {
    projects: {
      list: vi.fn(() => {
        if (projects === 'pending') return new Promise(() => undefined);
        if (projects === 'error') return Promise.reject(new Error('falhou'));
        return Promise.resolve({ ok: true, data: projects });
      }),
    },
    missions: {
      list: vi.fn(() => Promise.resolve({ ok: true, data: missions })),
      create: vi.fn(() => Promise.resolve({ ok: true, data: missionOf({ id: 'nova' }) })),
      plan: vi.fn(() => Promise.resolve({ ok: true, data: { missionId: 'nova', steps: [] } })),
      get: vi.fn(() =>
        Promise.resolve<AppResult<MissionViewDto>>({
          ok: true,
          data: { steps, pendingApprovals: [] } as unknown as MissionViewDto,
        }),
      ),
      subscribe: vi.fn(() => () => undefined),
    },
  };
  window.projectHub = api as unknown as ProjectHubApi;
  return api;
}

let current: { pathname: string; search: string; state: unknown } = {
  pathname: '',
  search: '',
  state: null,
};
function Probe() {
  const location = useLocation();
  current = { pathname: location.pathname, search: location.search, state: location.state };
  return null;
}

function renderMissions(
  options: { search?: string; state?: unknown; shownProject?: ProjectSummary | null } = {},
) {
  const { search = '?visao=missoes', state, shownProject = project } = options;
  return render(
    <MemoryRouter initialEntries={[{ pathname: '/workspaces/p1', search, state }]}>
      <Probe />
      <Routes>
        <Route
          path="/workspaces/:projectId"
          element={<ProjectMissions projectId="p1" project={shownProject ?? undefined} />}
        />
        <Route path={ROUTE_PATHS.missionDetail} element={<p>Missão aberta</p>} />
      </Routes>
    </MemoryRouter>,
  );
}

async function preencher(user: ReturnType<typeof userEvent.setup>) {
  await user.type(screen.getByLabelText('Título'), 'Nova missão');
  await user.type(screen.getByLabelText('Objetivo'), 'Fazer algo');
  await user.type(screen.getByLabelText('Critérios de aceite'), 'Algo pronto');
}

afterEach(() => {
  Reflect.deleteProperty(window, 'projectHub');
});

describe('ProjectMissions: lista', () => {
  it('lista as missões do projeto com o estado e o progresso das tarefas', async () => {
    installApi({
      missions: [missionOf({ id: 'm1', title: 'Ajustar login', status: 'running' })],
      steps: [step('a', 'succeeded'), step('b', 'running')],
    });
    renderMissions();

    const link = await screen.findByRole('link', { name: 'Ajustar login' });
    expect(link).toHaveAttribute('href', '/workspaces/p1/missoes/m1');
    expect(
      await screen.findByRole('progressbar', {
        name: 'Progresso de Ajustar login: 1 de 2 tarefas',
      }),
    ).toBeInTheDocument();
    expect(screen.queryByText('Nenhuma missão ainda.')).not.toBeInTheDocument();
    expect(screen.queryByRole('form', { name: 'Nova missão' })).not.toBeInTheDocument();
  });

  it('só mostra as missões do próprio projeto', async () => {
    const api = installApi({ missions: [missionOf({ id: 'm1', title: 'Do p1' })] });
    api.projects.list.mockResolvedValue({
      ok: true,
      data: [project, { ...project, id: 'p2', name: 'Outro' }],
    });
    api.missions.list.mockImplementation(((projectId: string) =>
      Promise.resolve({
        ok: true,
        data:
          projectId === 'p1'
            ? [missionOf({ id: 'm1', title: 'Do p1' })]
            : [missionOf({ id: 'm2', projectId: 'p2', title: 'Do p2' })],
      })) as never);
    renderMissions();

    expect(await screen.findByRole('link', { name: 'Do p1' })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Do p2' })).not.toBeInTheDocument();
  });

  it('sem missões, mostra uma linha e o botão Nova missão ali mesmo', async () => {
    installApi();
    renderMissions();

    expect(await screen.findByText('Nenhuma missão ainda.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Nova missão' })).toBeInTheDocument();
    expect(screen.queryByText('Comece sua primeira missão')).not.toBeInTheDocument();
  });

  it('o botão da lista vazia abre o formulário', async () => {
    installApi();
    renderMissions();

    await userEvent.click(await screen.findByRole('button', { name: 'Nova missão' }));

    expect(screen.getByRole('form', { name: 'Nova missão' })).toBeInTheDocument();
    expect(screen.queryByText('Nenhuma missão ainda.')).not.toBeInTheDocument();
  });

  it('enquanto a lista carrega, não diz que não há missões', async () => {
    installApi({ projects: 'pending' });
    renderMissions({ shownProject: null });

    expect(await screen.findByText('Carregando…')).toBeInTheDocument();
    expect(screen.queryByText('Nenhuma missão ainda.')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Nova missão' })).not.toBeInTheDocument();
  });

  it('com a leitura falha, mostra o erro e não diz que não há missões', async () => {
    installApi({ projects: 'error' });
    renderMissions({ shownProject: null });

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Não foi possível carregar as missões.',
    );
    expect(screen.queryByText('Nenhuma missão ainda.')).not.toBeInTheDocument();
  });

  it('projeto que não está na lista dos ativos não mostra a frase de vazio', async () => {
    installApi({ projects: [{ ...project, id: 'outro', name: 'Outro' }] });
    renderMissions({ shownProject: null });

    await waitFor(() => expect(window.projectHub.projects.list).toHaveBeenCalled());
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(screen.queryByText('Nenhuma missão ainda.')).not.toBeInTheDocument();
  });
});

describe('ProjectMissions: o formulário abre pelo pedido da rota', () => {
  it('state.newMission abre o formulário e a rota é limpa, mantendo a visão', async () => {
    installApi();
    renderMissions({ state: { newMission: true } });

    expect(await screen.findByRole('form', { name: 'Nova missão' })).toBeInTheDocument();
    await waitFor(() => expect(current.state).toBeNull());
    expect(current.pathname).toBe('/workspaces/p1');
    expect(current.search).toBe('?visao=missoes');
  });

  it('?nova-missao=1 abre o formulário e tira só esse parâmetro', async () => {
    installApi();
    renderMissions({ search: '?visao=missoes&nova-missao=1' });

    expect(await screen.findByRole('form', { name: 'Nova missão' })).toBeInTheDocument();
    await waitFor(() => expect(current.search).toBe('?visao=missoes'));
  });

  it('o foco do formulário aberto fica no Objetivo', async () => {
    installApi();
    renderMissions({ state: { newMission: true } });

    await screen.findByRole('form', { name: 'Nova missão' });
    expect(screen.getByLabelText('Objetivo')).toHaveFocus();
  });

  it('sem pedido, a lista aparece e o formulário não', async () => {
    installApi({ missions: [missionOf({ title: 'Ajustar login' })] });
    renderMissions();

    await screen.findByRole('link', { name: 'Ajustar login' });
    expect(screen.queryByRole('form', { name: 'Nova missão' })).not.toBeInTheDocument();
  });
});

describe('ProjectMissions: criar missão', () => {
  it('o formulário é o compositor: sem blocos numerados nem dicas por campo', async () => {
    installApi();
    renderMissions({ state: { newMission: true } });

    const form = await screen.findByRole('form', { name: 'Nova missão' });
    expect(within(form).queryByText('O que fazer')).not.toBeInTheDocument();
    expect(within(form).queryByText('Como saber que ficou pronto')).not.toBeInTheDocument();
    expect(form.querySelector('.field-hint, .check__hint')).toBeNull();
    expect(within(form).getByRole('button', { name: 'Criar e orquestrar' })).toBeInTheDocument();
  });

  it('Criar chama create, sem gerar o plano, e abre a missão', async () => {
    const api = installApi();
    const user = userEvent.setup();
    renderMissions({ state: { newMission: true } });
    await screen.findByRole('form', { name: 'Nova missão' });

    await preencher(user);
    await user.click(screen.getByRole('button', { name: 'Criar' }));

    expect(api.missions.create).toHaveBeenCalledWith({
      projectId: 'p1',
      title: 'Nova missão',
      objective: 'Fazer algo',
      acceptanceCriteria: ['Algo pronto'],
      altersCode: false,
    });
    expect(api.missions.plan).not.toHaveBeenCalled();
    expect(await screen.findByText('Missão aberta')).toBeInTheDocument();
    expect(current.pathname).toBe('/workspaces/p1/missoes/nova');
  });

  it('Criar e orquestrar cria sem chamar o plano aqui e abre a missão pedindo o plano', async () => {
    const api = installApi();
    const user = userEvent.setup();
    renderMissions({ state: { newMission: true } });
    await screen.findByRole('form', { name: 'Nova missão' });

    await preencher(user);
    await user.click(screen.getByRole('button', { name: 'Criar e orquestrar' }));

    expect(api.missions.create).toHaveBeenCalledTimes(1);
    expect(api.missions.plan).not.toHaveBeenCalled();
    expect(await screen.findByText('Missão aberta')).toBeInTheDocument();
    expect(current.pathname).toBe('/workspaces/p1/missoes/nova');
    expect(current.state).toEqual({ orchestrate: true });
  });

  it('Cancelar volta à lista, sem criar nada', async () => {
    const api = installApi({ missions: [missionOf({ title: 'Ajustar login' })] });
    const user = userEvent.setup();
    renderMissions({ state: { newMission: true } });
    await screen.findByRole('form', { name: 'Nova missão' });

    await user.click(screen.getByRole('button', { name: 'Cancelar' }));

    expect(screen.queryByRole('form', { name: 'Nova missão' })).not.toBeInTheDocument();
    expect(await screen.findByRole('link', { name: 'Ajustar login' })).toBeInTheDocument();
    expect(api.missions.create).not.toHaveBeenCalled();
  });

  it('a falha ao criar aparece como alerta, e o formulário continua preenchido', async () => {
    const api = installApi();
    api.missions.create.mockResolvedValueOnce({
      ok: false,
      error: {
        code: 'VALIDATION_FAILED',
        message: 'Informe ao menos um critério de aceite.',
        retryable: false,
      },
    } as unknown as { ok: true; data: MissionDto });
    const user = userEvent.setup();
    renderMissions({ state: { newMission: true } });
    await screen.findByRole('form', { name: 'Nova missão' });

    await preencher(user);
    await user.click(screen.getByRole('button', { name: 'Criar' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Informe ao menos um critério de aceite.',
    );
    expect(screen.getByRole('form', { name: 'Nova missão' })).toBeInTheDocument();
    expect(screen.getByLabelText('Título')).toHaveValue('Nova missão');
    expect(api.missions.plan).not.toHaveBeenCalled();
  });

  it('em projeto sem Git, o aviso aparece e Criar fica desabilitado', async () => {
    installApi();
    renderMissions({
      state: { newMission: true },
      shownProject: { ...project, repositoryKind: 'none' } as ProjectSummary,
    });

    const form = await screen.findByRole('form', { name: 'Nova missão' });

    expect(within(form).getByText(/Este projeto não é um repositório Git/)).toBeInTheDocument();
    expect(within(form).getByRole('button', { name: 'Criar' })).toBeDisabled();
  });
});
