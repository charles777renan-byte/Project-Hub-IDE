import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, useLocation } from 'react-router';
import type { AppResult, ProjectHubApi, ProjectSummary } from '@project-hub/contracts';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  ADD_PROJECT_REQUEST_EVENT,
  PROJECTS_CHANGED_EVENT,
} from '../../src/renderer/projects-events';
import { projectPath } from '../../src/renderer/routes';
import { useProjectActions } from '../../src/renderer/use-project-actions';

/**
 * As ações de projeto da barra lateral, vistas de fora pela rota: o botão e o pedido da janela cadastram do
 * mesmo jeito, e só o pedido com `irParaMissoes` (o estado vazio do Início) leva à visão Missões do projeto.
 */

function project(id: string): ProjectSummary {
  return {
    id,
    name: `Projeto ${id}`,
    path: `C:\\${id}`,
    repositoryKind: 'git',
    available: true,
    defaultBranch: 'main',
  };
}

/**
 * A API falsa. `projects.list` (a barra lateral, pela carga compartilhada) passa a listar o projeto cadastrado;
 * com `listsNew: false`, a lista nunca o traz, e o teste vê a navegação esperar o teto e seguir mesmo assim.
 */
function installApi(
  choice: AppResult<{ path: string } | null>,
  { listsNew = true }: { listsNew?: boolean } = {},
) {
  const listed: ProjectSummary[] = [];
  const api = {
    projects: {
      list: vi.fn(() =>
        Promise.resolve<AppResult<ProjectSummary[]>>({ ok: true, data: [...listed] }),
      ),
      listArchived: vi.fn(() =>
        Promise.resolve<AppResult<ProjectSummary[]>>({ ok: true, data: [] }),
      ),
      chooseDirectory: vi.fn(() => Promise.resolve(choice)),
      add: vi.fn(() => {
        const added = project('p2');
        if (listsNew) listed.push(added);
        return Promise.resolve<AppResult<ProjectSummary>>({ ok: true, data: added });
      }),
    },
    missions: {
      list: vi.fn(() => Promise.resolve<AppResult<never[]>>({ ok: true, data: [] })),
      subscribe: vi.fn(() => () => {}),
    },
  };
  window.projectHub = api as unknown as ProjectHubApi;
  return api;
}

/** Hook montado numa rota de teste: o botão chama `addProject` como a lateral, e o `where` mostra a rota. */
function Harness() {
  const actions = useProjectActions();
  const location = useLocation();
  return (
    <>
      <button type="button" onClick={() => void actions.addProject()}>
        Adicionar pela barra
      </button>
      <p data-testid="where">{`${location.pathname}${location.search}`}</p>
    </>
  );
}

function renderHarness() {
  return render(
    <MemoryRouter initialEntries={['/']}>
      <Harness />
    </MemoryRouter>,
  );
}

function where(): string | null {
  return screen.getByTestId('where').textContent;
}

/** Espera o cadastro terminar: o hook avisa a janela por `PROJECTS_CHANGED_EVENT` depois de adicionar. */
function ouvirCadastro(): { changed: ReturnType<typeof vi.fn>; stop: () => void } {
  const changed = vi.fn();
  window.addEventListener(PROJECTS_CHANGED_EVENT, changed);
  return { changed, stop: () => window.removeEventListener(PROJECTS_CHANGED_EVENT, changed) };
}

let stopListening: (() => void) | undefined;

afterEach(() => {
  stopListening?.();
  stopListening = undefined;
  Reflect.deleteProperty(window, 'projectHub');
});

describe('useProjectActions: pedido de adicionar projeto', () => {
  it('com irParaMissoes, leva à visão Missões do projeto cadastrado', async () => {
    const api = installApi({ ok: true, data: { path: 'C:\\p2' } });
    renderHarness();
    const { changed, stop } = ouvirCadastro();
    stopListening = stop;

    act(() => {
      window.dispatchEvent(
        new CustomEvent(ADD_PROJECT_REQUEST_EVENT, { detail: { irParaMissoes: true } }),
      );
    });

    await waitFor(() => expect(where()).toBe(projectPath('p2')));
    expect(api.projects.add).toHaveBeenCalledWith({ path: 'C:\\p2' });
    expect(changed).toHaveBeenCalled();
  });

  it('com irParaMissoes, se a barra não listar o projeto, navega mesmo assim depois do teto', async () => {
    installApi({ ok: true, data: { path: 'C:\\p2' } }, { listsNew: false });
    renderHarness();

    act(() => {
      window.dispatchEvent(
        new CustomEvent(ADD_PROJECT_REQUEST_EVENT, { detail: { irParaMissoes: true } }),
      );
    });

    await waitFor(() => expect(where()).toBe(projectPath('p2')), { timeout: 4000 });
  });

  it('sem detalhe, cadastra e a rota fica onde está', async () => {
    const api = installApi({ ok: true, data: { path: 'C:\\p2' } });
    renderHarness();
    const { changed, stop } = ouvirCadastro();
    stopListening = stop;

    act(() => {
      window.dispatchEvent(new Event(ADD_PROJECT_REQUEST_EVENT));
    });

    await waitFor(() => expect(changed).toHaveBeenCalled());
    await act(() => Promise.resolve());
    expect(api.projects.add).toHaveBeenCalledTimes(1);
    expect(where()).toBe('/');
  });

  it('com detalhe sem irParaMissoes, a rota fica onde está', async () => {
    installApi({ ok: true, data: { path: 'C:\\p2' } });
    renderHarness();
    const { changed, stop } = ouvirCadastro();
    stopListening = stop;

    act(() => {
      window.dispatchEvent(new CustomEvent(ADD_PROJECT_REQUEST_EVENT, { detail: {} }));
    });

    await waitFor(() => expect(changed).toHaveBeenCalled());
    await act(() => Promise.resolve());
    expect(where()).toBe('/');
  });

  it('o botão da barra cadastra e não leva às missões', async () => {
    const user = userEvent.setup();
    const api = installApi({ ok: true, data: { path: 'C:\\p2' } });
    renderHarness();
    const { changed, stop } = ouvirCadastro();
    stopListening = stop;

    await user.click(screen.getByRole('button', { name: 'Adicionar pela barra' }));

    await waitFor(() => expect(changed).toHaveBeenCalled());
    expect(api.projects.add).toHaveBeenCalledTimes(1);
    expect(where()).toBe('/');
  });

  it('pedido com irParaMissoes que o seletor cancela não cadastra nem navega', async () => {
    const api = installApi({ ok: true, data: null });
    renderHarness();

    act(() => {
      window.dispatchEvent(
        new CustomEvent(ADD_PROJECT_REQUEST_EVENT, { detail: { irParaMissoes: true } }),
      );
    });

    await waitFor(() => expect(api.projects.chooseDirectory).toHaveBeenCalledTimes(1));
    await act(() => Promise.resolve());
    expect(api.projects.add).not.toHaveBeenCalled();
    expect(where()).toBe('/');
  });
});
