import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import type { AppResult, ProjectHubApi, ProjectSummary } from '@project-hub/contracts';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ProjectSettings } from '../../src/renderer/components/project/ProjectSettings';
import { PROJECTS_CHANGED_EVENT } from '../../src/renderer/projects-events';

const project: ProjectSummary = {
  id: 'p1',
  name: 'Project Hub',
  path: 'C:\\Projetos\\Project Hub',
  repositoryKind: 'git',
  available: true,
  defaultBranch: 'main',
};

function installApi(projects: ProjectSummary[] = [project]) {
  const ok = () => Promise.resolve<AppResult<void>>({ ok: true, data: undefined });
  const api = {
    projects: {
      list: vi.fn(() => Promise.resolve({ ok: true, data: projects })),
      openFolder: vi.fn(ok),
      setGroup: vi.fn(ok),
      setNickname: vi.fn(ok),
    },
    missions: {
      list: vi.fn(() => Promise.resolve({ ok: true, data: [] })),
      subscribe: vi.fn(() => () => undefined),
    },
  };
  window.projectHub = api as unknown as ProjectHubApi;
  return api;
}

function renderSettings(shown: ProjectSummary = project) {
  return render(
    <MemoryRouter>
      <ProjectSettings project={shown} />
    </MemoryRouter>,
  );
}

afterEach(() => {
  Reflect.deleteProperty(window, 'projectHub');
});

describe('ProjectSettings: pasta, tipo e branch', () => {
  it('mostra o tipo, a branch padrão e a pasta, só com o nome dela e o caminho na dica', () => {
    installApi();
    renderSettings();

    expect(screen.getByText('Repositório Git')).toBeInTheDocument();
    expect(screen.getByText('main')).toBeInTheDocument();
    expect(screen.getByText('Project Hub')).toHaveAttribute('title', 'C:\\Projetos\\Project Hub');
  });

  it('projeto sem Git diz "Sem Git" no tipo e não mostra a linha da branch', () => {
    installApi();
    renderSettings({ ...project, repositoryKind: 'none', defaultBranch: undefined });

    expect(screen.getByText('Sem Git')).toBeInTheDocument();
    expect(screen.queryByText('Branch padrão')).not.toBeInTheDocument();
  });

  it('Abrir pasta pede ao processo principal pelo id do projeto, e não pelo caminho', async () => {
    const api = installApi();
    renderSettings();

    await userEvent.click(screen.getByRole('button', { name: 'Abrir pasta' }));

    expect(api.projects.openFolder).toHaveBeenCalledWith('p1');
  });

  it('Copiar caminho copia o caminho inteiro e avisa que copiou', async () => {
    installApi();
    const writeText = vi.fn(() => Promise.resolve());
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    renderSettings();

    await userEvent.click(screen.getByRole('button', { name: 'Copiar caminho' }));

    expect(writeText).toHaveBeenCalledWith('C:\\Projetos\\Project Hub');
    expect(await screen.findByText('Copiado')).toBeInTheDocument();
  });
});

describe('ProjectSettings: grupo', () => {
  it('grava o grupo, avisa a barra lateral e confirma no aviso de status', async () => {
    const api = installApi();
    const avisos = vi.fn();
    window.addEventListener(PROJECTS_CHANGED_EVENT, avisos);
    const user = userEvent.setup();
    renderSettings();

    const form = screen.getByRole('form', { name: 'Grupo do projeto' });
    await user.type(within(form).getByLabelText('Grupo'), 'Trabalho');
    await user.click(within(form).getByRole('button', { name: 'Salvar' }));

    expect(api.projects.setGroup).toHaveBeenCalledWith('p1', 'Trabalho');
    await waitFor(() => expect(avisos).toHaveBeenCalled());
    expect(await screen.findByRole('status', { name: 'Situação do grupo' })).toHaveTextContent(
      'Grupo salvo.',
    );
    window.removeEventListener(PROJECTS_CHANGED_EVENT, avisos);
  });

  it('o campo traz o grupo atual e oferece os grupos que já existem', async () => {
    installApi([project, { ...project, id: 'p2', name: 'Outro', group: 'Pessoal' }]);
    renderSettings({ ...project, group: 'Trabalho' });

    expect(screen.getByLabelText('Grupo')).toHaveValue('Trabalho');
    await waitFor(() =>
      expect(document.querySelector('#project-groups option[value="Pessoal"]')).not.toBeNull(),
    );
  });

  it('projeto com grupo oferece Tirar do grupo, que grava null', async () => {
    const api = installApi();
    const user = userEvent.setup();
    renderSettings({ ...project, group: 'Pessoal' });

    await user.click(screen.getByRole('button', { name: 'Tirar do grupo' }));

    expect(api.projects.setGroup).toHaveBeenCalledWith('p1', null);
    expect(await screen.findByLabelText('Grupo')).toHaveValue('');
  });

  it('projeto sem grupo não oferece Tirar do grupo', () => {
    installApi();
    renderSettings();

    expect(screen.queryByRole('button', { name: 'Tirar do grupo' })).not.toBeInTheDocument();
  });

  it('falha ao gravar mostra a mensagem da API no formulário', async () => {
    const api = installApi();
    api.projects.setGroup.mockResolvedValueOnce({
      ok: false,
      error: { code: 'VALIDATION_FAILED', message: 'Nome longo demais.', retryable: false },
    });
    const user = userEvent.setup();
    renderSettings();

    await user.type(screen.getByLabelText('Grupo'), 'x');
    await user.click(
      within(screen.getByRole('form', { name: 'Grupo do projeto' })).getByRole('button', {
        name: 'Salvar',
      }),
    );

    const form = screen.getByRole('form', { name: 'Grupo do projeto' });
    expect(await within(form).findByRole('alert')).toHaveTextContent('Nome longo demais.');
    expect(screen.getByRole('status', { name: 'Situação do grupo' })).toBeEmptyDOMElement();
  });
});

describe('ProjectSettings: apelido', () => {
  it('o campo tem limite de 24 caracteres e o exemplo, e Salvar grava o valor e avisa a lateral', async () => {
    const api = installApi();
    const avisos = vi.fn();
    window.addEventListener(PROJECTS_CHANGED_EVENT, avisos);
    const user = userEvent.setup();
    renderSettings();

    const form = screen.getByRole('form', { name: 'Apelido do projeto' });
    const campo = within(form).getByLabelText('Apelido');
    expect(campo).toHaveAttribute('maxlength', '24');
    expect(campo).toHaveAttribute('placeholder', 'ex.: Re_Zero');
    expect(within(form).queryByRole('button', { name: 'Remover apelido' })).not.toBeInTheDocument();
    await user.type(campo, 'Re_Zero');
    await user.click(within(form).getByRole('button', { name: 'Salvar' }));

    expect(api.projects.setNickname).toHaveBeenCalledWith('p1', 'Re_Zero');
    await waitFor(() => expect(avisos).toHaveBeenCalled());
    expect(await screen.findByRole('status', { name: 'Situação do apelido' })).toHaveTextContent(
      'Apelido salvo.',
    );
    window.removeEventListener(PROJECTS_CHANGED_EVENT, avisos);
  });

  it('projeto com apelido parte dele e oferece Remover apelido, que grava null', async () => {
    const api = installApi();
    const user = userEvent.setup();
    renderSettings({ ...project, nickname: 'Re_Zero' });

    expect(screen.getByLabelText('Apelido')).toHaveValue('Re_Zero');
    await user.click(screen.getByRole('button', { name: 'Remover apelido' }));

    expect(api.projects.setNickname).toHaveBeenCalledWith('p1', null);
    expect(await screen.findByLabelText('Apelido')).toHaveValue('');
  });

  it('falha ao gravar mostra o alerta e mantém o texto digitado', async () => {
    const api = installApi();
    api.projects.setNickname.mockResolvedValueOnce({
      ok: false,
      error: {
        code: 'VALIDATION_FAILED',
        message: 'O apelido pode ter até 24 caracteres.',
        retryable: false,
      },
    });
    const user = userEvent.setup();
    renderSettings();

    await user.type(screen.getByLabelText('Apelido'), 'x');
    await user.click(
      within(screen.getByRole('form', { name: 'Apelido do projeto' })).getByRole('button', {
        name: 'Salvar',
      }),
    );

    const form = screen.getByRole('form', { name: 'Apelido do projeto' });
    expect(await within(form).findByRole('alert')).toHaveTextContent(
      'O apelido pode ter até 24 caracteres.',
    );
    expect(within(form).getByLabelText('Apelido')).toHaveValue('x');
  });
});
