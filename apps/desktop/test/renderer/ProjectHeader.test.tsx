import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, useLocation, useNavigationType } from 'react-router';
import type {
  AppResult,
  ProjectHubApi,
  ProjectSummary,
  WorkspaceDto,
} from '@project-hub/contracts';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  ProjectHeader,
  PROJECT_NO_GIT_NOTICE_ID,
  PROJECT_UNAVAILABLE_NOTICE_ID,
} from '../../src/renderer/components/project/ProjectHeader';
import { PROJECTS_CHANGED_EVENT } from '../../src/renderer/projects-events';
import { ROUTE_PATHS } from '../../src/renderer/routes';
import { WORKSPACES_CHANGED_EVENT } from '../../src/renderer/workspaces-events';
import {
  resetCloseAllForTests,
  setPaneCount,
  useCloseAllRequest,
} from '../../src/renderer/workspace/close-all';

const project: ProjectSummary = {
  id: 'p1',
  name: 'Project Hub',
  path: 'C:\\Projetos\\Project Hub',
  repositoryKind: 'git',
  available: true,
  defaultBranch: 'main',
};

function workspaceOf(id: string, projectId: string): WorkspaceDto {
  return {
    id,
    projectId,
    layout: { type: 'leaf', id: 'a', provider: 'shell', terminalId: null },
    position: 0,
    lastActiveAt: '2026-10-22T10:00:00.000Z',
  };
}

function installApi() {
  const api = {
    projects: {
      archive: vi.fn(() => Promise.resolve<AppResult<void>>({ ok: true, data: undefined })),
      remove: vi.fn(() => Promise.resolve<AppResult<void>>({ ok: true, data: undefined })),
    },
    workspaces: {
      list: vi.fn(() =>
        Promise.resolve<AppResult<WorkspaceDto[]>>({
          ok: true,
          data: [workspaceOf('w1', 'p1'), workspaceOf('w2', 'p2')],
        }),
      ),
      close: vi.fn(() => Promise.resolve<AppResult<void>>({ ok: true, data: undefined })),
    },
  };
  window.projectHub = api as unknown as ProjectHubApi;
  return api;
}

let current = { pathname: '', search: '', key: '', type: '' };
function Probe() {
  const location = useLocation();
  const type = useNavigationType();
  current = { pathname: location.pathname, search: location.search, key: location.key, type };
  return null;
}

function renderAt(
  path: string,
  overrides: { project?: ProjectSummary; onNewMission?: () => void; missionOpen?: boolean } = {},
) {
  const onNewMission = overrides.onNewMission ?? vi.fn();
  render(
    <MemoryRouter initialEntries={[path]}>
      <Probe />
      <Routes>
        <Route path={ROUTE_PATHS.home} element={<p>Página inicial</p>} />
        <Route
          path={ROUTE_PATHS.workspace}
          element={
            <ProjectHeader
              project={overrides.project ?? project}
              onNewMission={onNewMission}
              missionOpen={overrides.missionOpen ?? false}
            />
          }
        />
      </Routes>
    </MemoryRouter>,
  );
  return { onNewMission };
}

afterEach(() => {
  Reflect.deleteProperty(window, 'projectHub');
  resetCloseAllForTests();
});

/** Mostra se o pedido de fechar todos está de pé para o projeto, como o workspace o veria. */
function RequestProbe({ projectId }: { projectId: string }) {
  return <output data-testid="pedido">{String(useCloseAllRequest(projectId))}</output>;
}

describe('ProjectHeader: uma linha', () => {
  it('mostra só o nome do projeto, sem o tipo do repositório nem etiquetas de branch e grupo', () => {
    installApi();
    renderAt('/workspaces/p1', { project: { ...project, group: 'Trabalho' } });

    expect(screen.getByRole('heading', { level: 1, name: 'Project Hub' })).toHaveAttribute(
      'title',
      'Project Hub',
    );
    expect(screen.queryByText(/Repositório Git/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/Branch:/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Grupo:/)).not.toBeInTheDocument();
  });

  it('com apelido, o título é o apelido e o nome da pasta fica ao lado', () => {
    installApi();
    renderAt('/workspaces/p1', { project: { ...project, nickname: 'Re_Zero' } });

    const title = screen.getByRole('heading', { level: 1, name: 'Re_Zero' });
    expect(title).toHaveAttribute('title', 'Project Hub');
    expect(screen.getByText('Project Hub')).toBeInTheDocument();
  });

  it('as visões são abas com nome, e Terminais é a padrão', () => {
    installApi();
    renderAt('/workspaces/p1');

    const tabs = screen.getByRole('tablist', { name: 'Visões do projeto' });
    expect(
      within(tabs)
        .getAllByRole('tab')
        .map((tab) => tab.textContent),
    ).toEqual(['Terminais', 'Missões', 'Progresso', 'Worktrees', 'Configurações']);
    expect(within(tabs).getByRole('tab', { name: 'Terminais' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
  });

  it('a aba ativa vem de ?visao=, e visão desconhecida vale como Terminais', () => {
    installApi();
    const { unmount } = render(
      <MemoryRouter initialEntries={['/workspaces/p1?visao=worktrees']}>
        <ProjectHeader project={project} onNewMission={() => undefined} />
      </MemoryRouter>,
    );
    expect(screen.getByRole('tab', { name: 'Worktrees' })).toHaveAttribute('aria-selected', 'true');
    unmount();

    render(
      <MemoryRouter initialEntries={['/workspaces/p1?visao=nada']}>
        <ProjectHeader project={project} onNewMission={() => undefined} />
      </MemoryRouter>,
    );
    expect(screen.getByRole('tab', { name: 'Terminais' })).toHaveAttribute('aria-selected', 'true');
  });

  it('escolher uma aba troca ?visao= na rota do projeto', async () => {
    installApi();
    renderAt('/workspaces/p1');

    await userEvent.click(screen.getByRole('tab', { name: 'Configurações' }));

    expect(current).toMatchObject({ pathname: '/workspaces/p1', search: '?visao=configuracoes' });
    expect(screen.getByRole('tab', { name: 'Configurações' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
  });

  it('trocar de visão substitui a entrada do histórico, em vez de empilhar uma por aba', async () => {
    installApi();
    renderAt('/workspaces/p1');

    await userEvent.click(screen.getByRole('tab', { name: 'Worktrees' }));

    expect(current).toMatchObject({ search: '?visao=worktrees', type: 'REPLACE' });
  });

  it('escolher Progresso troca ?visao= por progresso, substituindo a entrada do histórico', async () => {
    installApi();
    renderAt('/workspaces/p1');

    await userEvent.click(screen.getByRole('tab', { name: 'Progresso' }));

    expect(current).toMatchObject({ search: '?visao=progresso', type: 'REPLACE' });
    expect(screen.getByRole('tab', { name: 'Progresso' })).toHaveAttribute('aria-selected', 'true');
  });

  it('?nova-missao=1 sem ?visao= deixa Missões como a visão ativa', () => {
    installApi();
    renderAt('/workspaces/p1?nova-missao=1');

    expect(screen.getByRole('tab', { name: 'Missões' })).toHaveAttribute('aria-selected', 'true');
  });

  it('Nova missão chama onNewMission', async () => {
    installApi();
    const { onNewMission } = renderAt('/workspaces/p1');

    await userEvent.click(screen.getByRole('button', { name: 'Nova missão' }));

    expect(onNewMission).toHaveBeenCalledTimes(1);
  });
});

describe('ProjectHeader: Mais ações', () => {
  it('Arquivar projeto pede confirmação, e só então arquiva, avisa a lateral e volta ao Início', async () => {
    const api = installApi();
    const avisos = vi.fn();
    window.addEventListener(PROJECTS_CHANGED_EVENT, avisos);
    const user = userEvent.setup();
    renderAt('/workspaces/p1');

    await user.click(screen.getByRole('button', { name: 'Mais ações' }));
    await user.click(await screen.findByRole('menuitem', { name: 'Arquivar projeto' }));
    expect(api.projects.archive).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: 'Arquivar' }));

    expect(api.projects.archive).toHaveBeenCalledWith('p1');
    expect(await screen.findByText('Página inicial')).toBeInTheDocument();
    expect(avisos).toHaveBeenCalled();
    window.removeEventListener(PROJECTS_CHANGED_EVENT, avisos);
  });

  it('arquivar fecha também a aba do workspace desse projeto e avisa a barra superior', async () => {
    const api = installApi();
    const avisos = vi.fn();
    window.addEventListener(WORKSPACES_CHANGED_EVENT, avisos);
    const user = userEvent.setup();
    renderAt('/workspaces/p1');

    await user.click(screen.getByRole('button', { name: 'Mais ações' }));
    await user.click(await screen.findByRole('menuitem', { name: 'Arquivar projeto' }));
    await user.click(screen.getByRole('button', { name: 'Arquivar' }));

    expect(await screen.findByText('Página inicial')).toBeInTheDocument();
    expect(api.workspaces.close).toHaveBeenCalledTimes(1);
    expect(api.workspaces.close).toHaveBeenCalledWith('w1');
    expect(avisos).toHaveBeenCalled();
    window.removeEventListener(WORKSPACES_CHANGED_EVENT, avisos);
  });

  it('remover da lista fecha a aba do workspace desse projeto', async () => {
    const api = installApi();
    const user = userEvent.setup();
    renderAt('/workspaces/p1');

    await user.click(screen.getByRole('button', { name: 'Mais ações' }));
    await user.click(await screen.findByRole('menuitem', { name: 'Remover da lista' }));
    await user.click(screen.getByRole('button', { name: 'Remover' }));

    expect(await screen.findByText('Página inicial')).toBeInTheDocument();
    expect(api.workspaces.close).toHaveBeenCalledWith('w1');
  });

  it('se o arquivamento falhar, a aba do workspace continua aberta', async () => {
    const api = installApi();
    api.projects.archive.mockResolvedValueOnce({
      ok: false,
      error: { code: 'MISSION_INVALID_STATE', message: 'Há missões ativas.', retryable: false },
    });
    const user = userEvent.setup();
    renderAt('/workspaces/p1');

    await user.click(screen.getByRole('button', { name: 'Mais ações' }));
    await user.click(await screen.findByRole('menuitem', { name: 'Arquivar projeto' }));
    await user.click(screen.getByRole('button', { name: 'Arquivar' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Há missões ativas.');
    expect(api.workspaces.list).not.toHaveBeenCalled();
    expect(api.workspaces.close).not.toHaveBeenCalled();
  });

  it('sem workspace aberto para o projeto, arquiva e volta ao Início sem fechar nada', async () => {
    const api = installApi();
    api.workspaces.list.mockResolvedValueOnce({ ok: true, data: [workspaceOf('w2', 'p2')] });
    const user = userEvent.setup();
    renderAt('/workspaces/p1');

    await user.click(screen.getByRole('button', { name: 'Mais ações' }));
    await user.click(await screen.findByRole('menuitem', { name: 'Arquivar projeto' }));
    await user.click(screen.getByRole('button', { name: 'Arquivar' }));

    expect(await screen.findByText('Página inicial')).toBeInTheDocument();
    expect(api.workspaces.close).not.toHaveBeenCalled();
  });

  it('se não der para fechar a aba, o projeto ainda sai e o Início abre', async () => {
    const api = installApi();
    api.workspaces.close.mockRejectedValueOnce(new Error('x'));
    const user = userEvent.setup();
    renderAt('/workspaces/p1');

    await user.click(screen.getByRole('button', { name: 'Mais ações' }));
    await user.click(await screen.findByRole('menuitem', { name: 'Arquivar projeto' }));
    await user.click(screen.getByRole('button', { name: 'Arquivar' }));

    expect(await screen.findByText('Página inicial')).toBeInTheDocument();
  });

  it('Voltar desfaz o pedido de arquivar sem chamar a API', async () => {
    const api = installApi();
    const user = userEvent.setup();
    renderAt('/workspaces/p1');

    await user.click(screen.getByRole('button', { name: 'Mais ações' }));
    await user.click(await screen.findByRole('menuitem', { name: 'Arquivar projeto' }));
    await user.click(screen.getByRole('button', { name: 'Voltar' }));

    expect(api.projects.archive).not.toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: 'Arquivar' })).not.toBeInTheDocument();
  });

  it('Remover da lista pede confirmação antes de tirar o projeto', async () => {
    const api = installApi();
    const user = userEvent.setup();
    renderAt('/workspaces/p1');

    await user.click(screen.getByRole('button', { name: 'Mais ações' }));
    await user.click(await screen.findByRole('menuitem', { name: 'Remover da lista' }));
    expect(api.projects.remove).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: 'Remover' }));

    expect(api.projects.remove).toHaveBeenCalledWith('p1');
    expect(await screen.findByText('Página inicial')).toBeInTheDocument();
  });

  it('falha ao arquivar mostra a mensagem da API e o projeto segue na tela', async () => {
    const api = installApi();
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
    renderAt('/workspaces/p1');

    await user.click(screen.getByRole('button', { name: 'Mais ações' }));
    await user.click(await screen.findByRole('menuitem', { name: 'Arquivar projeto' }));
    await user.click(screen.getByRole('button', { name: 'Arquivar' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Há missões ativas ou aguardando início',
    );
    expect(screen.getByRole('heading', { level: 1, name: 'Project Hub' })).toBeInTheDocument();
    expect(screen.queryByText('Página inicial')).not.toBeInTheDocument();
  });
});

describe('ProjectHeader: pasta indisponível', () => {
  it('Nova missão fica desabilitado e aponta para o aviso da página', () => {
    installApi();
    renderAt('/workspaces/p1', { project: { ...project, available: false } });

    const button = screen.getByRole('button', { name: 'Nova missão' });
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute('aria-describedby', PROJECT_UNAVAILABLE_NOTICE_ID);
  });

  it('com a pasta disponível, Nova missão segue habilitado e sem aria-describedby', () => {
    installApi();
    renderAt('/workspaces/p1', { project: { ...project, available: true } });

    const button = screen.getByRole('button', { name: 'Nova missão' });
    expect(button).toBeEnabled();
    expect(button).not.toHaveAttribute('aria-describedby');
  });

  it('sem o campo available, vale disponível: Nova missão segue habilitado', () => {
    installApi();
    const { available: _available, ...semCampo } = project;
    renderAt('/workspaces/p1', { project: semCampo as ProjectSummary });

    const button = screen.getByRole('button', { name: 'Nova missão' });
    expect(button).toBeEnabled();
    expect(button).not.toHaveAttribute('aria-describedby');
  });
});

describe('ProjectHeader: projeto sem Git', () => {
  it('fora da visão Missões, Nova missão fica desabilitado e explica pelo título', () => {
    installApi();
    renderAt('/workspaces/p1?visao=terminais', {
      project: { ...project, repositoryKind: 'none' },
    });

    const button = screen.getByRole('button', { name: 'Nova missão' });
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute('title', expect.stringContaining('git init'));
    expect(button).not.toHaveAttribute('aria-describedby');
  });

  it('na visão Missões, Nova missão aponta para o aviso da própria visão', () => {
    installApi();
    renderAt('/workspaces/p1?visao=missoes', {
      project: { ...project, repositoryKind: 'none' },
    });

    const button = screen.getByRole('button', { name: 'Nova missão' });
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute('aria-describedby', PROJECT_NO_GIT_NOTICE_ID);
  });
});

describe('ProjectHeader: com uma missão aberta', () => {
  it('a visão ativa é Missões, mesmo sem ?visao= na rota', () => {
    installApi();
    renderAt('/workspaces/p1', { missionOpen: true });

    expect(screen.getByRole('tab', { name: 'Missões' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tab', { name: 'Terminais' })).toHaveAttribute(
      'aria-selected',
      'false',
    );
  });

  it('não mostra Nova missão nem Mais ações (a missão tem os próprios controles); sem missão aberta, eles voltam', () => {
    installApi();
    const open = render(
      <MemoryRouter initialEntries={['/workspaces/p1']}>
        <ProjectHeader project={project} onNewMission={vi.fn()} missionOpen />
      </MemoryRouter>,
    );

    expect(screen.queryByRole('button', { name: 'Nova missão' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Mais ações' })).toBeNull();
    expect(screen.getByRole('tab', { name: 'Missões' })).toBeInTheDocument();

    open.rerender(
      <MemoryRouter initialEntries={['/workspaces/p1']}>
        <ProjectHeader project={project} onNewMission={vi.fn()} missionOpen={false} />
      </MemoryRouter>,
    );

    expect(screen.getByRole('button', { name: 'Nova missão' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Mais ações' })).toBeInTheDocument();
  });

  it('escolher Missões de novo leva à lista de missões', async () => {
    installApi();
    renderAt('/workspaces/p1', { missionOpen: true });

    await userEvent.click(screen.getByRole('tab', { name: 'Missões' }));

    expect(current.search).toBe('?visao=missoes');
  });

  it('sem missão aberta, escolher a visão que já está ativa não navega', async () => {
    installApi();
    renderAt('/workspaces/p1?visao=missoes');
    const before = current.key;

    await userEvent.click(screen.getByRole('tab', { name: 'Missões' }));

    expect(current.key).toBe(before);
    expect(current.search).toBe('?visao=missoes');
  });
});

describe('ProjectHeader: Fechar todos os terminais', () => {
  async function openMenu(user: ReturnType<typeof userEvent.setup>) {
    await user.click(screen.getByRole('button', { name: 'Mais ações' }));
  }

  it('o item vem depois de Arquivar e Remover, em vermelho', async () => {
    installApi();
    setPaneCount('p1', 2);
    const user = userEvent.setup();
    renderAt('/workspaces/p1');

    await openMenu(user);
    const items = await screen.findAllByRole('menuitem');

    expect(items.map((item) => item.textContent)).toEqual([
      'Arquivar projeto',
      'Remover da lista',
      'Fechar todos os terminais…',
    ]);
    expect(items[2]).toHaveClass('menu-acoes__item--perigo');
  });

  it('sem painéis no workspace, o item fica desabilitado com a dica "Nenhum terminal aberto"', async () => {
    installApi();
    const user = userEvent.setup();
    renderAt('/workspaces/p1');

    await openMenu(user);
    const item = await screen.findByRole('menuitem', { name: 'Fechar todos os terminais…' });

    expect(item).toHaveAttribute('aria-disabled', 'true');
    expect(item).toHaveAttribute('title', 'Nenhum terminal aberto');
  });

  it('com painéis, o item fica habilitado e sem dica', async () => {
    installApi();
    setPaneCount('p1', 1);
    const user = userEvent.setup();
    renderAt('/workspaces/p1');

    await openMenu(user);
    const item = await screen.findByRole('menuitem', { name: 'Fechar todos os terminais…' });

    expect(item).not.toHaveAttribute('aria-disabled', 'true');
    expect(item).not.toHaveAttribute('title');
  });

  it('a contagem é do projeto: painéis de outro projeto não habilitam o item', async () => {
    installApi();
    setPaneCount('p2', 4);
    const user = userEvent.setup();
    renderAt('/workspaces/p1');

    await openMenu(user);

    expect(
      await screen.findByRole('menuitem', { name: 'Fechar todos os terminais…' }),
    ).toHaveAttribute('aria-disabled', 'true');
  });

  it('escolher leva à visão Terminais e faz o pedido do projeto', async () => {
    installApi();
    setPaneCount('p1', 2);
    const user = userEvent.setup();
    render(
      <MemoryRouter initialEntries={['/workspaces/p1?visao=progresso']}>
        <Probe />
        <RequestProbe projectId="p1" />
        <Routes>
          <Route
            path={ROUTE_PATHS.workspace}
            element={<ProjectHeader project={project} onNewMission={() => undefined} />}
          />
        </Routes>
      </MemoryRouter>,
    );
    expect(screen.getByTestId('pedido')).toHaveTextContent('false');

    await openMenu(user);
    await user.click(await screen.findByRole('menuitem', { name: 'Fechar todos os terminais…' }));

    expect(current).toMatchObject({ pathname: '/workspaces/p1', search: '?visao=terminais' });
    expect(screen.getByTestId('pedido')).toHaveTextContent('true');
  });

  it('já na visão Terminais, só faz o pedido, sem navegar', async () => {
    installApi();
    setPaneCount('p1', 2);
    const user = userEvent.setup();
    render(
      <MemoryRouter initialEntries={['/workspaces/p1']}>
        <Probe />
        <RequestProbe projectId="p1" />
        <Routes>
          <Route
            path={ROUTE_PATHS.workspace}
            element={<ProjectHeader project={project} onNewMission={() => undefined} />}
          />
        </Routes>
      </MemoryRouter>,
    );
    const key = current.key;

    await openMenu(user);
    await user.click(await screen.findByRole('menuitem', { name: 'Fechar todos os terminais…' }));

    expect(current.key).toBe(key);
    expect(screen.getByTestId('pedido')).toHaveTextContent('true');
  });
});
