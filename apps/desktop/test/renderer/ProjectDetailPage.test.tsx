import { render, screen, waitFor, within } from '@testing-library/react';
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
      openFolder: vi.fn(() => Promise.resolve<AppResult<void>>({ ok: true, data: undefined })),
      setGroup: vi.fn(() => Promise.resolve<AppResult<void>>({ ok: true, data: undefined })),
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
    terminals: { list: vi.fn(() => Promise.resolve({ ok: true, data: [] })) },
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
    expect(screen.getByText('Branch: main')).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Missões' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByText('Comece sua primeira missão')).toBeInTheDocument();
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
    // Cada selo leva o ícone do estado; o texto continua sendo o que o leitor de tela lê.
    expect(within(cards[1]!).getByText('Em execução').querySelector('svg')).toHaveAttribute(
      'aria-hidden',
      'true',
    );
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
    expect(itemOf('Missões')).toHaveTextContent('6');
    expect(itemOf('Em execução')).toHaveTextContent('2');
    expect(itemOf('Aguardam você')).toHaveTextContent('2');
    expect(itemOf('Concluídas')).toHaveTextContent('1');
    expect(screen.queryByText('Disponível na próxima etapa.')).not.toBeInTheDocument();
  });

  it('Repositório mostra o tipo, a branch padrão e a pasta', async () => {
    installApi([]);
    renderAt('/projects/p1');

    await userEvent.click(await screen.findByRole('tab', { name: 'Repositório' }));

    const panel = screen.getByRole('tabpanel');
    expect(within(panel).getByText('Repositório Git')).toBeInTheDocument();
    expect(within(panel).getByText('main')).toBeInTheDocument();
    // Só o nome da pasta aparece; o caminho inteiro fica na dica e no botão de copiar.
    expect(within(panel).getByText('Project Hub')).toHaveAttribute(
      'title',
      'C:\\Projetos\\Project Hub',
    );
    expect(screen.queryByText('Disponível na próxima etapa.')).not.toBeInTheDocument();
  });

  it('Abrir pasta pede ao processo principal pelo id do projeto, e não pelo caminho', async () => {
    const api = installApi([]);
    renderAt('/projects/p1');
    await userEvent.click(await screen.findByRole('tab', { name: 'Repositório' }));

    await userEvent.click(screen.getByRole('button', { name: 'Abrir pasta' }));

    expect(api.projects.openFolder).toHaveBeenCalledWith('p1');
  });

  it('Copiar caminho copia o caminho inteiro e avisa que copiou', async () => {
    installApi([]);
    const writeText = vi.fn(() => Promise.resolve());
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    renderAt('/projects/p1');
    await userEvent.click(await screen.findByRole('tab', { name: 'Repositório' }));

    await userEvent.click(screen.getByRole('button', { name: 'Copiar caminho' }));

    expect(writeText).toHaveBeenCalledWith('C:\\Projetos\\Project Hub');
    expect(await screen.findByText('Copiado')).toBeInTheDocument();
  });

  it('a Visão geral destaca o que espera a pessoa e lista as missões recentes', async () => {
    installApi([
      missionOf({ id: 'a', title: 'Revisar combate', status: 'review' }),
      missionOf({ id: 'b', title: 'Criar inventário', status: 'running' }),
    ]);
    renderAt('/projects/p1');

    await userEvent.click(await screen.findByRole('tab', { name: 'Visão geral' }));

    const attention = screen.getByRole('region', { name: 'Precisa de você' });
    expect(within(attention).getByText('Revisar combate')).toBeInTheDocument();
    expect(within(attention).getByText('Revisar a conclusão')).toBeInTheDocument();
    const recent = screen.getByRole('region', { name: 'Missões recentes' });
    expect(within(recent).getByText('Criar inventário')).toBeInTheDocument();
  });

  it('a Visão geral de um projeto sem missões mostra o convite, sem as listas', async () => {
    installApi([]);
    renderAt('/projects/p1');

    await userEvent.click(await screen.findByRole('tab', { name: 'Visão geral' }));

    expect(screen.getByText('Comece sua primeira missão')).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Missões recentes' })).not.toBeInTheDocument();
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

    await userEvent.click(await screen.findByRole('tab', { name: 'Configurações' }));
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
    await screen.findByText('Comece sua primeira missão');

    await userEvent.click(screen.getByRole('button', { name: 'Nova missão' }));
    const form = screen.getByRole('form', { name: 'Nova missão' });

    expect(within(form).getByText(/Este projeto não é um repositório Git/)).toBeInTheDocument();
    expect(within(form).getByRole('button', { name: 'Criar missão' })).toBeDisabled();
  });

  it('criar e planejar leva ao workspace da missão', async () => {
    const api = installApi([]);
    renderAt('/projects/p1');
    await screen.findByText('Comece sua primeira missão');

    await userEvent.click(screen.getByRole('button', { name: 'Nova missão' }));
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
    await screen.findByText('Comece sua primeira missão');

    await userEvent.click(screen.getByRole('button', { name: 'Nova missão' }));
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
    await screen.findByText('Comece sua primeira missão');

    await userEvent.click(screen.getByRole('button', { name: 'Nova missão' }));
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

    await user.click(await screen.findByRole('button', { name: 'Mais ações' }));
    await user.click(await screen.findByRole('menuitem', { name: 'Arquivar projeto' }));

    expect(api.projects.archive).toHaveBeenCalledWith('p1');
    expect(await screen.findByText('Lista de projetos')).toBeInTheDocument();
    expect(avisos).toHaveBeenCalled();
    window.removeEventListener(PROJECTS_CHANGED_EVENT, avisos);
  });

  it('Remover da lista pede confirmação antes de tirar o projeto', async () => {
    const api = installApi([]);
    const user = userEvent.setup();
    renderAt('/projects/p1');

    await user.click(await screen.findByRole('button', { name: 'Mais ações' }));
    await user.click(await screen.findByRole('menuitem', { name: 'Remover da lista' }));
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
          'Há missões ativas ou aguardando início neste projeto. Cancele ou aguarde antes de arquivar ou remover.',
        retryable: false,
      },
    });
    const user = userEvent.setup();
    renderAt('/projects/p1');

    await user.click(await screen.findByRole('button', { name: 'Mais ações' }));
    await user.click(await screen.findByRole('menuitem', { name: 'Arquivar projeto' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Há missões ativas ou aguardando início',
    );
    expect(screen.getByRole('heading', { level: 1, name: 'Project Hub' })).toBeInTheDocument();
    expect(screen.queryByText('Lista de projetos')).not.toBeInTheDocument();
  });
});

describe('ProjectDetailPage: grupo do projeto', () => {
  it('Mover para grupo abre o formulário, grava o grupo e avisa a barra lateral', async () => {
    const api = installApi([]);
    const avisos = vi.fn();
    window.addEventListener(PROJECTS_CHANGED_EVENT, avisos);
    const user = userEvent.setup();
    renderAt('/projects/p1');

    await user.click(await screen.findByRole('button', { name: 'Mais ações' }));
    await user.click(await screen.findByRole('menuitem', { name: 'Mover para grupo…' }));
    const form = screen.getByRole('form', { name: 'Grupo do projeto' });
    await user.type(within(form).getByLabelText('Grupo'), 'Trabalho');
    await user.click(within(form).getByRole('button', { name: 'Salvar' }));

    expect(api.projects.setGroup).toHaveBeenCalledWith('p1', 'Trabalho');
    await waitFor(() => expect(avisos).toHaveBeenCalled());
    expect(screen.queryByRole('form', { name: 'Grupo do projeto' })).not.toBeInTheDocument();
    window.removeEventListener(PROJECTS_CHANGED_EVENT, avisos);
  });

  it('projeto que já tem grupo mostra a etiqueta e oferece Tirar do grupo', async () => {
    const api = installApi([]);
    api.projects.list.mockResolvedValue({
      ok: true,
      data: [{ ...project, group: 'Pessoal' }],
    } as never);
    const user = userEvent.setup();
    renderAt('/projects/p1');

    expect(await screen.findByText('Grupo: Pessoal')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Mais ações' }));
    await user.click(await screen.findByRole('menuitem', { name: 'Mover para grupo…' }));
    await user.click(screen.getByRole('button', { name: 'Tirar do grupo' }));

    expect(api.projects.setGroup).toHaveBeenCalledWith('p1', null);
  });

  it('falha ao gravar mostra a mensagem e mantém o formulário', async () => {
    const api = installApi([]);
    api.projects.setGroup.mockResolvedValueOnce({
      ok: false,
      error: { code: 'VALIDATION_FAILED', message: 'Nome longo demais.', retryable: false },
    });
    const user = userEvent.setup();
    renderAt('/projects/p1');

    await user.click(await screen.findByRole('button', { name: 'Mais ações' }));
    await user.click(await screen.findByRole('menuitem', { name: 'Mover para grupo…' }));
    await user.type(screen.getByLabelText('Grupo'), 'x');
    await user.click(screen.getByRole('button', { name: 'Salvar' }));

    expect(await screen.findByText('Nome longo demais.')).toBeInTheDocument();
    expect(screen.getByRole('form', { name: 'Grupo do projeto' })).toBeInTheDocument();
  });

  it('chegando da lateral com newMission, a aba Missões abre com o formulário', async () => {
    installApi([]);
    render(
      <MemoryRouter initialEntries={[{ pathname: '/projects/p1', state: { newMission: true } }]}>
        <Routes>
          <Route path={ROUTE_PATHS.projectDetail} element={<ProjectDetailPage />} />
        </Routes>
      </MemoryRouter>,
    );

    expect(await screen.findByRole('form', { name: 'Nova missão' })).toBeInTheDocument();
  });
});
