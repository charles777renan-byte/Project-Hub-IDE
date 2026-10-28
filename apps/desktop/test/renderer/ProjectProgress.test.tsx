import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type {
  AppResult,
  MissionDto,
  MissionStepDto,
  MissionViewDto,
  ProjectHubApi,
  ProjectSummary,
} from '@project-hub/contracts';
import { MemoryRouter } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ProjectProgress } from '../../src/renderer/components/progress/ProjectProgress';
import { HOME_TEXT } from '../../src/renderer/mission-text';

/**
 * A aba Progresso do projeto, montada: a leitura vem do hook (carga compartilhada da lista e `missions.get`),
 * o resumo filtra, cada grupo tem o título e as missões, a primeira em andamento abre expandida e a atividade
 * fica ao lado.
 */

const project: ProjectSummary = {
  id: 'p1',
  name: 'Project Hub',
  path: 'C:\\Projetos\\Project Hub',
  repositoryKind: 'git',
  available: true,
  defaultBranch: 'main',
};

const TODAY = new Date().toISOString();

function missionOf(
  id: string,
  status: MissionDto['status'],
  updatedAt = '2026-10-20T09:00:00.000Z',
  finishedAt?: string,
): MissionDto {
  return {
    id,
    projectId: 'p1',
    title: `Missão ${id}`,
    objective: 'Objetivo',
    status,
    altersCode: false,
    acceptanceCriteria: [],
    createdAt: '2026-10-20T09:00:00.000Z',
    updatedAt,
    ...(finishedAt === undefined ? {} : { finishedAt }),
  };
}

function task(
  id: string,
  status: MissionStepDto['status'],
  extra: Partial<MissionStepDto> = {},
): MissionStepDto {
  return {
    id,
    position: 1,
    title: `Tarefa ${id}`,
    status,
    agent: 'claude-code',
    role: 'general',
    ...extra,
  };
}

type Options = {
  missions?: MissionDto[];
  projects?: 'pending' | 'error';
  steps?: (missionId: string) => MissionStepDto[];
};

function installApi({ missions = [], projects, steps = () => [] }: Options = {}) {
  const api = {
    projects: {
      list: vi.fn(() => {
        if (projects === 'pending') return new Promise(() => undefined);
        if (projects === 'error') return Promise.reject(new Error('falhou'));
        return Promise.resolve({ ok: true, data: [project] });
      }),
    },
    missions: {
      list: vi.fn(() => Promise.resolve({ ok: true, data: missions })),
      get: vi.fn((missionId: string) =>
        Promise.resolve<AppResult<MissionViewDto>>({
          ok: true,
          data: {
            mission: missions.find((entry) => entry.id === missionId),
            steps: steps(missionId),
            events: [],
            pendingApprovals: [],
          } as unknown as MissionViewDto,
        }),
      ),
      subscribe: vi.fn(() => () => undefined),
    },
  };
  window.projectHub = api as unknown as ProjectHubApi;
  return api;
}

function renderProgress(shown: ProjectSummary | undefined = project) {
  return render(
    <MemoryRouter>
      <ProjectProgress projectId="p1" project={shown} />
    </MemoryRouter>,
  );
}

const MISSIONS = [
  missionOf('A', 'running', '2026-10-20T10:00:00.000Z'),
  missionOf('B', 'running', '2026-10-20T09:00:00.000Z'),
  missionOf('C', 'waiting_approval', '2026-10-20T08:00:00.000Z'),
  missionOf('D', 'failed', '2026-10-20T07:00:00.000Z'),
  missionOf('E', 'succeeded', '2026-10-20T06:00:00.000Z', TODAY),
  missionOf('F', 'draft'),
];

const stepsOf = (missionId: string): MissionStepDto[] => [
  task(`${missionId}1`, 'succeeded', { position: 1 }),
  task(`${missionId}2`, missionId === 'D' ? 'failed' : 'running', { position: 2 }),
];

afterEach(() => {
  Reflect.deleteProperty(window, 'projectHub');
});

describe('ProjectProgress', () => {
  it('carregando mostra "Carregando…" e nem o vazio nem o link de todas as missões', () => {
    installApi({ projects: 'pending' });
    renderProgress(undefined);

    expect(screen.getByText('Carregando…')).toBeInTheDocument();
    expect(screen.queryByText(/Nada em andamento/)).toBeNull();
    expect(screen.queryByRole('link', { name: 'Ver todas as missões' })).toBeNull();
  });

  it('erro da lista mostra o alerta das missões', async () => {
    installApi({ projects: 'error' });
    renderProgress(undefined);

    expect(await screen.findByRole('alert')).toHaveTextContent(HOME_TEXT.missionsError);
    expect(screen.queryByText(/Nada em andamento/)).toBeNull();
  });

  it('sem missão nos grupos mostra a frase de vazio e o link para as missões', async () => {
    installApi({ missions: [missionOf('F', 'draft'), missionOf('G', 'cancelled')] });
    renderProgress();

    expect(
      await screen.findByText('Nada em andamento. As missões novas aparecem aqui.'),
    ).toBeInTheDocument();
    const seeAll = screen.getByRole('link', { name: 'Ver todas as missões' });
    expect(seeAll).toHaveAttribute('href', '/workspaces/p1?visao=missoes');
    expect(seeAll).toHaveClass('progress-empty__action');
    expect(screen.queryByRole('heading', { level: 2 })).toBeNull();
    expect(screen.getByText('Nada aconteceu ainda.')).toBeInTheDocument();
  });

  it('com missões traz um título por grupo não vazio, na ordem dos grupos, e o resumo', async () => {
    installApi({ missions: MISSIONS, steps: stepsOf });
    renderProgress();

    await screen.findByRole('heading', { level: 2, name: 'Em andamento' });
    expect(screen.getAllByRole('heading', { level: 2 }).map((node) => node.textContent)).toEqual([
      expect.stringMatching(/^Em andamento/),
      expect.stringMatching(/^Precisa de você/),
      expect.stringMatching(/^Falharam/),
      expect.stringMatching(/^Concluídas hoje/),
    ]);
    expect(screen.getAllByRole('button', { name: /Missão/ })).toHaveLength(5);
    expect(screen.queryByText(/Nada em andamento/)).toBeNull();
    expect(screen.queryByRole('link', { name: 'Ver todas as missões' })).toBeNull();
    // O rascunho não entra; o resumo traz quatro botões com aria-pressed.
    expect(screen.queryByText('Missão F')).toBeNull();
    expect(
      screen.getAllByRole('button').filter((button) => button.hasAttribute('aria-pressed')),
    ).toHaveLength(4);
  });

  it('um grupo vazio não ganha título', async () => {
    installApi({ missions: [missionOf('A', 'running')], steps: stepsOf });
    renderProgress();

    await screen.findByRole('heading', { level: 2, name: 'Em andamento' });
    expect(screen.getAllByRole('heading', { level: 2 })).toHaveLength(1);
  });

  it('a primeira missão em andamento abre expandida, as outras recolhidas, e o botão alterna', async () => {
    const user = userEvent.setup();
    installApi({ missions: MISSIONS, steps: stepsOf });
    renderProgress();

    const first = await screen.findByRole('button', { name: /Missão A/ });
    await waitFor(() => expect(first).toHaveAttribute('aria-expanded', 'true'));
    expect(screen.getByRole('table', { name: 'Tarefas de Missão A' })).toBeInTheDocument();
    const second = screen.getByRole('button', { name: /Missão B/ });
    await waitFor(() => expect(second).not.toBeDisabled());
    expect(second).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByRole('table', { name: 'Tarefas de Missão B' })).toBeNull();

    await user.click(second);
    expect(second).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByRole('table', { name: 'Tarefas de Missão B' })).toBeInTheDocument();

    await user.click(first);
    expect(first).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByRole('table', { name: 'Tarefas de Missão A' })).toBeNull();
    // Recolher uma não mexe na outra.
    expect(second).toHaveAttribute('aria-expanded', 'true');
  });

  it('escolher um grupo no resumo esconde os outros e escolher de novo os traz de volta', async () => {
    const user = userEvent.setup();
    installApi({ missions: MISSIONS, steps: stepsOf });
    renderProgress();

    await screen.findByRole('heading', { level: 2, name: 'Em andamento' });
    const failed = screen.getByRole('button', { name: /Falharam/ });
    await user.click(failed);

    expect(failed).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getAllByRole('heading', { level: 2 })).toHaveLength(1);
    expect(screen.getByRole('heading', { level: 2, name: 'Falharam' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Missão D/ })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Missão A/ })).toBeNull();

    await user.click(failed);
    expect(failed).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getAllByRole('heading', { level: 2 })).toHaveLength(4);
  });

  it('um filtro sem missões diz que não há nenhuma neste estado, sem a frase de vazio geral', async () => {
    const user = userEvent.setup();
    installApi({ missions: [missionOf('A', 'running')], steps: stepsOf });
    renderProgress();

    await screen.findByRole('heading', { level: 2, name: 'Em andamento' });
    await user.click(screen.getByRole('button', { name: /Falharam/ }));

    expect(screen.getByText(HOME_TEXT.missionsEmptyFiltered)).toBeInTheDocument();
    expect(screen.queryByText(/Nada em andamento/)).toBeNull();
  });

  it('a ordem no DOM é resumo, grupos e atividade, e a atividade é o aside', async () => {
    installApi({ missions: MISSIONS, steps: stepsOf });
    const { container } = renderProgress();

    await screen.findByRole('heading', { level: 2, name: 'Em andamento' });
    const aside = screen.getByRole('complementary', { name: 'Atividade recente' });
    const summary = container.querySelector('.progress-summary') as HTMLElement;
    const heading = screen.getByRole('heading', { level: 2, name: 'Em andamento' });
    expect(
      summary.compareDocumentPosition(heading) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(heading.compareDocumentPosition(aside) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(within(aside).queryByRole('heading')).toBeNull();
  });

  it('não usa o atributo style (CSP)', async () => {
    installApi({ missions: MISSIONS, steps: stepsOf });
    const { container } = renderProgress();

    await screen.findByRole('heading', { level: 2, name: 'Em andamento' });
    expect(container.querySelectorAll('[style]')).toHaveLength(0);
  });
});
