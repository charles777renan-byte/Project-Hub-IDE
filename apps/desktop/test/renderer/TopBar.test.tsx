import {
  act,
  createEvent,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type {
  AppResult,
  MissionDto,
  ProjectHubApi,
  ProjectSummary,
  TerminalSummary,
  WorkspaceDto,
} from '@project-hub/contracts';
import { Link, MemoryRouter, useLocation } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  RestoreWorkspace,
  resetRestoreForTests,
  TopBar,
} from '../../src/renderer/components/TopBar';
import { ADD_PROJECT_REQUEST_EVENT } from '../../src/renderer/projects-events';
import { workspacePath } from '../../src/renderer/routes';
import { MARKS } from '../../src/renderer/state-mark';
import { show, useFakeIntersectionObserver } from './fake-intersection-observer';
import { WORKSPACES_CHANGED_EVENT } from '../../src/renderer/workspaces-events';

// Barra superior (Tarefa 6 do plano do workspace multiagente): abas dos workspaces abertos, o botão
// "Abrir workspace" com o menu dos projetos sem workspace e a restauração da última aba ao abrir.
// O `window.projectHub` é falso, como o preload entregaria.

function project(id: string, name: string): ProjectSummary {
  return {
    id,
    name,
    path: `C:\\Projetos\\${name}`,
    repositoryKind: 'git',
    available: true,
    defaultBranch: 'main',
  };
}

function workspace(id: string, projectId: string, extra: Partial<WorkspaceDto> = {}): WorkspaceDto {
  return {
    id,
    projectId,
    layout: { type: 'leaf', id: `leaf-${id}`, provider: 'shell', terminalId: null },
    position: 0,
    lastActiveAt: '2026-10-22T10:00:00.000Z',
    ...extra,
  };
}

function mission(id: string, projectId: string, status: MissionDto['status']): MissionDto {
  return {
    id,
    projectId,
    title: `Missão ${id}`,
    objective: 'Objetivo',
    status,
    altersCode: false,
    acceptanceCriteria: [],
    createdAt: '2026-10-22T09:00:00.000Z',
    updatedAt: '2026-10-22T09:00:00.000Z',
  };
}

function terminal(id: string, projectId: string, state: TerminalSummary['state']): TerminalSummary {
  return {
    id,
    kind: 'shell',
    title: `Terminal ${id}`,
    projectId,
    projectName: projectId,
    state,
    provider: 'shell',
    origin: 'new',
  };
}

const ok = <T,>(data: T) => Promise.resolve({ ok: true as const, data });

type Fixture = {
  projects: ProjectSummary[];
  workspaces: WorkspaceDto[];
  /** As missões de cada projeto, pelo id do projeto. */
  missions: Record<string, MissionDto[]>;
  terminals: TerminalSummary[];
};

/** Instala a API falsa. `open` e `close` mexem na lista, como o processo principal faria. */
function installApi(fixture: Partial<Fixture> = {}) {
  const state: Fixture = {
    projects: fixture.projects ?? [],
    workspaces: fixture.workspaces ?? [],
    missions: fixture.missions ?? {},
    terminals: fixture.terminals ?? [],
  };
  const workspaces = {
    list: vi.fn(() => ok([...state.workspaces])),
    open: vi.fn((projectId: string) => {
      const created = workspace(`ws-${projectId}`, projectId, {
        position: state.workspaces.length,
      });
      state.workspaces = [...state.workspaces, created];
      return ok(created);
    }),
    close: vi.fn((workspaceId: string) => {
      state.workspaces = state.workspaces.filter((item) => item.id !== workspaceId);
      return ok(undefined);
    }),
    /** Põe os abertos na ordem dada e troca a posição, como o processo principal gravaria. */
    reorder: vi.fn((order: string[]): Promise<AppResult<void>> => {
      state.workspaces = order.flatMap((id, index) => {
        const found = state.workspaces.find((item) => item.id === id);
        return found === undefined ? [] : [{ ...found, position: index }];
      });
      return Promise.resolve({ ok: true, data: undefined });
    }),
  };
  const missions = {
    list: vi.fn((projectId: string) => ok(state.missions[projectId] ?? [])),
    get: () => Promise.reject(new Error('get não é chamado aqui')),
    subscribe: () => () => undefined,
  };
  const terminals = { list: vi.fn(() => ok(state.terminals)) };
  window.projectHub = {
    projects: {
      list: () => ok(state.projects),
      listArchived: () => ok([]),
    },
    missions,
    terminals,
    workspaces,
  } as unknown as ProjectHubApi;
  return { state, workspaces, missions, terminals };
}

function Where() {
  return <p data-testid="where">{useLocation().pathname}</p>;
}

function renderBar(route = '/') {
  return render(
    <MemoryRouter initialEntries={[route]}>
      <RestoreWorkspace />
      <TopBar />
      <Where />
    </MemoryRouter>,
  );
}

const where = () => screen.getByTestId('where').textContent;

beforeEach(() => {
  resetRestoreForTests();
});

afterEach(() => {
  Reflect.deleteProperty(window, 'projectHub');
});

describe('abas dos workspaces', () => {
  it('mostra uma aba por workspace aberto, com o nome do projeto, e marca a da rota atual', async () => {
    installApi({
      projects: [project('p1', 'Project Hub'), project('p2', 'Notas')],
      workspaces: [workspace('w1', 'p1'), workspace('w2', 'p2', { position: 1 })],
    });
    renderBar(workspacePath('p2'));

    const tabs = await screen.findByRole('navigation', { name: 'Workspaces abertos' });
    const hub = await within(tabs).findByRole('link', { name: 'Project Hub' });
    const notes = within(tabs).getByRole('link', { name: 'Notas' });
    expect(within(tabs).getAllByRole('link')).toHaveLength(2);
    expect(notes).toHaveAttribute('aria-current', 'page');
    expect(hub).not.toHaveAttribute('aria-current');
    expect(hub).toHaveAttribute('href', '/workspaces/p1');
  });

  it('é um cabeçalho (banner) com a marca', async () => {
    installApi();
    renderBar('/projects');
    const header = document.querySelector<HTMLElement>('header.topbar');
    expect(header).not.toBeNull();
    expect(within(header as HTMLElement).getByText('Project Hub')).toBeInTheDocument();
    expect((header as HTMLElement).querySelector('.topbar__mark')).toHaveAttribute(
      'aria-hidden',
      'true',
    );
    await screen.findByRole('button', { name: 'Abrir workspace' });
  });

  it('mostra um rótulo neutro quando o projeto ainda não está na lista', async () => {
    installApi({ projects: [], workspaces: [workspace('w1', 'p9')] });
    renderBar('/projects');
    expect(await screen.findByRole('link', { name: 'Projeto' })).toHaveAttribute(
      'href',
      '/workspaces/p9',
    );
  });

  it('mostra o nome do projeto como texto, nunca como marcação', async () => {
    installApi({
      projects: [project('p1', '<b>x</b>')],
      workspaces: [workspace('w1', 'p1')],
    });
    renderBar('/projects');
    const link = await screen.findByRole('link', { name: '<b>x</b>' });
    expect(link.textContent).toBe('<b>x</b>');
    expect(link.querySelector('b')).toBeNull();
    expect(screen.getByRole('button', { name: 'Fechar workspace <b>x</b>' })).toBeInTheDocument();
  });

  it('fechar e abrir levam um ícone SVG decorativo e o nome acessível continua só o texto', async () => {
    installApi({ projects: [project('p1', 'Alfa')], workspaces: [workspace('w1', 'p1')] });
    renderBar('/projects');
    const close = await screen.findByRole('button', { name: 'Fechar workspace Alfa' });
    const add = screen.getByRole('button', { name: 'Abrir workspace' });
    for (const button of [close, add]) {
      const icon = button.querySelector('svg');
      expect(icon).not.toBeNull();
      expect(icon).toHaveAttribute('aria-hidden', 'true');
      // O símbolo de texto saiu: o botão só tem o SVG.
      expect(button.textContent).toBe('');
    }
  });

  it('sem workspace aberto só aparece o botão de abrir', async () => {
    installApi({ projects: [project('p1', 'Project Hub')] });
    renderBar('/');
    await screen.findByRole('button', { name: 'Abrir workspace' });
    expect(screen.queryByRole('navigation', { name: 'Workspaces abertos' })).toBeNull();
    expect(screen.getAllByRole('link').map((link) => link.textContent)).toEqual(['Início']);
    expect(screen.queryByRole('button', { name: /^Fechar workspace/ })).toBeNull();
  });

  it('tem a aba fixa Início como primeira, com link para a raiz e sem botão de fechar', async () => {
    installApi({
      projects: [project('p1', 'Alfa')],
      workspaces: [workspace('w1', 'p1')],
    });
    renderBar('/workspaces/p1');
    const home = await screen.findByRole('link', { name: 'Início' });
    expect(home).toHaveAttribute('href', '/');
    expect(home).not.toHaveAttribute('aria-current');
    const header = document.querySelector('header.topbar') as HTMLElement;
    expect(within(header).getAllByRole('link')[0]).toBe(home);
    expect(screen.queryByRole('button', { name: /Fechar.*Início/ })).toBeNull();
    expect(home.closest('li')).toBeNull();
    expect(home.hasAttribute('data-workspace-id')).toBe(false);
  });

  it('a aba Início fica presente sem workspace aberto e marca a rota raiz com aria-current', async () => {
    installApi({ projects: [project('p1', 'Project Hub')] });
    renderBar('/');
    const home = await screen.findByRole('link', { name: 'Início' });
    expect(home).toHaveAttribute('aria-current', 'page');
    expect(screen.queryByRole('navigation', { name: 'Workspaces abertos' })).toBeNull();
  });

  it('a aba Início não marca aria-current em outra rota', async () => {
    installApi({ projects: [project('p1', 'Project Hub')] });
    renderBar('/projects');
    expect(await screen.findByRole('link', { name: 'Início' })).not.toHaveAttribute('aria-current');
  });

  it('a aba Início fica fora da reordenação: o teclado não a move nem entra na ordem', async () => {
    const user = userEvent.setup();
    const { workspaces } = installApi({
      projects: [project('p1', 'Alfa'), project('p2', 'Beta')],
      workspaces: [workspace('w1', 'p1'), workspace('w2', 'p2', { position: 1 })],
    });
    renderBar('/projects');
    const home = await screen.findByRole('link', { name: 'Início' });
    home.focus();
    await user.keyboard('{Alt>}{ArrowRight}{/Alt}');
    expect(workspaces.reorder).not.toHaveBeenCalled();

    const alfa = await screen.findByRole('link', { name: 'Alfa' });
    alfa.focus();
    await user.keyboard('{Alt>}{ArrowLeft}{/Alt}');
    // Alfa já é a primeira aba de workspace: o Início não entra na ordem.
    expect(workspaces.reorder).not.toHaveBeenCalled();
  });

  it('não leva mais os contadores da visão geral', async () => {
    installApi();
    renderBar('/');
    await screen.findByRole('button', { name: 'Abrir workspace' });
    expect(document.querySelector('.topbar__status')).toBeNull();
    expect(screen.queryByText(/executando/)).toBeNull();
  });

  it('sem o preload (testes) nada lança e o botão de abrir continua lá', async () => {
    Reflect.deleteProperty(window, 'projectHub');
    renderBar('/');
    expect(await screen.findByRole('button', { name: 'Abrir workspace' })).toBeInTheDocument();
  });
});

describe('marca de atenção nas abas', () => {
  /** Uma leitura falsa (`vi.fn`) e as respostas que ela já devolveu. */
  type Read = { mock: { results: { value: unknown }[] } };

  /**
   * Espera as leituras de terminais e de missões: primeiro a chamada, depois a resposta aplicada pela
   * barra. A barra só mostra o efeito da resposta quando ela chega, então as asserções negativas
   * esperam esse ponto, sem um tempo fixo.
   */
  async function settleReads(...reads: Read[]) {
    await waitFor(() => {
      for (const read of reads) expect(read).toHaveBeenCalled();
    });
    await act(async () => {
      for (const read of reads) await read.mock.results[read.mock.results.length - 1]?.value;
    });
  }

  const attentionMark = (link: HTMLElement) => link.querySelector('.state-mark--waiting');

  it('sem nada que espere, a aba não tem marca nem descrição', async () => {
    const { missions, terminals } = installApi({
      projects: [project('p1', 'Alfa'), project('p2', 'Beta')],
      workspaces: [workspace('w1', 'p1'), workspace('w2', 'p2', { position: 1 })],
      missions: { p1: [mission('m1', 'p1', 'running')] },
      terminals: [terminal('t1', 'p2', 'running')],
    });
    renderBar('/projects');
    const alfa = await screen.findByRole('link', { name: 'Alfa' });
    const beta = screen.getByRole('link', { name: 'Beta' });
    await waitFor(() => expect(missions.list).toHaveBeenCalledWith('p1'));
    await settleReads(terminals.list, missions.list);

    for (const link of [alfa, beta]) {
      expect(attentionMark(link)).toBeNull();
      expect(link).not.toHaveAttribute('aria-describedby');
    }
    expect(screen.queryByText('Precisa de você')).toBeNull();
  });

  it('com uma missão que pede decisão, a marca aparece e a descrição do link é "Precisa de você"', async () => {
    installApi({
      projects: [project('p1', 'Alfa')],
      workspaces: [workspace('w1', 'p1')],
      missions: { p1: [mission('m1', 'p1', 'waiting_input')] },
    });
    renderBar('/projects');
    const alfa = await screen.findByRole('link', { name: 'Alfa' });

    await waitFor(() => expect(attentionMark(alfa)).not.toBeNull());
    const mark = attentionMark(alfa) as HTMLElement;
    expect(mark).toHaveAttribute('aria-hidden', 'true');
    expect(mark).toHaveTextContent(MARKS.waiting.glyph);
    // A marca vem depois do nome, e o nome acessível do link continua só o nome.
    expect(alfa.lastElementChild).toBe(mark);
    expect(alfa).toHaveAccessibleName('Alfa');
    expect(alfa).toHaveAccessibleDescription('Precisa de você');
  });

  it('com um terminal em espera, só a aba do projeto dele ganha a marca', async () => {
    installApi({
      projects: [project('p1', 'Alfa'), project('p2', 'Beta')],
      workspaces: [workspace('w1', 'p1'), workspace('w2', 'p2', { position: 1 })],
      terminals: [terminal('t1', 'p2', 'waiting')],
    });
    renderBar('/projects');
    const alfa = await screen.findByRole('link', { name: 'Alfa' });
    const beta = screen.getByRole('link', { name: 'Beta' });

    await waitFor(() => expect(attentionMark(beta)).not.toBeNull());
    expect(beta).toHaveAccessibleDescription('Precisa de você');
    expect(attentionMark(alfa)).toBeNull();
    expect(alfa).not.toHaveAttribute('aria-describedby');
  });

  it('uma missão em execução não põe marca', async () => {
    const { missions, terminals } = installApi({
      projects: [project('p1', 'Alfa')],
      workspaces: [workspace('w1', 'p1')],
      missions: { p1: [mission('m1', 'p1', 'running')] },
    });
    renderBar('/projects');
    const alfa = await screen.findByRole('link', { name: 'Alfa' });
    await settleReads(terminals.list, missions.list);

    expect(attentionMark(alfa)).toBeNull();
    expect(alfa).not.toHaveAttribute('aria-describedby');
  });
});

describe('fechar uma aba', () => {
  async function setup(route: string) {
    const api = installApi({
      projects: [project('p1', 'Alfa'), project('p2', 'Beta'), project('p3', 'Gama')],
      workspaces: [
        workspace('w1', 'p1'),
        workspace('w2', 'p2', { position: 1 }),
        workspace('w3', 'p3', { position: 2 }),
      ],
    });
    renderBar(route);
    await screen.findByRole('link', { name: 'Gama' });
    return api;
  }

  it('chama workspaces.close, avisa a janela e tira a aba', async () => {
    const heard = vi.fn();
    window.addEventListener(WORKSPACES_CHANGED_EVENT, heard);
    const { workspaces } = await setup('/projects');
    await userEvent.click(screen.getByRole('button', { name: 'Fechar workspace Beta' }));
    expect(workspaces.close).toHaveBeenCalledWith('w2');
    await waitFor(() => expect(screen.queryByRole('link', { name: 'Beta' })).toBeNull());
    expect(heard).toHaveBeenCalled();
    window.removeEventListener(WORKSPACES_CHANGED_EVENT, heard);
    // Não era a aba da rota: a rota fica.
    expect(where()).toBe('/projects');
  });

  it('se era a aba da rota, vai para a aba seguinte', async () => {
    await setup(workspacePath('p2'));
    await userEvent.click(screen.getByRole('button', { name: 'Fechar workspace Beta' }));
    await waitFor(() => expect(where()).toBe(workspacePath('p3')));
  });

  it('se era a última da fila, vai para a anterior', async () => {
    await setup(workspacePath('p3'));
    await userEvent.click(screen.getByRole('button', { name: 'Fechar workspace Gama' }));
    await waitFor(() => expect(where()).toBe(workspacePath('p2')));
  });

  it('se era a única, vai para o Início', async () => {
    installApi({ projects: [project('p1', 'Alfa')], workspaces: [workspace('w1', 'p1')] });
    renderBar(workspacePath('p1'));
    await userEvent.click(await screen.findByRole('button', { name: 'Fechar workspace Alfa' }));
    await waitFor(() => expect(where()).toBe('/'));
  });

  it('avisa quando o fechamento falha e mantém a aba', async () => {
    const { workspaces } = await setup('/projects');
    workspaces.close.mockImplementationOnce(
      () =>
        Promise.resolve({ ok: false as const, error: { code: 'INTERNAL', message: 'x' } }) as never,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Fechar workspace Beta' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Não foi possível fechar');
    expect(screen.getByRole('link', { name: 'Beta' })).toBeInTheDocument();
  });
});

describe('menu Abrir workspace', () => {
  async function openMenu() {
    const button = await screen.findByRole('button', { name: 'Abrir workspace' });
    await userEvent.click(button);
    return button;
  }

  it('lista só os projetos sem workspace aberto, mais Adicionar projeto…', async () => {
    installApi({
      projects: [project('p1', 'Alfa'), project('p2', 'Beta'), project('p3', 'Gama')],
      workspaces: [workspace('w1', 'p1')],
    });
    renderBar('/');
    await screen.findByRole('link', { name: 'Alfa' });
    await screen.findByRole('button', { name: 'Fechar workspace Alfa' });
    await openMenu();
    const menu = screen.getByRole('menu');
    expect(
      within(menu)
        .getAllByRole('menuitem')
        .map((item) => item.textContent),
    ).toEqual(['Beta', 'Gama', 'Adicionar projeto…']);
  });

  it('escolher um projeto abre o workspace, avisa a janela e navega para ele', async () => {
    const heard = vi.fn();
    window.addEventListener(WORKSPACES_CHANGED_EVENT, heard);
    const { workspaces } = installApi({ projects: [project('p1', 'Alfa'), project('p2', 'Beta')] });
    renderBar('/projects');
    await screen.findByRole('button', { name: 'Abrir workspace' });
    await waitFor(() => expect(workspaces.list).toHaveBeenCalled());
    await openMenu();
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Beta' }));

    expect(workspaces.open).toHaveBeenCalledWith('p2');
    await waitFor(() => expect(where()).toBe(workspacePath('p2')));
    expect(heard).toHaveBeenCalled();
    window.removeEventListener(WORKSPACES_CHANGED_EVENT, heard);
    expect(screen.queryByRole('menu')).toBeNull();
    expect(await screen.findByRole('link', { name: 'Beta' })).toHaveAttribute(
      'aria-current',
      'page',
    );
  });

  it('Adicionar projeto… pede à lateral que abra o seletor de pasta, sem trocar de tela', async () => {
    installApi({ projects: [project('p1', 'Alfa')] });
    renderBar('/');
    const pedido = vi.fn();
    window.addEventListener(ADD_PROJECT_REQUEST_EVENT, pedido);
    try {
      await openMenu();
      await userEvent.click(screen.getByRole('menuitem', { name: 'Adicionar projeto…' }));
    } finally {
      window.removeEventListener(ADD_PROJECT_REQUEST_EVENT, pedido);
    }
    expect(pedido).toHaveBeenCalledTimes(1);
    expect(where()).toBe('/');
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('avisa quando o workspace não abre e fica onde estava', async () => {
    const { workspaces } = installApi({ projects: [project('p1', 'Alfa')] });
    workspaces.open.mockImplementationOnce(
      () => Promise.resolve({ ok: false, error: { code: 'INTERNAL', message: 'x' } }) as never,
    );
    renderBar('/projects');
    await openMenu();
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Alfa' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Não foi possível abrir');
    expect(where()).toBe('/projects');
  });

  it('o botão anuncia o menu e Esc fecha devolvendo o foco ao botão', async () => {
    installApi({ projects: [project('p1', 'Alfa')] });
    renderBar('/');
    const button = await openMenu();
    expect(button).toHaveAttribute('aria-haspopup', 'menu');
    expect(button).toHaveAttribute('aria-expanded', 'true');
    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('menu')).toBeNull();
    expect(button).toHaveAttribute('aria-expanded', 'false');
    expect(button).toHaveFocus();
  });

  it('as setas percorrem os itens do menu', async () => {
    installApi({ projects: [project('p1', 'Alfa'), project('p2', 'Beta')] });
    renderBar('/');
    await openMenu();
    await waitFor(() => expect(screen.getByRole('menuitem', { name: 'Alfa' })).toHaveFocus());
    await userEvent.keyboard('{ArrowDown}');
    expect(screen.getByRole('menuitem', { name: 'Beta' })).toHaveFocus();
    await userEvent.keyboard('{ArrowUp}');
    expect(screen.getByRole('menuitem', { name: 'Alfa' })).toHaveFocus();
  });

  it('um clique fora fecha o menu', async () => {
    installApi({ projects: [project('p1', 'Alfa')] });
    renderBar('/');
    await openMenu();
    await userEvent.click(document.body);
    expect(screen.queryByRole('menu')).toBeNull();
  });
});

describe('RestoreWorkspace', () => {
  const twoWorkspaces = () =>
    installApi({
      projects: [project('p1', 'Alfa'), project('p2', 'Beta')],
      workspaces: [
        workspace('w1', 'p1', { lastActiveAt: '2026-10-22T09:00:00.000Z' }),
        workspace('w2', 'p2', { position: 1, lastActiveAt: '2026-10-22T11:30:00.000Z' }),
      ],
    });

  it('na rota / vai para o workspace de atividade mais recente', async () => {
    twoWorkspaces();
    renderBar('/');
    await waitFor(() => expect(where()).toBe(workspacePath('p2')));
  });

  it('na rota /projects não navega', async () => {
    const { workspaces } = twoWorkspaces();
    renderBar('/projects');
    await waitFor(() => expect(workspaces.list).toHaveBeenCalled());
    await screen.findByRole('link', { name: 'Beta' });
    expect(where()).toBe('/projects');
  });

  it('sem workspace aberto fica no Início', async () => {
    installApi({ projects: [project('p1', 'Alfa')] });
    renderBar('/');
    await screen.findByRole('button', { name: 'Abrir workspace' });
    expect(where()).toBe('/');
  });

  it('restaura uma vez só: voltar ao Início depois não leva de novo', async () => {
    twoWorkspaces();
    render(
      <MemoryRouter initialEntries={['/']}>
        <RestoreWorkspace />
        <TopBar />
        <Link to="/">Ir ao Início</Link>
        <Where />
      </MemoryRouter>,
    );
    await waitFor(() => expect(where()).toBe(workspacePath('p2')));
    await userEvent.click(screen.getByRole('link', { name: 'Ir ao Início' }));
    expect(where()).toBe('/');
    // Dá tempo de um efeito (errado) navegar de novo.
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(where()).toBe('/');
  });
});

describe('falha ao carregar os workspaces', () => {
  const failure = () =>
    Promise.resolve({ ok: false, error: { code: 'INTERNAL', message: 'x' } }) as never;

  function installFailingFirstLoad() {
    const api = installApi({
      projects: [project('p1', 'Alfa'), project('p2', 'Beta')],
      workspaces: [
        workspace('w1', 'p1', { lastActiveAt: '2026-10-22T09:00:00.000Z' }),
        workspace('w2', 'p2', { position: 1, lastActiveAt: '2026-10-22T11:30:00.000Z' }),
      ],
    });
    api.workspaces.list.mockImplementationOnce(failure);
    return api;
  }

  const reload = () => act(() => void window.dispatchEvent(new Event(WORKSPACES_CHANGED_EVENT)));

  it('mostra a mensagem num alerta e nenhuma aba', async () => {
    installFailingFirstLoad();
    renderBar('/projects');
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Não foi possível carregar os workspaces',
    );
    expect(screen.queryByRole('navigation', { name: 'Workspaces abertos' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Abrir workspace' })).toBeInTheDocument();
  });

  it('o alerta some e as abas aparecem na próxima carga que dá certo', async () => {
    installFailingFirstLoad();
    renderBar('/projects');
    await screen.findByRole('alert');
    reload();
    expect(await screen.findByRole('link', { name: 'Beta' })).toBeInTheDocument();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('mantém as abas já carregadas quando uma recarga falha', async () => {
    const { workspaces } = installApi({
      projects: [project('p1', 'Alfa')],
      workspaces: [workspace('w1', 'p1')],
    });
    renderBar('/projects');
    await screen.findByRole('link', { name: 'Alfa' });
    workspaces.list.mockImplementationOnce(failure);
    reload();
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Não foi possível carregar os workspaces',
    );
    expect(screen.getByRole('link', { name: 'Alfa' })).toBeInTheDocument();
  });

  it('a restauração continua pendente: a próxima carga boa, com a rota ainda em /, restaura uma vez só', async () => {
    installFailingFirstLoad();
    render(
      <MemoryRouter initialEntries={['/']}>
        <RestoreWorkspace />
        <TopBar />
        <Link to="/">Ir ao Início</Link>
        <Where />
      </MemoryRouter>,
    );
    await screen.findByRole('alert');
    expect(where()).toBe('/');
    reload();
    await waitFor(() => expect(where()).toBe(workspacePath('p2')));

    // Uma terceira carga, de volta ao Início, não leva de novo.
    await userEvent.click(screen.getByRole('link', { name: 'Ir ao Início' }));
    reload();
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(where()).toBe('/');
  });

  it('a carga boa depois da falha não navega se a pessoa já estava em outra página', async () => {
    const { workspaces } = installFailingFirstLoad();
    renderBar('/projects');
    await screen.findByRole('alert');
    reload();
    await screen.findByRole('link', { name: 'Beta' });
    expect(workspaces.list).toHaveBeenCalledTimes(2);
    expect(where()).toBe('/projects');
  });
});

describe('ordenar as abas', () => {
  const animate = vi.fn();

  beforeEach(() => {
    // O jsdom devolve caixas zeradas: cada aba tem 100px e fica depois da anterior, pela posição do `li`.
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (
      this: HTMLElement,
    ) {
      const li = this.closest('li');
      const left = li === null ? 0 : Array.from(li.parentElement?.children ?? []).indexOf(li) * 100;
      return {
        left,
        right: left + 100,
        width: 100,
        top: 0,
        bottom: 20,
        x: left,
        y: 0,
        height: 20,
        toJSON: () => ({}),
      } as DOMRect;
    });
    // O jsdom não tem animações, captura de ponteiro nem `matchMedia`.
    animate.mockClear();
    Object.defineProperty(HTMLElement.prototype, 'animate', { value: animate, configurable: true });
    Object.defineProperty(HTMLElement.prototype, 'setPointerCapture', {
      value: vi.fn(),
      configurable: true,
    });
    Object.defineProperty(window, 'matchMedia', {
      value: () => ({ matches: false }),
      configurable: true,
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    Reflect.deleteProperty(HTMLElement.prototype, 'animate');
    Reflect.deleteProperty(HTMLElement.prototype, 'setPointerCapture');
    Reflect.deleteProperty(window, 'matchMedia');
  });

  /** Três abas, Alfa, Beta e Gama, com os workspaces w1, w2 e w3 nessa ordem. */
  async function threeTabs() {
    const api = installApi({
      projects: [project('p1', 'Alfa'), project('p2', 'Beta'), project('p3', 'Gama')],
      workspaces: [
        workspace('w1', 'p1'),
        workspace('w2', 'p2', { position: 1 }),
        workspace('w3', 'p3', { position: 2 }),
      ],
    });
    renderBar('/projects');
    await screen.findByRole('link', { name: 'Gama' });
    return api;
  }

  const tab = (name: string) => screen.getByRole('link', { name });
  const item = (name: string) => tab(name).closest<HTMLElement>('li') as HTMLElement;
  const tabNames = () =>
    within(screen.getByRole('navigation', { name: 'Workspaces abertos' }))
      .getAllByRole('link')
      .map((link) => link.textContent);

  type PointerType = 'pointerDown' | 'pointerMove' | 'pointerUp' | 'pointerCancel';

  /** Um evento de ponteiro do mouse na coordenada `x`. O jsdom nem sempre copia esses campos, então vão à mão. */
  function pointer(type: PointerType, name: string, x: number) {
    const event = createEvent[type](tab(name));
    Object.defineProperty(event, 'clientX', { value: x });
    Object.defineProperty(event, 'button', { value: 0 });
    Object.defineProperty(event, 'pointerId', { value: 1 });
    fireEvent(tab(name), event);
  }

  /** Pega a aba em `from`, anda até `to` e solta. */
  function dragTab(name: string, from: number, to: number) {
    pointer('pointerDown', name, from);
    pointer('pointerMove', name, to);
    pointer('pointerUp', name, to);
  }

  it('arrastar uma aba para o início grava a ordem nova e mostra na tela', async () => {
    const api = await threeTabs();

    dragTab('Gama', 250, 0);

    await waitFor(() => expect(api.workspaces.reorder).toHaveBeenCalledWith(['w3', 'w1', 'w2']));
    await waitFor(() => expect(tabNames()).toEqual(['Gama', 'Alfa', 'Beta']));
  });

  it('passar do meio de uma aba põe a arrastada depois dela', async () => {
    const api = await threeTabs();

    dragTab('Alfa', 50, 160);

    await waitFor(() => expect(api.workspaces.reorder).toHaveBeenCalledWith(['w2', 'w1', 'w3']));
    await waitFor(() => expect(tabNames()).toEqual(['Beta', 'Alfa', 'Gama']));
  });

  it('um gesto curto é um clique: não arrasta nem grava, e a aba navega', async () => {
    const api = await threeTabs();

    dragTab('Gama', 250, 252);
    expect(item('Gama')).not.toHaveClass('topbar__tab--dragging');
    await userEvent.click(tab('Gama'));

    expect(api.workspaces.reorder).not.toHaveBeenCalled();
    expect(tab('Gama')).toHaveAttribute('aria-current', 'page');
  });

  it('enquanto arrasta, a aba segue o ponteiro, as vizinhas abrem o espaço e tudo volta ao fim', async () => {
    const api = await threeTabs();
    pointer('pointerDown', 'Gama', 250);
    pointer('pointerMove', 'Gama', 0);

    expect(item('Gama')).toHaveClass('topbar__tab--dragging');
    expect(item('Gama').style.transform).toBe('translateX(-200px)');
    expect(item('Alfa').style.transform).toBe('translateX(100px)');
    expect(item('Beta').style.transform).toBe('translateX(100px)');

    // Com a aba de volta ao lugar dela, ninguém anda.
    pointer('pointerMove', 'Gama', 250);
    expect(item('Alfa').style.transform).toBe('');
    expect(item('Gama').style.transform).toBe('');

    pointer('pointerUp', 'Gama', 250);
    await waitFor(() => expect(item('Gama')).not.toHaveClass('topbar__tab--dragging'));
    expect(api.workspaces.reorder).not.toHaveBeenCalled();
    expect(tabNames()).toEqual(['Alfa', 'Beta', 'Gama']);
  });

  it('ao soltar, a aba desliza até o espaço aberto e só então grava', async () => {
    const api = await threeTabs();
    pointer('pointerDown', 'Gama', 250);
    pointer('pointerMove', 'Gama', 0);
    pointer('pointerUp', 'Gama', 0);

    expect(item('Gama')).toHaveClass('topbar__tab--dragging', 'topbar__tab--dropping');
    expect(item('Gama').style.transform).toBe('translateX(-200px)');
    expect(api.workspaces.reorder).not.toHaveBeenCalled();

    await waitFor(() => expect(api.workspaces.reorder).toHaveBeenCalledWith(['w3', 'w1', 'w2']));
  });

  it('Esc durante o arrasto devolve a aba ao lugar e não grava', async () => {
    const api = await threeTabs();
    pointer('pointerDown', 'Gama', 250);
    pointer('pointerMove', 'Gama', 0);
    // Apertar o mouse numa aba já a foca; o `fireEvent` não faz isso.
    tab('Gama').focus();

    await userEvent.keyboard('{Escape}');
    // O gesto ainda não acabou, mas já não mexe nas abas.
    pointer('pointerMove', 'Gama', 120);
    pointer('pointerUp', 'Gama', 120);

    await waitFor(() => expect(item('Gama')).not.toHaveClass('topbar__tab--dragging'));
    expect(api.workspaces.reorder).not.toHaveBeenCalled();
    expect(tabNames()).toEqual(['Alfa', 'Beta', 'Gama']);
  });

  it('um gesto cancelado pelo sistema não grava', async () => {
    const api = await threeTabs();
    pointer('pointerDown', 'Gama', 250);
    pointer('pointerMove', 'Gama', 0);
    pointer('pointerCancel', 'Gama', 0);

    await waitFor(() => expect(item('Gama')).not.toHaveClass('topbar__tab--dragging'));
    expect(api.workspaces.reorder).not.toHaveBeenCalled();
  });

  it('o clique que vem de soltar um arrasto não navega', async () => {
    await threeTabs();

    dragTab('Gama', 250, 0);
    fireEvent.click(tab('Gama'));

    expect(tab('Gama')).not.toHaveAttribute('aria-current', 'page');
  });

  it('o link da aba não usa o arrasto nativo do navegador', async () => {
    await threeTabs();

    expect(tab('Gama')).toHaveAttribute('draggable', 'false');
  });

  it('com o sistema pedindo menos movimento, solta e grava na hora, sem deslizar', async () => {
    Object.defineProperty(window, 'matchMedia', {
      value: () => ({ matches: true }),
      configurable: true,
    });
    const api = await threeTabs();

    dragTab('Gama', 250, 0);

    expect(api.workspaces.reorder).toHaveBeenCalledWith(['w3', 'w1', 'w2']);
    await waitFor(() => expect(tabNames()).toEqual(['Gama', 'Alfa', 'Beta']));
    expect(animate).not.toHaveBeenCalled();
  });

  it('soltar com o mouse não desliza de novo: as abas já estão nos lugares novos', async () => {
    await threeTabs();

    dragTab('Gama', 250, 0);

    await waitFor(() => expect(tabNames()).toEqual(['Gama', 'Alfa', 'Beta']));
    expect(animate).not.toHaveBeenCalled();
  });

  it('pelo teclado, cada aba desliza do lugar antigo até o novo', async () => {
    await threeTabs();
    tab('Gama').focus();

    await userEvent.keyboard('{Alt>}{ArrowLeft}{/Alt}');

    await waitFor(() => expect(tabNames()).toEqual(['Alfa', 'Gama', 'Beta']));
    // Gama anda uma posição para a esquerda, e Beta uma para a direita.
    const shifts = animate.mock.calls.map(
      ([frames]) => (frames as { transform: string }[])[0]?.transform,
    );
    expect(shifts.sort()).toEqual(['translateX(-100px)', 'translateX(100px)']);
  });

  it('pelo teclado, sem movimento pedido pelo sistema, nada desliza', async () => {
    Object.defineProperty(window, 'matchMedia', {
      value: () => ({ matches: true }),
      configurable: true,
    });
    await threeTabs();
    tab('Gama').focus();

    await userEvent.keyboard('{Alt>}{ArrowLeft}{/Alt}');

    await waitFor(() => expect(tabNames()).toEqual(['Alfa', 'Gama', 'Beta']));
    expect(animate).not.toHaveBeenCalled();
  });

  it('Alt com a seta move a aba um lugar, devolve o foco para ela e avisa a posição', async () => {
    const api = await threeTabs();
    tab('Beta').focus();

    await userEvent.keyboard('{Alt>}{ArrowLeft}{/Alt}');

    await waitFor(() => expect(api.workspaces.reorder).toHaveBeenCalledWith(['w2', 'w1', 'w3']));
    await waitFor(() => expect(tabNames()).toEqual(['Beta', 'Alfa', 'Gama']));
    expect(document.activeElement).toBe(tab('Beta'));
    expect(screen.getByRole('status')).toHaveTextContent('Beta: posição 1 de 3.');
  });

  it('Alt com a seta na ponta não grava nada', async () => {
    const api = await threeTabs();
    tab('Alfa').focus();

    await userEvent.keyboard('{Alt>}{ArrowLeft}{/Alt}');

    expect(api.workspaces.reorder).not.toHaveBeenCalled();
    expect(tabNames()).toEqual(['Alfa', 'Beta', 'Gama']);
  });

  it('se o processo principal recusa a ordem, a lista volta e a barra avisa', async () => {
    const api = await threeTabs();
    api.workspaces.reorder.mockResolvedValueOnce({
      ok: false,
      error: { code: 'UNKNOWN', message: 'falha', retryable: true },
    });
    tab('Beta').focus();

    await userEvent.keyboard('{Alt>}{ArrowLeft}{/Alt}');

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Não foi possível mudar a ordem das abas.',
    );
    await waitFor(() => expect(tabNames()).toEqual(['Alfa', 'Beta', 'Gama']));
  });
});

describe('botão do painel direito', () => {
  it('sem o gancho de alternar, a barra não tem o botão', async () => {
    installApi();
    renderBar();

    await screen.findByRole('button', { name: 'Abrir workspace' });
    expect(screen.queryByRole('button', { name: /painel direito/ })).toBeNull();
  });

  it.each([
    [false, 'Ocultar painel direito', 'true'],
    [true, 'Mostrar painel direito', 'false'],
  ])(
    'com rightCollapsed=%s o botão se chama "%s" e aria-expanded=%s',
    async (collapsed, name, expanded) => {
      installApi();
      render(
        <MemoryRouter>
          <TopBar rightCollapsed={collapsed} onToggleRight={() => undefined} />
        </MemoryRouter>,
      );

      const button = await screen.findByRole('button', { name });
      expect(button).toHaveAttribute('aria-expanded', expanded);
      expect(button).toHaveClass('topbar__right-toggle');
    },
  );

  it('o botão fica no fim da barra: depois das abas e do botão de abrir workspace; o da lateral segue antes da marca', async () => {
    installApi();
    render(
      <MemoryRouter>
        <TopBar onToggleSidebar={() => undefined} onToggleRight={() => undefined} />
      </MemoryRouter>,
    );

    const right = await screen.findByRole('button', { name: 'Ocultar painel direito' });
    const add = screen.getByRole('button', { name: 'Abrir workspace' });
    const home = screen.getByRole('link', { name: 'Início' });
    const side = screen.getByRole('button', { name: 'Ocultar barra lateral' });
    const brand = screen.getByText('Project Hub');
    const follows = (a: Element, b: Element) =>
      Boolean(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);

    expect(follows(side, brand)).toBe(true);
    expect(follows(home, right)).toBe(true);
    expect(follows(add, right)).toBe(true);
    expect(right.closest('header')?.lastElementChild?.contains(right)).toBe(true);
  });

  it('clicar chama onToggleRight', async () => {
    installApi();
    const onToggleRight = vi.fn();
    const user = userEvent.setup();
    render(
      <MemoryRouter>
        <TopBar onToggleRight={onToggleRight} />
      </MemoryRouter>,
    );

    await user.click(await screen.findByRole('button', { name: 'Ocultar painel direito' }));

    expect(onToggleRight).toHaveBeenCalledTimes(1);
  });

  it('a dica do botão mostra o atalho', async () => {
    installApi();
    const user = userEvent.setup();
    render(
      <MemoryRouter>
        <TopBar onToggleRight={() => undefined} />
      </MemoryRouter>,
    );
    const button = await screen.findByRole('button', { name: 'Ocultar painel direito' });

    await user.hover(button);

    expect(await screen.findByRole('tooltip', {}, { timeout: 2000 })).toHaveTextContent(
      'Ocultar painel direito (Ctrl+Alt+B)',
    );
  });
});

describe('abas fora de vista (botão ⌄)', () => {
  useFakeIntersectionObserver();

  it('escolher uma aba escondida abre o workspace e leva o foco para o link dela', async () => {
    const user = userEvent.setup();
    installApi({
      projects: [project('p1', 'Alfa'), project('p2', 'Beta'), project('p3', 'Gama')],
      workspaces: [
        workspace('w1', 'p1'),
        workspace('w2', 'p2', { position: 1 }),
        workspace('w3', 'p3', { position: 2 }),
      ],
    });
    renderBar('/');
    await screen.findByRole('link', { name: 'Gama' });
    show('w1');

    await user.click(screen.getByRole('button', { name: 'Abas fora de vista' }));
    expect(screen.getAllByRole('menuitem').map((item) => item.textContent)).toEqual([
      'Beta',
      'Gama',
    ]);
    await user.click(screen.getByRole('menuitem', { name: 'Gama' }));

    expect(where()).toBe(workspacePath('p3'));
    await waitFor(() =>
      expect(document.activeElement).toBe(screen.getByRole('link', { name: 'Gama' })),
    );
  });
});
