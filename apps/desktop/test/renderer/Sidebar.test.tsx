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
import { PROJECTS_CHANGED_EVENT } from '../../src/renderer/projects-events';
import { ROUTE_PATHS } from '../../src/renderer/routes';

// Barra lateral (Tarefa 7 do plano do workspace multiagente): a navegação principal no topo, a seção
// Workspaces (cada projeto com as sessões abertas dele) e a seção Em andamento (missões que rodam ou
// esperam, de todos os projetos). O `window.projectHub` é falso, como o preload entregaria.

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

type Fixture = {
  projects: ProjectSummary[];
  missions: Record<string, MissionDto[]>;
  terminals: TerminalSummary[];
};

/** Instala a API falsa. `emit` dispara os ouvintes de eventos de missão, como o processo principal faria. */
function installApi(fixture: Partial<Fixture> = {}) {
  const state: Fixture = {
    projects: fixture.projects ?? [gitProject, plainProject],
    missions: fixture.missions ?? {},
    terminals: fixture.terminals ?? [],
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
function renderSidebar(path: string, props: { currentProjectId?: string } = {}) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Sidebar {...props} />
      <Routes>
        <Route path={ROUTE_PATHS.home} element={<p>Página inicial</p>} />
        <Route path={ROUTE_PATHS.projects} element={<p>Página de projetos</p>} />
        <Route path={ROUTE_PATHS.projectDetail} element={<p>Página do projeto</p>} />
        <Route path={ROUTE_PATHS.missionDetail} element={<p>Página da missão</p>} />
        <Route path={ROUTE_PATHS.workspace} element={<Destination label="Workspace" />} />
      </Routes>
    </MemoryRouter>,
  );
}

afterEach(() => {
  Reflect.deleteProperty(window, 'projectHub');
});

describe('Sidebar: estrutura', () => {
  it('é uma barra com nome acessível, com a navegação principal no topo', async () => {
    installApi();
    renderSidebar('/');

    const bar = screen.getByRole('complementary', { name: 'Projetos e missões' });
    const navigation = within(bar).getByRole('navigation', { name: 'Principal' });
    expect(
      within(navigation)
        .getAllByRole('link')
        .map((link) => link.textContent),
    ).toEqual(['Início', 'Projetos', 'Terminais']);

    // A navegação vem antes das seções de dados.
    const workspaces = await within(bar).findByRole('region', { name: 'Workspaces' });
    expect(
      navigation.compareDocumentPosition(workspaces) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it('tem as seções Workspaces e Em andamento, nessa ordem', async () => {
    installApi();
    renderSidebar('/');

    const workspaces = await screen.findByRole('region', { name: 'Workspaces' });
    const running = await screen.findByRole('region', { name: 'Em andamento' });
    expect(
      workspaces.compareDocumentPosition(running) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });
});

describe('Sidebar: seção Workspaces', () => {
  it('lista os projetos como links para o workspace de cada um', async () => {
    installApi();
    renderSidebar('/');

    const workspaces = await screen.findByRole('region', { name: 'Workspaces' });
    expect(within(workspaces).getByRole('link', { name: 'Project Hub' })).toHaveAttribute(
      'href',
      '/workspaces/p1',
    );
    expect(within(workspaces).getByRole('link', { name: 'Notas' })).toHaveAttribute(
      'href',
      '/workspaces/p2',
    );
    // O nome completo fica num `title`, para quem não vê o texto cortado com reticências.
    expect(within(workspaces).getByText('Notas')).toHaveAttribute('title', 'Notas');
  });

  it('nome longo de projeto leva o nome inteiro no title', async () => {
    const name =
      'Um projeto com um nome muito comprido que não cabe na barra lateral de jeito nenhum';
    installApi({ projects: [{ ...gitProject, name }] });
    renderSidebar('/');

    const workspaces = await screen.findByRole('region', { name: 'Workspaces' });
    expect(within(workspaces).getByText(name)).toHaveAttribute('title', name);
  });

  it('marca o projeto da rota do workspace com aria-current, e só ele', async () => {
    installApi();
    renderSidebar('/workspaces/p1');

    const workspaces = await screen.findByRole('region', { name: 'Workspaces' });
    expect(within(workspaces).getByRole('link', { name: 'Project Hub' })).toHaveAttribute(
      'aria-current',
      'page',
    );
    expect(within(workspaces).getByRole('link', { name: 'Notas' })).not.toHaveAttribute(
      'aria-current',
    );
  });

  it('fora da rota do workspace, nenhum projeto leva aria-current', async () => {
    installApi();
    renderSidebar('/projects/p1');

    const workspaces = await screen.findByRole('region', { name: 'Workspaces' });
    for (const link of within(workspaces).getAllByRole('link')) {
      expect(link).not.toHaveAttribute('aria-current');
    }
  });

  it('projeto sem Git leva o chip "sem Git" e o projeto com Git não leva', async () => {
    installApi();
    renderSidebar('/');

    const workspaces = await screen.findByRole('region', { name: 'Workspaces' });
    const notas = within(workspaces).getByRole('link', { name: 'Notas' }).closest('li');
    const hub = within(workspaces).getByRole('link', { name: 'Project Hub' }).closest('li');
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

    const workspaces = await screen.findByRole('region', { name: 'Workspaces' });
    expect(within(workspaces).getByText('<b>x</b>')).toBeInTheDocument();
    expect(document.querySelector('b')).toBeNull();
  });

  it('sem projetos, diz que não há nenhum', async () => {
    installApi({ projects: [] });
    renderSidebar('/');

    expect(await screen.findByText('Nenhum projeto ainda.')).toBeInTheDocument();
  });
});

describe('Sidebar: marca de cada projeto', () => {
  /** O texto da marca na linha do projeto: o rótulo que o leitor de tela anuncia. */
  async function markOf(name: string): Promise<string> {
    const workspaces = await screen.findByRole('region', { name: 'Workspaces' });
    const row = within(workspaces).getByRole('link', { name }).closest('li');
    return row?.querySelector('.state-mark')?.textContent ?? '';
  }

  it('sem sessão nem missão que mexa, o projeto está desconectado', async () => {
    installApi({ missions: { p1: [missionOf({ status: 'draft' })] } });
    renderSidebar('/');

    expect(await markOf('Project Hub')).toContain('Desconectado');
    expect(await markOf('Notas')).toContain('Desconectado');
  });

  it('sessão rodando deixa o projeto ativo', async () => {
    installApi({ terminals: [terminalOf({ state: 'running' })] });
    renderSidebar('/');

    await waitFor(async () => expect(await markOf('Project Hub')).toContain('Ativo'));
    expect(await markOf('Notas')).toContain('Desconectado');
  });

  it('missão rodando deixa o projeto ativo', async () => {
    installApi({ missions: { p2: [missionOf({ id: 'm5', projectId: 'p2', status: 'running' })] } });
    renderSidebar('/');

    expect(await markOf('Notas')).toContain('Ativo');
  });

  it('sessão aguardando deixa o projeto aguardando, mesmo com outra rodando', async () => {
    installApi({
      terminals: [
        terminalOf({ id: 't1', state: 'running' }),
        terminalOf({ id: 't2', state: 'waiting' }),
      ],
    });
    renderSidebar('/');

    await waitFor(async () => expect(await markOf('Project Hub')).toContain('Aguardando'));
  });

  it('missão que espera a pessoa deixa o projeto aguardando', async () => {
    installApi({
      missions: { p1: [missionOf({ status: 'waiting_approval' })] },
      terminals: [terminalOf({ state: 'running' })],
    });
    renderSidebar('/');

    await waitFor(async () => expect(await markOf('Project Hub')).toContain('Aguardando'));
  });

  it('sessão encerrada não deixa o projeto ativo', async () => {
    installApi({ terminals: [terminalOf({ state: 'exited' })] });
    renderSidebar('/');

    await screen.findByRole('region', { name: 'Workspaces' });
    expect(await markOf('Project Hub')).toContain('Desconectado');
  });
});

describe('Sidebar: sessões de cada projeto', () => {
  const terminals = [
    terminalOf({ id: 't1', title: 'PowerShell · Project Hub', state: 'running' }),
    terminalOf({
      id: 't2',
      title: 'Claude Code · Project Hub',
      state: 'waiting',
      provider: 'claude',
    }),
    terminalOf({
      id: 't3',
      title: 'PowerShell · Notas',
      projectId: 'p2',
      projectName: 'Notas',
      state: 'exited',
    }),
  ];

  async function expandButton(name: string) {
    const workspaces = await screen.findByRole('region', { name: 'Workspaces' });
    return within(workspaces).getByRole('button', { name: `Sessões de ${name}` });
  }

  it('começa recolhido e expande as sessões abertas do projeto, com o estado em texto', async () => {
    installApi({ terminals });
    renderSidebar('/');

    const toggle = await expandButton('Project Hub');
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByRole('button', { name: 'PowerShell · Project Hub' })).toBeNull();

    await userEvent.click(toggle);

    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    const powershell = screen.getByRole('button', { name: 'PowerShell · Project Hub' });
    const claude = screen.getByRole('button', { name: 'Claude Code · Project Hub' });
    expect(powershell.closest('li')).toHaveTextContent('Ativo');
    expect(claude.closest('li')).toHaveTextContent('Aguardando');
    // As sessões de outro projeto ficam no projeto delas.
    expect(screen.queryByRole('button', { name: 'PowerShell · Notas' })).toBeNull();
  });

  it('recolhe de novo ao clicar outra vez', async () => {
    installApi({ terminals });
    renderSidebar('/');

    const toggle = await expandButton('Project Hub');
    await userEvent.click(toggle);
    await userEvent.click(toggle);

    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByRole('button', { name: 'PowerShell · Project Hub' })).toBeNull();
  });

  it('a sessão encerrada aparece como desconectada', async () => {
    installApi({ terminals });
    renderSidebar('/');

    await userEvent.click(await expandButton('Notas'));
    const session = screen.getByRole('button', { name: 'PowerShell · Notas' });
    expect(session.closest('li')).toHaveTextContent('Desconectado');
  });

  it('projeto sem sessões diz que não há nenhuma aberta', async () => {
    installApi({ terminals: [] });
    renderSidebar('/');

    await userEvent.click(await expandButton('Project Hub'));
    expect(screen.getByText('Nenhuma sessão aberta.')).toBeInTheDocument();
  });

  it('o botão de expandir mostra quantas sessões o projeto tem', async () => {
    installApi({ terminals });
    renderSidebar('/');

    await waitFor(async () => expect(await expandButton('Project Hub')).toHaveTextContent('2'));
    expect(await expandButton('Notas')).toHaveTextContent('1');
  });

  it('clicar numa sessão leva ao workspace do projeto, pedindo para mostrar o terminal', async () => {
    installApi({ terminals });
    renderSidebar('/');

    await userEvent.click(await expandButton('Project Hub'));
    await userEvent.click(screen.getByRole('button', { name: 'Claude Code · Project Hub' }));

    expect(screen.getByText('Workspace {"showTerminal":"t2"}')).toBeInTheDocument();
  });

  it('título de sessão com marcação aparece como texto, e o nome longo leva title', async () => {
    const title = '<i>shell</i> · um nome de sessão bem comprido para a barra lateral estreita';
    installApi({ terminals: [terminalOf({ title })] });
    renderSidebar('/');

    await userEvent.click(await expandButton('Project Hub'));
    const session = screen.getByRole('button', { name: title });
    expect(within(session).getByText(title)).toHaveAttribute('title', title);
    expect(document.querySelector('i')).toBeNull();
  });

  it('se a leitura das sessões falha, avisa e a barra segue com os projetos', async () => {
    const { api } = installApi();
    api.terminals.list.mockImplementation(() =>
      Promise.resolve({
        ok: false,
        error: { code: 'TERMINAL_HOST_UNAVAILABLE', message: 'x', retryable: false },
      }),
    );
    renderSidebar('/');

    expect(await screen.findByText('Não foi possível ler as sessões.')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Project Hub' })).toBeInTheDocument();
  });
});

describe('Sidebar: seção Em andamento', () => {
  const missions = {
    p1: [
      missionOf({ id: 'm1', title: 'Ajustar login', status: 'planned' }),
      missionOf({ id: 'm2', title: 'Documentar API', status: 'running' }),
      missionOf({ id: 'm3', title: 'Rascunho antigo', status: 'draft' }),
      missionOf({ id: 'm4', title: 'Já concluída', status: 'succeeded' }),
    ],
    p2: [
      missionOf({ id: 'm5', projectId: 'p2', title: 'Anotar ideias', status: 'waiting_input' }),
      missionOf({ id: 'm6', projectId: 'p2', title: 'Aguarda início', status: 'queued' }),
      missionOf({
        id: 'm7',
        projectId: 'p2',
        title: 'Aguarda decisão',
        status: 'waiting_approval',
      }),
      missionOf({ id: 'm8', projectId: 'p2', title: 'Falhou ontem', status: 'failed' }),
      missionOf({ id: 'm9', projectId: 'p2', title: 'Em pausa', status: 'paused' }),
    ],
  };

  it('lista as missões de todos os projetos que rodam ou esperam, e só elas', async () => {
    installApi({ missions });
    renderSidebar('/');

    const running = await screen.findByRole('region', { name: 'Em andamento' });
    await within(running).findByRole('link', { name: 'Ajustar login' });
    const titles = within(running)
      .getAllByRole('link')
      .map((link) => link.textContent);
    expect(titles).toEqual([
      'Ajustar login',
      'Documentar API',
      'Anotar ideias',
      'Aguarda início',
      'Aguarda decisão',
    ]);
  });

  it('cada missão leva a marca do estado em texto e o nome do projeto', async () => {
    installApi({ missions });
    renderSidebar('/');

    const running = await screen.findByRole('region', { name: 'Em andamento' });
    const login = (await within(running).findByRole('link', { name: 'Ajustar login' })).closest(
      'li',
    );
    expect(login).toHaveTextContent('Aguardando');
    expect(login).toHaveTextContent('Project Hub');
    const api = within(running).getByRole('link', { name: 'Documentar API' }).closest('li');
    expect(api).toHaveTextContent('Ativo');
    const notes = within(running).getByRole('link', { name: 'Anotar ideias' }).closest('li');
    expect(notes).toHaveTextContent('Notas');
  });

  it('a situação por extenso fica no title da linha de estado', async () => {
    installApi({ missions });
    renderSidebar('/');

    const running = await screen.findByRole('region', { name: 'Em andamento' });
    const login = (await within(running).findByRole('link', { name: 'Ajustar login' })).closest(
      'li',
    );
    expect(login?.querySelector('[title="Aguarda aprovação do plano"]')).not.toBeNull();
    const api = within(running).getByRole('link', { name: 'Documentar API' }).closest('li');
    expect(api?.querySelector('[title="Em execução"]')).not.toBeNull();
  });

  it('missão sem terminal leva à página da missão', async () => {
    installApi({ missions });
    renderSidebar('/');

    const running = await screen.findByRole('region', { name: 'Em andamento' });
    const link = await within(running).findByRole('link', { name: 'Ajustar login' });
    expect(link).toHaveAttribute('href', '/projects/p1/missions/m1');

    await userEvent.click(link);
    expect(screen.getByText('Página da missão')).toBeInTheDocument();
  });

  it('missão com terminal de agente abre o terminal no workspace do projeto dela', async () => {
    installApi({
      missions,
      terminals: [
        terminalOf({
          id: 'tm5',
          kind: 'agent',
          title: 'Claude Code · Notas',
          projectId: 'p2',
          projectName: 'Notas',
          missionId: 'm5',
          provider: 'claude',
        }),
      ],
    });
    renderSidebar('/');

    const running = await screen.findByRole('region', { name: 'Em andamento' });
    const button = await within(running).findByRole('button', { name: 'Anotar ideias' });
    expect(within(running).queryByRole('link', { name: 'Anotar ideias' })).toBeNull();

    await userEvent.click(button);
    expect(screen.getByText('Workspace {"showTerminal":"tm5"}')).toBeInTheDocument();
  });

  it('um terminal de outra missão não muda o destino desta', async () => {
    installApi({
      missions,
      terminals: [terminalOf({ id: 'tx', kind: 'agent', missionId: 'm-outra' })],
    });
    renderSidebar('/');

    const running = await screen.findByRole('region', { name: 'Em andamento' });
    expect(await within(running).findByRole('link', { name: 'Ajustar login' })).toBeInTheDocument();
  });

  it('o título da missão leva o texto inteiro no title, e marcação vira texto', async () => {
    const title = '<b>Muito</b> comprido: ajustar o fluxo de entrada para todos os perfis do app';
    installApi({ missions: { p1: [missionOf({ title, status: 'running' })] } });
    renderSidebar('/');

    const running = await screen.findByRole('region', { name: 'Em andamento' });
    const link = await within(running).findByRole('link', { name: title });
    expect(within(link).getByText(title)).toHaveAttribute('title', title);
    expect(document.querySelector('b')).toBeNull();
  });

  it('na rota de uma missão, a missão atual leva aria-current', async () => {
    installApi({ missions });
    renderSidebar('/projects/p1/missions/m2');

    const running = await screen.findByRole('region', { name: 'Em andamento' });
    expect(await within(running).findByRole('link', { name: 'Documentar API' })).toHaveAttribute(
      'aria-current',
      'page',
    );
    expect(within(running).getByRole('link', { name: 'Ajustar login' })).not.toHaveAttribute(
      'aria-current',
    );
  });

  it('sem missões em andamento, diz que não há nenhuma', async () => {
    installApi({ missions: { p1: [missionOf({ status: 'succeeded' })] } });
    renderSidebar('/');

    expect(await screen.findByText('Nada em andamento.')).toBeInTheDocument();
  });

  it('+ Nova missão aparece na rota de um projeto e leva à página dele', async () => {
    installApi({ missions });
    renderSidebar('/projects/p1/missions/m1');

    const running = await screen.findByRole('region', { name: 'Em andamento' });
    await userEvent.click(within(running).getByRole('button', { name: '+ Nova missão' }));
    expect(screen.getByText('Página do projeto')).toBeInTheDocument();
  });

  it('+ Nova missão também aparece na rota do workspace', async () => {
    installApi({ missions });
    renderSidebar('/workspaces/p1');

    expect(await screen.findByRole('button', { name: '+ Nova missão' })).toBeInTheDocument();
  });

  it('fora de rota de projeto, + Nova missão não aparece', async () => {
    installApi({ missions });
    renderSidebar('/projects');

    await screen.findByRole('region', { name: 'Em andamento' });
    expect(screen.queryByRole('button', { name: '+ Nova missão' })).toBeNull();
  });

  it('currentProjectId diz qual projeto usar quando a rota não diz', async () => {
    installApi({ missions });
    renderSidebar('/', { currentProjectId: 'p2' });

    await userEvent.click(await screen.findByRole('button', { name: '+ Nova missão' }));
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

  it('enquanto carrega, mostra Carregando…', async () => {
    window.projectHub = {
      projects: { list: vi.fn(() => new Promise(() => undefined)) },
      missions: { list: vi.fn(), subscribe: vi.fn(() => () => undefined) },
    } as unknown as ProjectHubApi;
    renderSidebar('/');

    expect(await screen.findByText('Carregando…')).toBeInTheDocument();
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

    await screen.findByRole('region', { name: 'Workspaces' });
    expect(unsubscribe).not.toHaveBeenCalled();
    unmount();
    expect(unsubscribe).toHaveBeenCalledTimes(1);
  });

  it('recarrega as missões quando chega um evento de missão', async () => {
    const { state, emit } = installApi({
      missions: { p1: [missionOf({ id: 'm1', title: 'Ajustar login', status: 'running' })] },
    });
    renderSidebar('/projects/p1');

    const running = await screen.findByRole('region', { name: 'Em andamento' });
    await within(running).findByRole('link', { name: 'Ajustar login' });
    expect(within(running).queryByRole('link', { name: 'Documentar API' })).toBeNull();

    state.missions['p1'] = [
      missionOf({ id: 'm2', title: 'Documentar API', status: 'running' }),
      missionOf({ id: 'm1', title: 'Ajustar login', status: 'running' }),
    ];
    emit();

    expect(
      await within(running).findByRole('link', { name: 'Documentar API' }),
    ).toBeInTheDocument();
  });

  it('recarrega os projetos ao trocar de página, para um projeto novo aparecer', async () => {
    const { state } = installApi({ projects: [gitProject] });
    renderSidebar('/');

    const workspaces = await screen.findByRole('region', { name: 'Workspaces' });
    expect(within(workspaces).queryByRole('link', { name: 'Notas' })).toBeNull();

    state.projects = [gitProject, plainProject];
    await userEvent.click(screen.getByRole('button', { name: '+ Novo projeto' }));

    expect(await within(workspaces).findByRole('link', { name: 'Notas' })).toBeInTheDocument();
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

  it('recarrega quando um projeto é cadastrado, sem trocar de rota', async () => {
    let calls = 0;
    window.projectHub = {
      projects: {
        list: () => {
          calls += 1;
          return Promise.resolve({ ok: true, data: calls === 1 ? [] : [gitProject] });
        },
      },
      missions: {
        list: () => Promise.resolve({ ok: true, data: [] }),
        subscribe: () => () => undefined,
      },
    } as unknown as ProjectHubApi;
    render(
      <MemoryRouter initialEntries={['/projects']}>
        <Sidebar />
      </MemoryRouter>,
    );
    expect(await screen.findByText('Nenhum projeto ainda.')).toBeInTheDocument();
    act(() => {
      window.dispatchEvent(new Event(PROJECTS_CHANGED_EVENT));
    });
    expect(await screen.findByRole('link', { name: 'Project Hub' })).toBeInTheDocument();
  });
});
