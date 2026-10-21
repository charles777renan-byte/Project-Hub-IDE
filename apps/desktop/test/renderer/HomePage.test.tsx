import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router';
import type {
  AppResult,
  ApprovalDto,
  MissionDto,
  MissionViewDto,
  ProjectHubApi,
  ProjectSummary,
} from '@project-hub/contracts';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { HomePage } from '../../src/renderer/pages/HomePage';
import { missionPath, projectPath, ROUTE_PATHS } from '../../src/renderer/routes';

/**
 * Painel do Início (Tarefa 8b do plano da interface): quatro painéis alimentados pela carga
 * compartilhada da visão geral. A API do preload é falsa; cada teste monta projetos, missões e as
 * leituras de `missions.get`.
 */

type Status = MissionDto['status'];

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

function mission(id: string, projectId: string, status: Status): MissionDto {
  return {
    id,
    projectId,
    title: `Missão ${id}`,
    objective: 'Objetivo da missão',
    status,
    altersCode: false,
    acceptanceCriteria: [{ id: `${id}-c1`, position: 1, text: 'Critério' }],
    createdAt: '2026-10-20T09:00:00.000Z',
    updatedAt: '2026-10-20T09:00:00.000Z',
  };
}

function approval(missionId: string): ApprovalDto {
  return {
    id: `ap-${missionId}`,
    missionId,
    executionId: 'ex1',
    actionType: 'command',
    title: `Aprovar ${missionId}`,
    rationale: 'Motivo',
    affectedResources: [],
    status: 'pending',
    requestedAt: '2026-10-20T09:10:00.000Z',
  };
}

type Setup = {
  projects?: ProjectSummary[] | 'error';
  missions?: Record<string, MissionDto[]>;
  /** Resposta de `missions.get` por missão; `undefined` devolve a aprovação da missão. */
  get?: (missionId: string) => AppResult<MissionViewDto> | 'pending' | undefined;
};

function installApi({ projects = [], missions = {}, get }: Setup) {
  const api = {
    projects: {
      list: vi.fn(() =>
        Promise.resolve<AppResult<ProjectSummary[]>>(
          projects === 'error'
            ? { ok: false, error: { code: 'UNKNOWN', message: 'Falhou.', retryable: true } }
            : { ok: true, data: projects },
        ),
      ),
    },
    missions: {
      list: vi.fn((projectId: string) =>
        Promise.resolve<AppResult<MissionDto[]>>({ ok: true, data: missions[projectId] ?? [] }),
      ),
      get: vi.fn((missionId: string) => {
        const custom = get?.(missionId);
        if (custom === 'pending') return new Promise<never>(() => {});
        if (custom !== undefined) return Promise.resolve(custom);
        return Promise.resolve({
          ok: true,
          data: { pendingApprovals: [approval(missionId)] },
        });
      }),
      subscribe: vi.fn(() => () => {}),
    },
  };
  window.projectHub = api as unknown as ProjectHubApi;
}

function Where() {
  return <p data-testid="where">{useLocation().pathname}</p>;
}

function renderHome() {
  return render(
    <MemoryRouter initialEntries={[ROUTE_PATHS.home]}>
      <Routes>
        <Route path={ROUTE_PATHS.home} element={<HomePage />} />
        <Route path="*" element={<Where />} />
      </Routes>
    </MemoryRouter>,
  );
}

function panel(name: string) {
  return screen.getByRole('region', { name });
}

afterEach(() => {
  Reflect.deleteProperty(window, 'projectHub');
});

describe('HomePage', () => {
  it('cada painel lista o que vem da visão geral', async () => {
    installApi({
      projects: [project('p1')],
      missions: {
        p1: [
          mission('m1', 'p1', 'running'),
          mission('m2', 'p1', 'failed'),
          mission('m3', 'p1', 'waiting_approval'),
        ],
      },
    });

    renderHome();

    expect(await within(panel('Aguardando você')).findByText('Aprovar m3')).toBeInTheDocument();
    expect(within(panel('Missões em execução')).getByText('Missão m1')).toBeInTheDocument();
    expect(within(panel('Falharam')).getByText('Missão m2')).toBeInTheDocument();
    expect(within(panel('Projetos recentes')).getByText('Projeto p1')).toBeInTheDocument();
  });

  it('com tudo vazio, mostra os estados vazios e o convite para adicionar projeto', async () => {
    installApi({});

    renderHome();

    expect(await screen.findByText('Nada espera por você')).toBeInTheDocument();
    expect(screen.getByText('Nenhuma missão em execução.')).toBeInTheDocument();
    expect(screen.getByText('Nenhuma missão falhou.')).toBeInTheDocument();
    expect(
      screen.getByText('Nenhum projeto ainda. Adicione um projeto para começar.'),
    ).toBeInTheDocument();
    expect(
      within(panel('Projetos recentes')).getByRole('link', { name: /projetos/i }),
    ).toHaveAttribute('href', ROUTE_PATHS.projects);
  });

  it('enquanto as aprovações não carregam, Aguardando você mostra Carregando e não o vazio', async () => {
    installApi({
      projects: [project('p1')],
      missions: { p1: [mission('m1', 'p1', 'running'), mission('m3', 'p1', 'waiting_approval')] },
      get: () => 'pending',
    });

    renderHome();

    // A missão em execução serve de marca: quando ela aparece, a fase 1 já chegou.
    expect(await screen.findByText('Missão m1')).toBeInTheDocument();
    expect(within(panel('Aguardando você')).getByText('Carregando…')).toBeInTheDocument();
    expect(screen.queryByText('Nada espera por você')).not.toBeInTheDocument();
  });

  it('os links de aprovação e de missão apontam para a missão', async () => {
    installApi({
      projects: [project('p1')],
      missions: {
        p1: [
          mission('m1', 'p1', 'running'),
          mission('m2', 'p1', 'failed'),
          mission('m3', 'p1', 'waiting_approval'),
        ],
      },
    });

    renderHome();

    const approvalLink = await within(panel('Aguardando você')).findByRole('link', {
      name: /Aprovar m3/,
    });
    expect(approvalLink).toHaveAttribute('href', missionPath('p1', 'm3'));
    expect(approvalLink).not.toHaveAttribute('href', projectPath('p1'));
    expect(
      within(panel('Missões em execução')).getByRole('link', { name: 'Missão m1' }),
    ).toHaveAttribute('href', missionPath('p1', 'm1'));
    expect(within(panel('Falharam')).getByRole('link', { name: 'Missão m2' })).toHaveAttribute(
      'href',
      missionPath('p1', 'm2'),
    );
  });

  it('leituras perdidas aparecem como texto, junto das aprovações lidas', async () => {
    installApi({
      projects: [project('p1')],
      missions: {
        p1: [mission('m3', 'p1', 'waiting_approval'), mission('m4', 'p1', 'waiting_approval')],
      },
      get: (missionId) =>
        missionId === 'm4'
          ? { ok: false, error: { code: 'UNKNOWN', message: 'Falhou.', retryable: true } }
          : undefined,
    });

    renderHome();

    expect(
      await screen.findByText('Não foi possível carregar a aprovação de Missão m4.'),
    ).toBeInTheDocument();
    expect(within(panel('Aguardando você')).getByText('Aprovar m3')).toBeInTheDocument();
    expect(screen.queryByText('Nada espera por você')).not.toBeInTheDocument();
  });

  it('com a barra em erro, mostra a mensagem em Projetos recentes', async () => {
    installApi({ projects: 'error' });

    renderHome();

    expect(
      await within(panel('Projetos recentes')).findByText(
        'Não foi possível carregar os projetos. Tente de novo.',
      ),
    ).toBeInTheDocument();
  });

  it('+ Nova missão leva para a rota de projetos', async () => {
    installApi({ projects: [project('p1')] });
    renderHome();

    await userEvent.click(screen.getByRole('button', { name: '+ Nova missão' }));

    await waitFor(() =>
      expect(screen.getByTestId('where')).toHaveTextContent(ROUTE_PATHS.projects),
    );
  });

  it('tem o painel Falharam e nenhum texto com travad', async () => {
    installApi({});

    renderHome();

    await screen.findByText('Nenhuma missão falhou.');
    expect(panel('Falharam')).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/travad/i);
  });
});
