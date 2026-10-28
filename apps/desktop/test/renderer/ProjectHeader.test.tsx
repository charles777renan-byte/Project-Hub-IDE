import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router';
import type { AppResult, ProjectHubApi, ProjectSummary } from '@project-hub/contracts';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ProjectHeader } from '../../src/renderer/components/project/ProjectHeader';
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

function installApi() {
  const api = {
    projects: {
      archive: vi.fn(() => Promise.resolve<AppResult<void>>({ ok: true, data: undefined })),
      remove: vi.fn(() => Promise.resolve<AppResult<void>>({ ok: true, data: undefined })),
    },
  };
  window.projectHub = api as unknown as ProjectHubApi;
  return api;
}

let current = { pathname: '', search: '', key: '' };
function Probe() {
  const location = useLocation();
  current = { pathname: location.pathname, search: location.search, key: location.key };
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
});

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
    ).toEqual(['Terminais', 'Missões', 'Worktrees', 'Configurações']);
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
