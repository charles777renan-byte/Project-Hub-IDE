import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type {
  AppResult,
  MissionDto,
  MissionEventDto,
  ProjectHubApi,
  ProjectSummary,
  TerminalSummary,
} from '@project-hub/contracts';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router';
import { Sidebar } from '../../src/renderer/components/Sidebar';
import {
  ADD_PROJECT_REQUEST_EVENT,
  PROJECTS_CHANGED_EVENT,
} from '../../src/renderer/projects-events';
import { ROUTE_PATHS } from '../../src/renderer/routes';

// Barra lateral (explorador): busca, aviso do que espera a pessoa, "Adicionar projeto", espaços (lista ou
// grade, com grupos opcionais, cada projeto com as sessões em cartões) e, no fim, os projetos arquivados. O
// `window.projectHub` é falso, como o preload entregaria.

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

function terminalOf(overrides: Partial<TerminalSummary>): TerminalSummary {
  return {
    id: 't1',
    kind: 'shell',
    title: 'PowerShell · Project Hub',
    projectId: 'p1',
    projectName: 'Project Hub',
    state: 'running',
    provider: 'shell',
    origin: 'new',
    ...overrides,
  };
}

const archivedProject: ProjectSummary = {
  id: 'p9',
  name: 'Antigo',
  path: 'C:\\Projetos\\Antigo',
  repositoryKind: 'git',
  available: true,
};

type Fixture = {
  projects: ProjectSummary[];
  archived: ProjectSummary[];
  missions: Record<string, MissionDto[]>;
  terminals: TerminalSummary[];
};

/** Instala a API falsa. `emit` dispara os ouvintes de eventos de missão, como o processo principal faria. */
function installApi(fixture: Partial<Fixture> = {}) {
  const state: Fixture = {
    projects: fixture.projects ?? [gitProject, plainProject],
    archived: fixture.archived ?? [],
    missions: fixture.missions ?? {},
    terminals: fixture.terminals ?? [],
  };
  const listeners: Array<(event: MissionEventDto) => void> = [];
  const unsubscribe = vi.fn();
  const api = {
    projects: {
      list: vi.fn(() => Promise.resolve({ ok: true, data: state.projects })),
      listArchived: vi.fn(() => Promise.resolve({ ok: true, data: state.archived })),
      chooseDirectory: vi.fn((): Promise<AppResult<{ path: string } | null>> =>
        Promise.resolve({ ok: true, data: null }),
      ),
      add: vi.fn((): Promise<AppResult<ProjectSummary>> =>
        Promise.reject(new Error('add não deveria ser chamado')),
      ),
      unarchive: vi.fn((id: string): Promise<AppResult<undefined>> =>
        Promise.reject(new Error(`unarchive(${id}) não deveria ser chamado`)),
      ),
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
    terminals: {
      list: vi.fn((): Promise<AppResult<TerminalSummary[]>> =>
        Promise.resolve({ ok: true, data: state.terminals }),
      ),
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

/** Mostra a rota de destino e o estado do roteador que o clique levou até ela. */
function Destination({ label }: { label: string }) {
  const location = useLocation();
  return (
    <p>
      {label} {JSON.stringify(location.state)}
    </p>
  );
}

/** Barra e rotas de destino, para ver para onde os botões levam. */
function renderSidebar(path: string, props: { onSearch?: () => void } = {}) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Sidebar {...props} />
      <Routes>
        <Route path={ROUTE_PATHS.home} element={<p>Página inicial</p>} />
        <Route path={ROUTE_PATHS.projectDetail} element={<p>Página do projeto</p>} />
        <Route path={ROUTE_PATHS.missionDetail} element={<p>Página da missão</p>} />
        <Route path={ROUTE_PATHS.workspace} element={<Destination label="Workspace" />} />
      </Routes>
    </MemoryRouter>,
  );
}

afterEach(() => {
  Reflect.deleteProperty(window, 'projectHub');
  window.localStorage.clear();
});

async function spaces() {
  return screen.findByRole('region', { name: 'Espaços' });
}

/** O botão que expande as sessões de um projeto. */
function expandOf(name: string) {
  return screen.getByRole('button', { name: `Sessões de ${name}` });
}

describe('Sidebar: estrutura', () => {
  it('é uma barra com nome acessível: busca, adicionar projeto, espaços e arquivados, sem navegação principal', async () => {
    installApi({ archived: [archivedProject] });
    renderSidebar('/', { onSearch: () => undefined });

    const bar = screen.getByRole('complementary', { name: 'Projetos e missões' });
    const search = within(bar).getByRole('button', { name: /Buscar projeto ou agente/ });
    const add = within(bar).getByRole('button', { name: 'Adicionar projeto' });
    const area = await spaces();
    const archived = await within(bar).findByRole('button', { name: /Arquivados/ });
    const follows = (a: Element, b: Element) =>
      Boolean(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);
    expect(follows(search, add)).toBe(true);
    expect(follows(add, area)).toBe(true);
    expect(follows(area, archived)).toBe(true);
    expect(within(bar).queryByRole('navigation')).not.toBeInTheDocument();
    expect(within(bar).queryByRole('link', { name: 'Início' })).not.toBeInTheDocument();
    expect(within(bar).queryByRole('link', { name: 'Projetos' })).not.toBeInTheDocument();
  });

  it('não tem mais a seção Em andamento', async () => {
    installApi();
    renderSidebar('/');

    await spaces();
    expect(screen.queryByRole('region', { name: 'Em andamento' })).not.toBeInTheDocument();
  });

  it('a busca abre a paleta de comandos e mostra o atalho', async () => {
    installApi();
    const onSearch = vi.fn();
    renderSidebar('/', { onSearch });

    const search = screen.getByRole('button', { name: /Buscar projeto ou agente/ });
    expect(search).toHaveAttribute('aria-keyshortcuts', 'Control+K');
    expect(within(search).getByText('Ctrl K')).toBeInTheDocument();
    await userEvent.click(search);

    expect(onSearch).toHaveBeenCalledTimes(1);
  });

  it('sem onSearch, a busca não aparece', async () => {
    installApi();
    renderSidebar('/');

    await spaces();
    expect(screen.queryByRole('button', { name: /Buscar projeto/ })).not.toBeInTheDocument();
  });
});

describe('Sidebar: espaços', () => {
  it('lista os projetos como links para o workspace de cada um, com o nome inteiro no title', async () => {
    installApi();
    renderSidebar('/');

    const area = await spaces();
    expect(within(area).getByRole('link', { name: 'Project Hub' })).toHaveAttribute(
      'href',
      '/workspaces/p1',
    );
    expect(within(area).getByText('Notas')).toHaveAttribute('title', 'Notas');
  });

  it('mostra o apelido no lugar do nome, com o nome da pasta no title', async () => {
    installApi({ projects: [{ ...gitProject, nickname: 'Re_Zero' }, plainProject] });
    renderSidebar('/');

    const area = await spaces();
    const apelido = within(area).getByText('Re_Zero');
    expect(apelido).toHaveAttribute('title', 'Project Hub');
    expect(within(area).queryByText('Project Hub')).not.toBeInTheDocument();
    expect(within(area).getByText('Notas')).toHaveAttribute('title', 'Notas');
  });

  it('marca só o projeto da rota do workspace com aria-current', async () => {
    installApi();
    renderSidebar('/workspaces/p1');

    const area = await spaces();
    expect(within(area).getByRole('link', { name: 'Project Hub' })).toHaveAttribute(
      'aria-current',
      'page',
    );
    expect(within(area).getByRole('link', { name: 'Notas' })).not.toHaveAttribute('aria-current');
  });

  it('projeto sem Git leva o chip "sem Git", e o nome com marcação vira texto', async () => {
    installApi({ projects: [{ ...plainProject, name: '<b>Notas</b>' }, gitProject] });
    renderSidebar('/');

    const area = await spaces();
    expect(within(area).getAllByText('sem Git')).toHaveLength(1);
    expect(within(area).getByText('<b>Notas</b>')).toBeInTheDocument();
    expect(area.querySelector('b')).toBeNull();
  });

  it('cada projeto leva uma marca de cor, que é a mesma sempre', async () => {
    installApi();
    const first = renderSidebar('/');
    const area = await spaces();
    const colors = [...area.querySelectorAll('.swatch')].map((swatch) => swatch.className);
    expect(colors).toHaveLength(2);
    first.unmount();

    installApi();
    renderSidebar('/');
    const again = await spaces();
    expect([...again.querySelectorAll('.swatch')].map((swatch) => swatch.className)).toEqual(
      colors,
    );
  });

  it('sem projetos, avisa; com falha na leitura, mostra o alerta', async () => {
    installApi({ projects: [] });
    const first = renderSidebar('/');
    expect(await screen.findByText('Nenhum projeto ainda.')).toBeInTheDocument();
    first.unmount();

    const { api } = installApi();
    api.projects.list.mockResolvedValue({
      ok: false,
      error: { code: 'UNKNOWN', message: 'Falhou ao ler.', retryable: false },
    } as never);
    renderSidebar('/');
    expect(await screen.findByRole('alert')).toBeInTheDocument();
  });
});

describe('Sidebar: lista, grade e grupos', () => {
  it('Lista é o padrão, e Grade troca os projetos por blocos, sem o botão de expandir', async () => {
    installApi();
    renderSidebar('/');
    const area = await spaces();
    expect(within(area).getByRole('button', { name: 'Lista' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    expect(expandOf('Project Hub')).toBeInTheDocument();

    await userEvent.click(within(area).getByRole('button', { name: 'Grade' }));

    expect(within(area).getByRole('button', { name: 'Grade' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    expect(
      screen.queryByRole('button', { name: 'Sessões de Project Hub' }),
    ).not.toBeInTheDocument();
    expect(area.querySelector('.sidebar__grid')).not.toBeNull();
    expect(within(area).getByRole('link', { name: /^Project Hub/ })).toBeInTheDocument();
  });

  it('a escolha de Grade fica guardada para a próxima vez', async () => {
    installApi();
    const first = renderSidebar('/');
    await userEvent.click(within(await spaces()).getByRole('button', { name: 'Grade' }));
    first.unmount();

    installApi();
    renderSidebar('/');

    expect(within(await spaces()).getByRole('button', { name: 'Grade' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
  });

  it('sem nenhum grupo, a lista é uma só, sem cabeçalhos', async () => {
    installApi();
    renderSidebar('/');

    const area = await spaces();
    expect(area.querySelector('.sidebar__ghead')).toBeNull();
  });

  it('com grupos, cada um ganha cabeçalho com a contagem, em ordem, e os sem grupo vêm por último', async () => {
    installApi({
      projects: [
        { ...gitProject, id: 'a', name: 'Alfa', group: 'Trabalho' },
        { ...gitProject, id: 'b', name: 'Beta', group: 'Pessoal' },
        { ...gitProject, id: 'c', name: 'Gama', group: 'Trabalho' },
        { ...gitProject, id: 'd', name: 'Solto' },
      ],
    });
    renderSidebar('/');

    const area = await spaces();
    const groups = within(area).getAllByRole('region');
    expect(groups.map((group) => group.getAttribute('aria-label'))).toEqual([
      'Grupo Pessoal',
      'Grupo Trabalho',
      'Grupo Sem grupo',
    ]);
    const work = within(area).getByRole('region', { name: 'Grupo Trabalho' });
    expect(work.querySelector('.sidebar__ghead span')).toHaveTextContent('2');
    expect(within(work).getByRole('link', { name: 'Alfa' })).toBeInTheDocument();
    expect(within(work).queryByRole('link', { name: 'Beta' })).not.toBeInTheDocument();
  });
});

describe('Sidebar: rodapé', () => {
  it('não tem mais o botão Nova missão nem o + Projeto', async () => {
    installApi();
    renderSidebar('/projects/p1');

    await spaces();
    expect(screen.queryByRole('button', { name: /Nova missão/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '+ Projeto' })).not.toBeInTheDocument();
  });
});

describe('Sidebar: adicionar projeto', () => {
  const novo: ProjectSummary = {
    id: 'p3',
    name: 'Novo',
    path: 'C:\\Projetos\\Novo',
    repositoryKind: 'none',
    available: true,
  };

  it('escolhe a pasta, cadastra, recarrega a lista e avisa a janela', async () => {
    const { api, state } = installApi();
    api.projects.chooseDirectory.mockResolvedValue({ ok: true, data: { path: novo.path } });
    api.projects.add.mockImplementation(() => {
      state.projects.push(novo);
      return Promise.resolve({ ok: true, data: novo });
    });
    const avisos = vi.fn();
    window.addEventListener(PROJECTS_CHANGED_EVENT, avisos);
    try {
      renderSidebar('/');
      const area = await spaces();
      await within(area).findByText('Notas');

      await userEvent.click(screen.getByRole('button', { name: 'Adicionar projeto' }));

      expect(await within(area).findByRole('link', { name: 'Novo' })).toBeInTheDocument();
      expect(api.projects.chooseDirectory).toHaveBeenCalledTimes(1);
      expect(api.projects.add).toHaveBeenCalledWith({ path: novo.path });
      expect(avisos).toHaveBeenCalledTimes(1);
    } finally {
      window.removeEventListener(PROJECTS_CHANGED_EVENT, avisos);
    }
  });

  it('cancelar o seletor não cadastra nada e não mostra erro', async () => {
    const { api } = installApi();
    renderSidebar('/');
    await spaces();

    await userEvent.click(screen.getByRole('button', { name: 'Adicionar projeto' }));

    await waitFor(() => expect(api.projects.chooseDirectory).toHaveBeenCalledTimes(1));
    expect(api.projects.add).not.toHaveBeenCalled();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('mostra a mensagem da API quando o cadastro é recusado, e mantém a lista', async () => {
    const { api } = installApi();
    api.projects.chooseDirectory.mockResolvedValue({ ok: true, data: { path: gitProject.path } });
    api.projects.add.mockResolvedValue({
      ok: false,
      error: {
        code: 'PROJECT_ALREADY_EXISTS',
        message: 'Esta pasta já está cadastrada.',
        retryable: false,
      },
    });
    renderSidebar('/');
    const area = await spaces();
    await within(area).findByRole('link', { name: 'Project Hub' });

    await userEvent.click(screen.getByRole('button', { name: 'Adicionar projeto' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Esta pasta já está cadastrada.');
    expect(within(area).getByRole('link', { name: 'Project Hub' })).toBeInTheDocument();
  });

  it('mostra a mensagem da API quando o seletor falha', async () => {
    const { api } = installApi();
    api.projects.chooseDirectory.mockResolvedValue({
      ok: false,
      error: { code: 'UNKNOWN', message: 'O seletor não abriu.', retryable: false },
    });
    renderSidebar('/');
    await spaces();

    await userEvent.click(screen.getByRole('button', { name: 'Adicionar projeto' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('O seletor não abriu.');
    expect(api.projects.add).not.toHaveBeenCalled();
  });

  it('mostra uma mensagem geral quando a chamada ao processo principal quebra', async () => {
    const { api } = installApi();
    api.projects.chooseDirectory.mockRejectedValue(new Error('canal fechado'));
    renderSidebar('/');
    await spaces();

    await userEvent.click(screen.getByRole('button', { name: 'Adicionar projeto' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Não foi possível concluir a ação. Tente de novo.',
    );
  });

  it('desabilita o botão enquanto o cadastro está em andamento', async () => {
    const { api } = installApi();
    let finish: (value: AppResult<{ path: string } | null>) => void = () => undefined;
    api.projects.chooseDirectory.mockReturnValue(
      new Promise((resolve) => {
        finish = resolve;
      }),
    );
    renderSidebar('/');
    await spaces();

    await userEvent.click(screen.getByRole('button', { name: 'Adicionar projeto' }));
    expect(screen.getByRole('button', { name: 'Adicionar projeto' })).toBeDisabled();

    await act(async () => finish({ ok: true, data: null }));
    expect(screen.getByRole('button', { name: 'Adicionar projeto' })).toBeEnabled();
  });

  it('o pedido de adicionar projeto vindo de fora (paleta, menu +) abre o seletor uma vez', async () => {
    const { api } = installApi();
    renderSidebar('/');
    await spaces();

    act(() => {
      window.dispatchEvent(new Event(ADD_PROJECT_REQUEST_EVENT));
    });

    await waitFor(() => expect(api.projects.chooseDirectory).toHaveBeenCalledTimes(1));
  });
});

describe('Sidebar: arquivados', () => {
  it('sem projetos arquivados, a seção não aparece', async () => {
    installApi();
    renderSidebar('/');

    await spaces();
    expect(screen.queryByRole('button', { name: /Arquivados/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('list', { name: 'Projetos arquivados' })).not.toBeInTheDocument();
  });

  it('lista os arquivados numa seção recolhível, com a disponibilidade da pasta', async () => {
    installApi({
      archived: [archivedProject, { ...plainProject, id: 'p8', name: 'Sumiu', available: false }],
    });
    renderSidebar('/');

    const toggle = await screen.findByRole('button', { name: /Arquivados/ });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByRole('list', { name: 'Projetos arquivados' })).not.toBeInTheDocument();

    await userEvent.click(toggle);

    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    const list = screen.getByRole('list', { name: 'Projetos arquivados' });
    expect(within(list).getByText('Antigo')).toHaveAttribute('title', 'C:\\Projetos\\Antigo');
    expect(within(list).getByText('Sumiu')).toBeInTheDocument();
    expect(within(list).getAllByText('Pasta indisponível')).toHaveLength(1);

    await userEvent.click(toggle);
    expect(screen.queryByRole('list', { name: 'Projetos arquivados' })).not.toBeInTheDocument();
  });

  it('Restaurar desarquiva o projeto, recarrega as listas e avisa a janela', async () => {
    const { api, state } = installApi({ archived: [archivedProject] });
    api.projects.unarchive.mockImplementation(() => {
      state.archived = [];
      state.projects.push(archivedProject);
      return Promise.resolve({ ok: true, data: undefined });
    });
    const avisos = vi.fn();
    window.addEventListener(PROJECTS_CHANGED_EVENT, avisos);
    try {
      renderSidebar('/');
      await userEvent.click(await screen.findByRole('button', { name: /Arquivados/ }));

      await userEvent.click(screen.getByRole('button', { name: 'Restaurar Antigo' }));

      await waitFor(() => expect(api.projects.unarchive).toHaveBeenCalledWith('p9'));
      const area = await spaces();
      expect(await within(area).findByRole('link', { name: 'Antigo' })).toBeInTheDocument();
      await waitFor(() =>
        expect(screen.queryByRole('button', { name: /Arquivados/ })).not.toBeInTheDocument(),
      );
      expect(avisos).toHaveBeenCalled();
    } finally {
      window.removeEventListener(PROJECTS_CHANGED_EVENT, avisos);
    }
  });

  it('depois de Restaurar, o foco vai para Arquivados se restam outros, e para Adicionar projeto se não', async () => {
    const outroArquivado: ProjectSummary = { ...archivedProject, id: 'p8', name: 'Velho' };
    const { api, state } = installApi({ archived: [archivedProject, outroArquivado] });
    api.projects.unarchive.mockImplementation((id: string) => {
      state.archived = state.archived.filter((project) => project.id !== id);
      return Promise.resolve({ ok: true, data: undefined });
    });
    renderSidebar('/');
    const toggle = await screen.findByRole('button', { name: /Arquivados/ });
    await userEvent.click(toggle);

    await userEvent.click(screen.getByRole('button', { name: 'Restaurar Antigo' }));
    await waitFor(() => expect(toggle).toHaveFocus());

    await userEvent.click(await screen.findByRole('button', { name: 'Restaurar Velho' }));
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Adicionar projeto' })).toHaveFocus(),
    );
    await waitFor(() =>
      expect(screen.queryByRole('button', { name: /Arquivados/ })).not.toBeInTheDocument(),
    );
  });

  it('falha ao restaurar mostra a mensagem da API e o projeto segue arquivado', async () => {
    const { api } = installApi({ archived: [archivedProject] });
    api.projects.unarchive.mockResolvedValue({
      ok: false,
      error: {
        code: 'PROJECT_NOT_FOUND',
        message: 'O projeto não foi encontrado.',
        retryable: false,
      },
    });
    renderSidebar('/');
    await userEvent.click(await screen.findByRole('button', { name: /Arquivados/ }));

    await userEvent.click(screen.getByRole('button', { name: 'Restaurar Antigo' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('O projeto não foi encontrado.');
    expect(screen.getByRole('list', { name: 'Projetos arquivados' })).toBeInTheDocument();
  });

  it('um projeto arquivado em outra tela (evento da janela) aparece na seção', async () => {
    const { state } = installApi();
    renderSidebar('/');
    await spaces();
    expect(screen.queryByRole('button', { name: /Arquivados/ })).not.toBeInTheDocument();

    state.archived = [archivedProject];
    act(() => {
      window.dispatchEvent(new Event(PROJECTS_CHANGED_EVENT));
    });

    expect(await screen.findByRole('button', { name: /Arquivados/ })).toBeInTheDocument();
  });
});

describe('Sidebar: sessões de cada projeto', () => {
  it('começa recolhido, expande os cartões e recolhe de novo', async () => {
    installApi({ terminals: [terminalOf({ id: 't1', title: 'npm test' })] });
    renderSidebar('/');
    await spaces();
    expect(screen.queryByRole('button', { name: /^npm test/ })).not.toBeInTheDocument();

    await userEvent.click(expandOf('Project Hub'));
    expect(expandOf('Project Hub')).toHaveAttribute('aria-expanded', 'true');
    expect(await screen.findByRole('button', { name: /^npm test/ })).toBeInTheDocument();

    await userEvent.click(expandOf('Project Hub'));
    expect(screen.queryByRole('button', { name: /^npm test/ })).not.toBeInTheDocument();
  });

  it('o cartão mostra o título, o projeto com a branch e o estado em texto', async () => {
    installApi({
      terminals: [terminalOf({ id: 't1', title: 'npm test', state: 'running' })],
    });
    renderSidebar('/');
    await spaces();

    await userEvent.click(expandOf('Project Hub'));

    const card = await screen.findByRole('button', { name: /^npm test/ });
    expect(within(card).getByText('Project Hub · main')).toBeInTheDocument();
    expect(within(card).getByText('rodando')).toBeInTheDocument();
    expect(card).toHaveClass('state-rail--running');
  });

  it('sessão de missão mostra "missão" com a pasta do worktree', async () => {
    installApi({
      terminals: [
        terminalOf({
          id: 't9',
          kind: 'agent',
          title: 'Refatorar o login',
          missionId: 'm1',
          provider: 'claude',
          worktreeName: 'feat-login',
        }),
      ],
    });
    renderSidebar('/');
    await spaces();

    await userEvent.click(expandOf('Project Hub'));

    expect(await screen.findByText('missão · feat-login')).toBeInTheDocument();
  });

  it('títulos repetidos ganham a posição no detalhe, para os cartões não serem iguais', async () => {
    installApi({
      terminals: [
        terminalOf({ id: 'a', title: 'Claude Code' }),
        terminalOf({ id: 'b', title: 'Claude Code' }),
      ],
    });
    renderSidebar('/');
    await spaces();

    await userEvent.click(expandOf('Project Hub'));

    expect(await screen.findByText('Project Hub · main · 1')).toBeInTheDocument();
    expect(screen.getByText('Project Hub · main · 2')).toBeInTheDocument();
  });

  it('projeto sem sessões diz que não há nenhuma aberta, e o fechado mostra "vazio"', async () => {
    installApi();
    renderSidebar('/');
    const area = await spaces();
    expect(within(area).getAllByText('vazio')).toHaveLength(2);

    await userEvent.click(expandOf('Notas'));

    expect(await screen.findByText('Nenhuma sessão aberta.')).toBeInTheDocument();
  });

  it('cada projeto mostra um ícone por sessão, com o estado no anel, e "+N" com o resto', async () => {
    installApi({
      terminals: [
        terminalOf({ id: 'a', state: 'running' }),
        terminalOf({ id: 'b', state: 'waiting' }),
        terminalOf({ id: 'c', state: 'exited' }),
        terminalOf({ id: 'd', state: 'running' }),
      ],
    });
    renderSidebar('/');

    const area = await spaces();
    await waitFor(() => expect(area.querySelectorAll('.sidebar__avatar')).toHaveLength(3));
    expect(area.querySelector('.state-ring--waiting')).not.toBeNull();
    expect(area.querySelector('.sidebar__avatar-more')).toHaveTextContent('+1');
  });

  it('clicar no cartão leva ao workspace do projeto, pedindo para mostrar o terminal', async () => {
    installApi({ terminals: [terminalOf({ id: 't7', title: 'npm test' })] });
    renderSidebar('/');
    await spaces();
    await userEvent.click(expandOf('Project Hub'));

    await userEvent.click(await screen.findByRole('button', { name: /^npm test/ }));

    expect(await screen.findByText(/Workspace/)).toHaveTextContent('"showTerminal":"t7"');
  });

  it('o botão Abrir do cartão leva ao mesmo lugar', async () => {
    installApi({ terminals: [terminalOf({ id: 't7', title: 'npm test' })] });
    renderSidebar('/');
    await spaces();
    await userEvent.click(expandOf('Project Hub'));

    await userEvent.click(await screen.findByRole('button', { name: 'Abrir npm test' }));

    expect(await screen.findByText(/Workspace/)).toHaveTextContent('"showTerminal":"t7"');
  });

  it('Fechar acha o painel da sessão e o remove, sem pedir confirmação', async () => {
    const { api } = installApi({ terminals: [terminalOf({ id: 't7', title: 'npm test' })] });
    const removePane = vi.fn(() => Promise.resolve({ ok: true, data: {} }));
    Object.assign(api, {
      workspaces: {
        list: vi.fn(() =>
          Promise.resolve({
            ok: true,
            data: [
              {
                id: 'w1',
                projectId: 'p1',
                position: 0,
                lastActiveAt: '2026-10-25T10:00:00.000Z',
                layout: {
                  type: 'split',
                  id: 's1',
                  direction: 'row',
                  ratio: 0.5,
                  first: { type: 'leaf', id: 'l1', provider: 'shell', terminalId: 'outro' },
                  second: { type: 'leaf', id: 'l2', provider: 'shell', terminalId: 't7' },
                },
              },
            ],
          }),
        ),
        removePane,
      },
    });
    renderSidebar('/');
    await spaces();
    await userEvent.click(expandOf('Project Hub'));

    await userEvent.click(await screen.findByRole('button', { name: 'Fechar npm test' }));

    await waitFor(() => expect(removePane).toHaveBeenCalledWith('w1', 'l2'));
  });

  it('a sessão de missão não tem o botão Fechar', async () => {
    installApi({
      terminals: [terminalOf({ id: 't9', kind: 'agent', title: 'Missão', missionId: 'm1' })],
    });
    renderSidebar('/');
    await spaces();

    await userEvent.click(expandOf('Project Hub'));

    expect(await screen.findByRole('button', { name: 'Abrir Missão' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Fechar Missão' })).not.toBeInTheDocument();
  });

  it('título de sessão com marcação aparece como texto', async () => {
    installApi({ terminals: [terminalOf({ id: 't1', title: '<img src=x>' })] });
    renderSidebar('/');
    const area = await spaces();

    await userEvent.click(expandOf('Project Hub'));

    expect(await within(area).findByText('<img src=x>')).toHaveAttribute('title', '<img src=x>');
    expect(area.querySelector('img')).toBeNull();
  });
});

describe('Sidebar: atividade dos cartões', () => {
  it('sessão com o contador de saída mostra o gráfico, sempre com sete barras', async () => {
    installApi({ terminals: [terminalOf({ id: 't1', title: 'npm test', outputBytes: 120 })] });
    renderSidebar('/');
    await spaces();

    await userEvent.click(expandOf('Project Hub'));

    const card = await screen.findByRole('button', { name: /^npm test/ });
    const graph = card.querySelector('.activity');
    expect(graph).not.toBeNull();
    expect(graph).toHaveAttribute('aria-hidden', 'true');
    expect(graph?.querySelectorAll('.activity__bar')).toHaveLength(7);
  });

  it('sessão sem o contador não mostra o gráfico', async () => {
    installApi({ terminals: [terminalOf({ id: 't1', title: 'npm test' })] });
    renderSidebar('/');
    await spaces();

    await userEvent.click(expandOf('Project Hub'));

    const card = await screen.findByRole('button', { name: /^npm test/ });
    expect(card.querySelector('.activity')).toBeNull();
  });

  it('sessão com arquivos alterados mostra a contagem no detalhe do cartão', async () => {
    installApi({ terminals: [terminalOf({ id: 't1', title: 'npm test', changedFiles: 14 })] });
    renderSidebar('/');
    await spaces();

    await userEvent.click(expandOf('Project Hub'));

    expect(await screen.findByRole('button', { name: /^npm test/ })).toHaveTextContent(
      'Project Hub · main · 14 arquivos alterados',
    );
  });

  it('um arquivo alterado tem o singular, e nenhuma alteração não aparece', async () => {
    installApi({
      terminals: [
        terminalOf({ id: 't1', title: 'um', changedFiles: 1 }),
        terminalOf({ id: 't2', title: 'nenhum', changedFiles: 0 }),
      ],
    });
    renderSidebar('/');
    await spaces();

    await userEvent.click(expandOf('Project Hub'));

    expect(await screen.findByRole('button', { name: /^um/ })).toHaveTextContent(
      '1 arquivo alterado',
    );
    expect(screen.getByRole('button', { name: /^nenhum/ })).not.toHaveTextContent('alterado');
  });
});

describe('Sidebar: aviso para leitor de tela', () => {
  it('a faixa anuncia o que espera a pessoa por uma região que já estava montada', async () => {
    installApi({ terminals: [terminalOf({ id: 't1', title: 'Codex', state: 'waiting' })] });
    renderSidebar('/');

    await screen.findByRole('region', { name: 'Precisa de você' });
    const live = document.querySelector('.sidebar__sr');
    expect(live).toHaveAttribute('aria-live', 'polite');
    expect(live).toHaveTextContent('Precisa de você: 1. Primeiro: Codex.');
  });

  it('sem nada esperando, a região de anúncio continua montada e vazia', async () => {
    installApi({ terminals: [] });
    renderSidebar('/');
    await spaces();

    expect(screen.queryByRole('region', { name: 'Precisa de você' })).not.toBeInTheDocument();
    expect(document.querySelector('.sidebar__sr')).toBeEmptyDOMElement();
  });
});

describe('Sidebar: o que precisa de você', () => {
  it('sem nada esperando, a faixa não existe', async () => {
    installApi({ terminals: [terminalOf({ state: 'running' })] });
    renderSidebar('/');

    await spaces();
    expect(screen.queryByRole('region', { name: 'Precisa de você' })).not.toBeInTheDocument();
  });

  it('sessão em espera aparece com o total, o projeto e o botão Ir', async () => {
    installApi({
      terminals: [terminalOf({ id: 't3', title: 'Claude Code', state: 'waiting' })],
    });
    renderSidebar('/');

    const strip = await screen.findByRole('region', { name: 'Precisa de você' });
    expect(within(strip).getByText('Precisa de você · 1')).toBeInTheDocument();
    expect(within(strip).getByText('Claude Code')).toBeInTheDocument();
    expect(within(strip).getByText('Project Hub')).toBeInTheDocument();

    await userEvent.click(within(strip).getByRole('button', { name: 'Ir para Claude Code' }));
    expect(await screen.findByText(/Workspace/)).toHaveTextContent('"showTerminal":"t3"');
  });

  it('missão que pede decisão, mesmo sem terminal, entra na faixa e leva à página dela', async () => {
    installApi({
      missions: { p1: [missionOf({ id: 'm5', title: 'Revisar combate', status: 'review' })] },
    });
    renderSidebar('/');

    const strip = await screen.findByRole('region', { name: 'Precisa de você' });
    expect(within(strip).getByText('Project Hub · Aguarda sua revisão')).toBeInTheDocument();

    await userEvent.click(within(strip).getByRole('button', { name: 'Ir para Revisar combate' }));
    expect(await screen.findByText('Página da missão')).toBeInTheDocument();
  });

  it('o total soma sessões e missões, sem contar duas vezes a missão que já tem sessão em espera', async () => {
    installApi({
      missions: {
        p1: [
          missionOf({ id: 'm1', title: 'Com sessão', status: 'waiting_input' }),
          missionOf({ id: 'm2', title: 'Sem sessão', status: 'review' }),
        ],
      },
      terminals: [
        terminalOf({
          id: 't1',
          kind: 'agent',
          title: 'Com sessão',
          missionId: 'm1',
          state: 'waiting',
        }),
      ],
    });
    renderSidebar('/');

    const strip = await screen.findByRole('region', { name: 'Precisa de você' });
    expect(within(strip).getByText('Precisa de você · 2')).toBeInTheDocument();
  });
});

describe('Sidebar: leitura dos terminais', () => {
  it('falha ao ler as sessões avisa, e os projetos continuam na lista', async () => {
    const { api } = installApi();
    api.terminals.list.mockResolvedValue({
      ok: false,
      error: { code: 'UNKNOWN', message: 'Falhou.', retryable: false },
    });
    renderSidebar('/');

    const area = await spaces();
    expect(await within(area).findByText('Não foi possível ler as sessões.')).toBeInTheDocument();
    expect(within(area).getByRole('link', { name: 'Project Hub' })).toBeInTheDocument();
  });

  it('recarrega os projetos quando chega um evento de missão ou um projeto é cadastrado', async () => {
    const { api, emit } = installApi();
    renderSidebar('/');
    await spaces();
    const before = api.projects.list.mock.calls.length;

    await act(async () => {
      emit();
      window.dispatchEvent(new Event(PROJECTS_CHANGED_EVENT));
      await new Promise((resolve) => setTimeout(resolve, 400));
    });

    expect(api.projects.list.mock.calls.length).toBeGreaterThan(before);
  });
});
