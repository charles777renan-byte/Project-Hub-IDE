import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type {
  MissionDto,
  MissionEventDto,
  ProjectHubApi,
  ProjectSummary,
} from '@project-hub/contracts';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter, Route, Routes } from 'react-router';
import { Sidebar } from '../../src/renderer/components/Sidebar';
import { ROUTE_PATHS } from '../../src/renderer/routes';

// Barra lateral (Tarefa 4 do plano da interface): projetos na seção Projetos e, na rota de um projeto,
// as missões dele na seção Missões. O `window.projectHub` é falso, como o preload entregaria.

const gitProject: ProjectSummary = {
  id: 'p1',
  name: 'Project Hub',
  path: 'C:\\Projetos\\Project Hub',
  repositoryKind: 'git',
  available: true,
  defaultBranch: 'main',
};

const plainProject: ProjectSummary = {
  id: 'p2',
  name: 'Notas',
  path: 'C:\\Notas',
  repositoryKind: 'none',
  available: true,
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

type Fixture = {
  projects: ProjectSummary[];
  missions: Record<string, MissionDto[]>;
};

/** Instala a API falsa. `emit` dispara os ouvintes de eventos de missão, como o processo principal faria. */
function installApi(fixture: Partial<Fixture> = {}) {
  const state: Fixture = {
    projects: fixture.projects ?? [gitProject, plainProject],
    missions: fixture.missions ?? {},
  };
  const listeners: Array<(event: MissionEventDto) => void> = [];
  const unsubscribe = vi.fn();
  const api = {
    projects: {
      list: vi.fn(() => Promise.resolve({ ok: true, data: state.projects })),
    },
    missions: {
      list: vi.fn((projectId: string) =>
        Promise.resolve({ ok: true, data: state.missions[projectId] ?? [] }),
      ),
      subscribe: vi.fn((listener: (event: MissionEventDto) => void) => {
        listeners.push(listener);
        return unsubscribe;
      }),
    },
  };
  window.projectHub = api as unknown as ProjectHubApi;
  return {
    api,
    state,
    unsubscribe,
    emit: () => {
      for (const listener of listeners) listener({} as MissionEventDto);
    },
  };
}

/** Barra e rotas de destino, para ver para onde os botões levam. */
function renderSidebar(path: string, props: { currentProjectId?: string } = {}) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Sidebar {...props} />
      <Routes>
        <Route path={ROUTE_PATHS.home} element={<p>Página inicial</p>} />
        <Route path={ROUTE_PATHS.projects} element={<p>Página de projetos</p>} />
        <Route path={ROUTE_PATHS.projectDetail} element={<p>Página do projeto</p>} />
        <Route path={ROUTE_PATHS.missionDetail} element={<p>Página da missão</p>} />
      </Routes>
    </MemoryRouter>,
  );
}

afterEach(() => {
  Reflect.deleteProperty(window, 'projectHub');
});

describe('Sidebar: seção Projetos', () => {
  it('lista os projetos pelo nome, dentro de uma barra com nome acessível', async () => {
    installApi();
    renderSidebar('/');

    const bar = screen.getByRole('complementary', { name: 'Projetos e missões' });
    const projects = await within(bar).findByRole('region', { name: 'Projetos' });
    expect(within(projects).getByRole('link', { name: 'Project Hub' })).toBeInTheDocument();
    expect(within(projects).getByRole('link', { name: 'Notas' })).toBeInTheDocument();
  });

  it('marca o projeto da rota atual com aria-current, e só ele', async () => {
    installApi();
    renderSidebar('/projects/p1');

    const projects = await screen.findByRole('region', { name: 'Projetos' });
    expect(within(projects).getByRole('link', { name: 'Project Hub' })).toHaveAttribute(
      'aria-current',
      'page',
    );
    expect(within(projects).getByRole('link', { name: 'Notas' })).not.toHaveAttribute(
      'aria-current',
    );
  });

  it('projeto sem Git leva o chip "sem Git" e o projeto com Git não leva', async () => {
    installApi();
    renderSidebar('/');

    const projects = await screen.findByRole('region', { name: 'Projetos' });
    const notas = within(projects).getByRole('link', { name: 'Notas' }).closest('li');
    const hub = within(projects).getByRole('link', { name: 'Project Hub' }).closest('li');
    expect(notas).toHaveTextContent('sem Git');
    expect(notas?.querySelector('.chip')).toHaveClass('chip--muted');
    expect(hub).not.toHaveTextContent('sem Git');
  });

  it('+ Novo projeto leva à página de Projetos', async () => {
    installApi();
    renderSidebar('/');

    await userEvent.click(await screen.findByRole('button', { name: '+ Novo projeto' }));
    expect(screen.getByText('Página de projetos')).toBeInTheDocument();
  });

  it('nome de projeto com marcação aparece como texto, sem virar elemento', async () => {
    installApi({ projects: [{ ...gitProject, id: 'p3', name: '<b>x</b>' }] });
    renderSidebar('/');

    const projects = await screen.findByRole('region', { name: 'Projetos' });
    expect(within(projects).getByText('<b>x</b>')).toBeInTheDocument();
    expect(document.querySelector('b')).toBeNull();
  });
});

describe('Sidebar: seção Missões', () => {
  it('na rota de um projeto, lista as missões dele com a situação de cada uma', async () => {
    installApi({
      missions: {
        p1: [
          missionOf({ id: 'm1', title: 'Ajustar login', status: 'planned' }),
          missionOf({ id: 'm2', title: 'Documentar API', status: 'running' }),
        ],
      },
    });
    renderSidebar('/projects/p1');

    const missions = await screen.findByRole('region', { name: 'Missões' });
    const login = within(missions).getByRole('link', { name: 'Ajustar login' });
    expect(login).toHaveAttribute('href', '/projects/p1/missions/m1');
    expect(within(missions).getByRole('link', { name: 'Documentar API' })).toHaveAttribute(
      'href',
      '/projects/p1/missions/m2',
    );
    expect(within(missions).getByText('Aguarda aprovação do plano')).toBeInTheDocument();
    expect(within(missions).getByText('Em execução')).toBeInTheDocument();
  });

  it('na rota de uma missão, a seção Missões também aparece, com o projeto dela', async () => {
    installApi({ missions: { p1: [missionOf({ id: 'm1', title: 'Ajustar login' })] } });
    renderSidebar('/projects/p1/missions/m1');

    const missions = await screen.findByRole('region', { name: 'Missões' });
    expect(within(missions).getByRole('link', { name: 'Ajustar login' })).toHaveAttribute(
      'aria-current',
      'page',
    );
  });

  it('fora de rota de projeto, a seção Missões não aparece', async () => {
    installApi({ missions: { p1: [missionOf({ id: 'm1' })] } });
    renderSidebar('/projects');

    await screen.findByRole('region', { name: 'Projetos' });
    expect(screen.queryByRole('region', { name: 'Missões' })).toBeNull();
  });

  it('currentProjectId diz qual projeto mostrar quando a rota não diz', async () => {
    installApi({ missions: { p2: [missionOf({ id: 'm9', projectId: 'p2', title: 'Anotar' })] } });
    renderSidebar('/', { currentProjectId: 'p2' });

    const missions = await screen.findByRole('region', { name: 'Missões' });
    expect(within(missions).getByRole('link', { name: 'Anotar' })).toBeInTheDocument();
  });

  it('+ Nova missão leva à aba de missões do projeto', async () => {
    installApi({ missions: { p1: [missionOf({ id: 'm1' })] } });
    renderSidebar('/projects/p1/missions/m1');

    const missions = await screen.findByRole('region', { name: 'Missões' });
    await userEvent.click(within(missions).getByRole('button', { name: '+ Nova missão' }));
    expect(screen.getByText('Página do projeto')).toBeInTheDocument();
  });
});

describe('Sidebar: carregamento e atualização', () => {
  it.each([
    ['a chamada de projetos quebra', () => Promise.reject(new Error('quebrou'))],
    [
      'a lista de projetos devolve erro',
      () => Promise.resolve({ ok: false, error: { code: 'X', message: 'x', retryable: false } }),
    ],
  ])('quando %s, mostra a mensagem e a página continua', async (_caso, list) => {
    window.projectHub = {
      projects: { list: vi.fn(list) },
      missions: { list: vi.fn(), subscribe: vi.fn(() => () => undefined) },
    } as unknown as ProjectHubApi;
    renderSidebar('/');

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Não foi possível carregar os projetos. Tente de novo.',
    );
    expect(screen.getByText('Página inicial')).toBeInTheDocument();
  });

  it('se a lista de missões de um projeto falha, mostra a mensagem geral', async () => {
    window.projectHub = {
      projects: {
        list: vi.fn(() => Promise.resolve({ ok: true, data: [gitProject] })),
      },
      missions: {
        list: vi.fn(() =>
          Promise.resolve({ ok: false, error: { code: 'X', message: 'x', retryable: false } }),
        ),
        subscribe: vi.fn(() => () => undefined),
      },
    } as unknown as ProjectHubApi;
    renderSidebar('/');

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Não foi possível carregar os projetos. Tente de novo.',
    );
    expect(screen.getByText('Página inicial')).toBeInTheDocument();
  });

  it('sem o preload (ambiente de teste), não derruba a página', async () => {
    renderSidebar('/');

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Não foi possível carregar os projetos. Tente de novo.',
    );
    expect(screen.getByText('Página inicial')).toBeInTheDocument();
  });

  it('cancela a assinatura de eventos ao desmontar', async () => {
    const { unsubscribe } = installApi();
    const { unmount } = renderSidebar('/');

    await screen.findByRole('region', { name: 'Projetos' });
    expect(unsubscribe).not.toHaveBeenCalled();
    unmount();
    expect(unsubscribe).toHaveBeenCalledTimes(1);
  });

  it('recarrega as missões quando chega um evento de missão', async () => {
    const { state, emit } = installApi({
      missions: { p1: [missionOf({ id: 'm1', title: 'Ajustar login' })] },
    });
    renderSidebar('/projects/p1');

    const missions = await screen.findByRole('region', { name: 'Missões' });
    expect(within(missions).queryByRole('link', { name: 'Documentar API' })).toBeNull();

    state.missions['p1'] = [
      missionOf({ id: 'm2', title: 'Documentar API' }),
      missionOf({ id: 'm1', title: 'Ajustar login' }),
    ];
    emit();

    expect(
      await within(missions).findByRole('link', { name: 'Documentar API' }),
    ).toBeInTheDocument();
  });

  it('recarrega os projetos ao trocar de página, para um projeto novo aparecer', async () => {
    const { state } = installApi({ projects: [gitProject] });
    renderSidebar('/');

    const projects = await screen.findByRole('region', { name: 'Projetos' });
    expect(within(projects).queryByRole('link', { name: 'Notas' })).toBeNull();

    state.projects = [gitProject, plainProject];
    await userEvent.click(screen.getByRole('button', { name: '+ Novo projeto' }));

    expect(await within(projects).findByRole('link', { name: 'Notas' })).toBeInTheDocument();
  });

  /** Projetos com as respostas guardadas, para o teste decidir a ordem em que elas chegam. */
  function installPendingProjects() {
    const replies: Array<(data: ProjectSummary[]) => void> = [];
    let onEvent: () => void = () => undefined;
    window.projectHub = {
      projects: {
        list: vi.fn(
          () =>
            new Promise((resolve) => {
              replies.push((data) => resolve({ ok: true, data }));
            }),
        ),
      },
      missions: {
        list: vi.fn(() => Promise.resolve({ ok: true, data: [] })),
        subscribe: vi.fn((listener: () => void) => {
          onEvent = listener;
          return () => undefined;
        }),
      },
    } as unknown as ProjectHubApi;
    return { replies, fireEvent: () => onEvent() };
  }

  it('um evento que chega com a carga ainda em curso não a cancela', async () => {
    const { replies, fireEvent } = installPendingProjects();
    renderSidebar('/');
    await waitFor(() => expect(replies).toHaveLength(1));

    act(() => fireEvent());
    await waitFor(() => expect(replies).toHaveLength(2));
    await act(async () => replies[0]!([gitProject]));

    expect(await screen.findByRole('link', { name: 'Project Hub' })).toBeInTheDocument();
  });

  it('a carga mais nova vence, mesmo quando a antiga responde depois', async () => {
    const { replies, fireEvent } = installPendingProjects();
    renderSidebar('/');
    await waitFor(() => expect(replies).toHaveLength(1));

    act(() => fireEvent());
    await waitFor(() => expect(replies).toHaveLength(2));
    await act(async () => replies[1]!([gitProject, plainProject]));
    expect(await screen.findByRole('link', { name: 'Notas' })).toBeInTheDocument();

    await act(async () => replies[0]!([gitProject]));
    expect(screen.getByRole('link', { name: 'Notas' })).toBeInTheDocument();
  });
});
