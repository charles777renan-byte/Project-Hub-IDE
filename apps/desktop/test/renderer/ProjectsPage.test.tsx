import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import type { AppResult, ProjectHubApi, ProjectSummary } from '@project-hub/contracts';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ProjectsPage } from '../../src/renderer/pages/ProjectsPage';
import { PROJECTS_CHANGED_EVENT } from '../../src/renderer/projects-events';

const hub: ProjectSummary = {
  id: 'p1',
  name: 'Project Hub',
  path: 'C:\\Projetos\\Project Hub',
  repositoryKind: 'git',
  available: true,
};

const outro: ProjectSummary = {
  id: 'p2',
  name: 'Outro',
  path: 'C:\\Projetos\\Outro',
  repositoryKind: 'none',
  available: true,
};

/** Instala a API do preload com as respostas dadas. O que não for dado responde com sucesso vazio. */
function installApi(overrides: Partial<ProjectHubApi['projects']> = {}) {
  const projects = {
    list: vi.fn(
      overrides.list ??
        (() => Promise.resolve<AppResult<ProjectSummary[]>>({ ok: true, data: [] })),
    ),
    chooseDirectory: vi.fn(
      overrides.chooseDirectory ??
        (() => Promise.resolve<AppResult<{ path: string } | null>>({ ok: true, data: null })),
    ),
    add: vi.fn(overrides.add ?? (() => Promise.reject(new Error('add não deveria ser chamado')))),
  };
  window.projectHub = { ping: vi.fn(), projects } as unknown as ProjectHubApi;
  return projects;
}

afterEach(() => {
  Reflect.deleteProperty(window, 'projectHub');
});

describe('ProjectsPage: listagem', () => {
  it('mostra o título Projetos e, sem projetos, o estado vazio', async () => {
    installApi();
    render(
      <MemoryRouter>
        <ProjectsPage />
      </MemoryRouter>,
    );

    expect(screen.getByRole('heading', { level: 1, name: 'Projetos' })).toBeInTheDocument();
    expect(
      await screen.findByText('Nenhum projeto ainda. Adicione uma pasta para começar.'),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Adicionar projeto' })).toBeEnabled();
  });

  it('mostra um cartão por projeto, com nome, caminho e tipo de repositório', async () => {
    installApi({ list: () => Promise.resolve({ ok: true, data: [hub, outro] }) });
    render(
      <MemoryRouter>
        <ProjectsPage />
      </MemoryRouter>,
    );

    const list = await screen.findByRole('list', { name: 'Projetos cadastrados' });
    const cards = within(list).getAllByRole('listitem');
    expect(cards).toHaveLength(2);
    expect(within(cards[0]!).getByRole('heading', { name: 'Project Hub' })).toBeInTheDocument();
    expect(within(cards[0]!).getByText('C:\\Projetos\\Project Hub')).toBeInTheDocument();
    expect(within(cards[0]!).getByText('Repositório Git')).toBeInTheDocument();
    expect(within(cards[1]!).getByText('Sem Git')).toBeInTheDocument();
  });

  it('marca a pasta que sumiu com o aviso Pasta indisponível', async () => {
    installApi({
      list: () => Promise.resolve({ ok: true, data: [{ ...outro, available: false }] }),
    });
    render(
      <MemoryRouter>
        <ProjectsPage />
      </MemoryRouter>,
    );

    expect(await screen.findByText('Pasta indisponível')).toBeInTheDocument();
  });

  it('mostra a mensagem que a API devolveu quando a listagem falha', async () => {
    installApi({
      list: () =>
        Promise.resolve({
          ok: false,
          error: { code: 'UNKNOWN', message: 'Não foi possível ler o catálogo.', retryable: false },
        }),
    });
    render(
      <MemoryRouter>
        <ProjectsPage />
      </MemoryRouter>,
    );

    expect(await screen.findByRole('alert')).toHaveTextContent('Não foi possível ler o catálogo.');
  });

  it('mostra uma mensagem geral quando a chamada ao processo principal falha', async () => {
    installApi({ list: () => Promise.reject(new Error('canal fechado')) });
    render(
      <MemoryRouter>
        <ProjectsPage />
      </MemoryRouter>,
    );

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Não foi possível concluir a ação. Tente de novo.',
    );
  });
});

describe('ProjectsPage: adicionar projeto', () => {
  it('escolhe a pasta, cadastra e refaz a listagem no processo principal', async () => {
    const novo: ProjectSummary = {
      id: 'p3',
      name: 'Novo',
      path: 'C:\\Projetos\\Novo',
      repositoryKind: 'none',
      available: true,
    };
    // Depois do cadastro, a página pede a lista de novo: a segunda resposta já traz o projeto.
    let listCalls = 0;
    const projects = installApi({
      list: () => {
        listCalls += 1;
        return Promise.resolve<AppResult<ProjectSummary[]>>({
          ok: true,
          data: listCalls === 1 ? [] : [novo],
        });
      },
      chooseDirectory: () => Promise.resolve({ ok: true, data: { path: 'C:\\Projetos\\Novo' } }),
      add: () => Promise.resolve({ ok: true, data: novo }),
    });
    const user = userEvent.setup();
    render(
      <MemoryRouter>
        <ProjectsPage />
      </MemoryRouter>,
    );
    await screen.findByText('Nenhum projeto ainda. Adicione uma pasta para começar.');

    await user.click(screen.getByRole('button', { name: 'Adicionar projeto' }));

    expect(await screen.findByRole('heading', { name: 'Novo' })).toBeInTheDocument();
    expect(projects.add).toHaveBeenCalledWith({ path: 'C:\\Projetos\\Novo' });
    expect(projects.list).toHaveBeenCalledTimes(2);
  });

  it('avisa a barra lateral, pelo evento da janela, quando um projeto é cadastrado', async () => {
    const novo: ProjectSummary = {
      id: 'p3',
      name: 'Novo',
      path: 'C:\\Projetos\\Novo',
      repositoryKind: 'none',
      available: true,
    };
    installApi({
      chooseDirectory: () => Promise.resolve({ ok: true, data: { path: 'C:\\Projetos\\Novo' } }),
      add: () => Promise.resolve({ ok: true, data: novo }),
    });
    const avisos = vi.fn();
    window.addEventListener(PROJECTS_CHANGED_EVENT, avisos);
    try {
      const user = userEvent.setup();
      render(
        <MemoryRouter>
          <ProjectsPage />
        </MemoryRouter>,
      );
      await screen.findByText('Nenhum projeto ainda. Adicione uma pasta para começar.');

      await user.click(screen.getByRole('button', { name: 'Adicionar projeto' }));

      await waitFor(() => expect(avisos).toHaveBeenCalledTimes(1));
    } finally {
      window.removeEventListener(PROJECTS_CHANGED_EVENT, avisos);
    }
  });

  it('cancelar a escolha não cadastra nada e não mostra erro', async () => {
    const projects = installApi({
      chooseDirectory: () => Promise.resolve({ ok: true, data: null }),
    });
    const user = userEvent.setup();
    render(
      <MemoryRouter>
        <ProjectsPage />
      </MemoryRouter>,
    );
    await screen.findByText('Nenhum projeto ainda. Adicione uma pasta para começar.');

    await user.click(screen.getByRole('button', { name: 'Adicionar projeto' }));

    expect(projects.chooseDirectory).toHaveBeenCalledTimes(1);
    expect(projects.add).not.toHaveBeenCalled();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('mostra a mensagem da API quando o cadastro é recusado, e mantém a lista', async () => {
    installApi({
      list: () => Promise.resolve({ ok: true, data: [hub] }),
      chooseDirectory: () =>
        Promise.resolve({ ok: true, data: { path: 'C:\\Projetos\\Project Hub' } }),
      add: () =>
        Promise.resolve({
          ok: false,
          error: {
            code: 'PROJECT_ALREADY_EXISTS',
            message: 'Esta pasta já está cadastrada.',
            retryable: false,
          },
        }),
    });
    const user = userEvent.setup();
    render(
      <MemoryRouter>
        <ProjectsPage />
      </MemoryRouter>,
    );
    await screen.findByRole('heading', { name: 'Project Hub' });

    await user.click(screen.getByRole('button', { name: 'Adicionar projeto' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Esta pasta já está cadastrada.');
    expect(screen.getByRole('heading', { name: 'Project Hub' })).toBeInTheDocument();
  });

  it('desabilita o botão enquanto o cadastro está em andamento', async () => {
    let finishChoice: (value: { ok: true; data: null }) => void = () => undefined;
    installApi({
      chooseDirectory: () =>
        new Promise((resolve) => {
          finishChoice = resolve;
        }),
    });
    const user = userEvent.setup();
    render(
      <MemoryRouter>
        <ProjectsPage />
      </MemoryRouter>,
    );
    await screen.findByText('Nenhum projeto ainda. Adicione uma pasta para começar.');

    await user.click(screen.getByRole('button', { name: 'Adicionar projeto' }));
    expect(screen.getByRole('button', { name: 'Adicionar projeto' })).toBeDisabled();

    finishChoice({ ok: true, data: null });
    expect(await screen.findByRole('button', { name: 'Adicionar projeto' })).toBeEnabled();
  });
});
