import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ProjectHubApi, ProjectSummary, WorkspaceDto } from '@project-hub/contracts';
import { Link, MemoryRouter, useLocation } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  RestoreWorkspace,
  resetRestoreForTests,
  TopBar,
} from '../../src/renderer/components/TopBar';
import { workspacePath } from '../../src/renderer/routes';
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

const ok = <T,>(data: T) => Promise.resolve({ ok: true as const, data });

type Fixture = { projects: ProjectSummary[]; workspaces: WorkspaceDto[] };

/** Instala a API falsa. `open` e `close` mexem na lista, como o processo principal faria. */
function installApi(fixture: Partial<Fixture> = {}) {
  const state: Fixture = {
    projects: fixture.projects ?? [],
    workspaces: fixture.workspaces ?? [],
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
  };
  window.projectHub = {
    projects: {
      list: () => ok(state.projects),
      listArchived: () => ok([]),
    },
    missions: {
      list: () => ok([]),
      get: () => Promise.reject(new Error('get não é chamado aqui')),
      subscribe: () => () => undefined,
    },
    workspaces,
  } as unknown as ProjectHubApi;
  return { state, workspaces };
}

function Where() {
  return <p data-testid="where">{useLocation().pathname}</p>;
}

function renderBar(route = '/', extra?: { status?: string }) {
  return render(
    <MemoryRouter initialEntries={[route]}>
      <RestoreWorkspace />
      <TopBar {...(extra?.status === undefined ? {} : { status: <span>{extra.status}</span> })} />
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
    expect(screen.queryByRole('link')).toBeNull();
    expect(screen.queryByRole('button', { name: /^Fechar workspace/ })).toBeNull();
  });

  it('mostra no canto direito o que vier em status', async () => {
    installApi();
    renderBar('/', { status: '2 executando' });
    await screen.findByRole('button', { name: 'Abrir workspace' });
    expect(document.querySelector('.topbar__status')).toHaveTextContent('2 executando');
  });

  it('não deixa uma área vazia quando não vem status', async () => {
    installApi();
    renderBar('/');
    await screen.findByRole('button', { name: 'Abrir workspace' });
    expect(document.querySelector('.topbar__status')).toBeNull();
  });

  it('sem o preload (testes) nada lança e o botão de abrir continua lá', async () => {
    Reflect.deleteProperty(window, 'projectHub');
    renderBar('/');
    expect(await screen.findByRole('button', { name: 'Abrir workspace' })).toBeInTheDocument();
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

  it('Adicionar projeto… leva para a página de Projetos', async () => {
    installApi({ projects: [project('p1', 'Alfa')] });
    renderBar('/');
    await openMenu();
    await userEvent.click(screen.getByRole('menuitem', { name: 'Adicionar projeto…' }));
    expect(where()).toBe('/projects');
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
