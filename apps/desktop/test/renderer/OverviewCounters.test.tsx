import { act, render, renderHook, screen, waitFor } from '@testing-library/react';
import type {
  AppResult,
  MissionDto,
  MissionEventDto,
  ProjectHubApi,
  ProjectSummary,
} from '@project-hub/contracts';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { OverviewCounters } from '../../src/renderer/components/OverviewCounters';
import { useOverview } from '../../src/renderer/use-overview';

/**
 * Contadores globais do cabeçalho (Tarefa 7 do plano da interface do workspace): "N executando" conta
 * as missões `running`, e "N aguarda você" conta `planned`, `waiting_approval` e `waiting_input`, de
 * todos os projetos. A API do preload é falsa; cada teste monta os projetos e as missões.
 */

type MissionStatus = MissionDto['status'];
type MissionsResponse = AppResult<MissionDto[]> | 'reject';
type Listener = (event: MissionEventDto) => void;

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

function mission(id: string, projectId: string, status: MissionStatus): MissionDto {
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

function eventFor(missionId: string): MissionEventDto {
  return {
    id: `ev-${missionId}`,
    missionId,
    aggregateType: 'mission',
    aggregateId: missionId,
    eventType: 'mission.status_changed',
    severity: 'info',
    actor: 'agent',
    payload: {},
    sequence: 1,
    createdAt: '2026-10-20T09:05:00.000Z',
  };
}

/**
 * Instala a API falsa em `window.projectHub`. `missionsOf` devolve a resposta de `missions.list` para
 * cada projeto; `'reject'` simula uma chamada que quebra no meio do caminho.
 */
function installApi(
  projects: ProjectSummary[],
  missionsOf: (projectId: string) => MissionsResponse,
) {
  let listener: Listener | undefined;
  const unsubscribe = vi.fn();
  const api = {
    projects: {
      list: vi.fn(() => Promise.resolve<AppResult<ProjectSummary[]>>({ ok: true, data: projects })),
    },
    missions: {
      list: vi.fn((projectId: string) => {
        const response = missionsOf(projectId);
        return response === 'reject'
          ? Promise.reject(new Error('falha de IPC'))
          : Promise.resolve(response);
      }),
      subscribe: vi.fn((next: Listener) => {
        listener = next;
        return unsubscribe;
      }),
    },
  };
  window.projectHub = api as unknown as ProjectHubApi;
  return {
    api,
    unsubscribe,
    emit(missionId: string) {
      listener?.(eventFor(missionId));
    },
  };
}

afterEach(() => {
  Reflect.deleteProperty(window, 'projectHub');
});

describe('OverviewCounters', () => {
  it('conta executando e aguarda você nos projetos, e deixa de fora a missão que falhou', async () => {
    installApi([project('p1'), project('p2')], (projectId) =>
      projectId === 'p1'
        ? { ok: true, data: [mission('m1', 'p1', 'running'), mission('m2', 'p1', 'failed')] }
        : {
            ok: true,
            data: [mission('m3', 'p2', 'waiting_approval'), mission('m4', 'p2', 'planned')],
          },
    );

    render(<OverviewCounters />);

    expect(await screen.findByText('1 executando')).toBeInTheDocument();
    expect(screen.getByText('2 aguarda você')).toBeInTheDocument();
  });

  it.each(['planned', 'waiting_approval', 'waiting_input'] as const)(
    'a missão em "%s" conta como aguarda você',
    async (status) => {
      installApi([project('p1')], () => ({
        ok: true,
        data: [mission('m1', 'p1', status), mission('m2', 'p1', 'running')],
      }));

      render(<OverviewCounters />);

      // A missão em execução serve de marca: quando ela aparece, a leitura já chegou.
      expect(await screen.findByText('1 executando')).toBeInTheDocument();
      expect(screen.getByText('1 aguarda você')).toBeInTheDocument();
    },
  );

  it.each(['draft', 'queued', 'paused', 'succeeded', 'failed', 'cancelled'] as const)(
    'a missão em "%s" não entra em nenhum dos dois contadores',
    async (status) => {
      installApi([project('p1')], () => ({
        ok: true,
        data: [mission('m1', 'p1', status), mission('m2', 'p1', 'running')],
      }));

      render(<OverviewCounters />);

      expect(await screen.findByText('1 executando')).toBeInTheDocument();
      expect(screen.getByText('0 aguarda você')).toBeInTheDocument();
    },
  );

  it('um evento de missão refaz a leitura e atualiza a contagem', async () => {
    let current: MissionDto[] = [mission('m1', 'p1', 'planned')];
    const { api, emit } = installApi([project('p1')], () => ({ ok: true, data: current }));

    render(<OverviewCounters />);
    expect(await screen.findByText('1 aguarda você')).toBeInTheDocument();

    current = [mission('m1', 'p1', 'running')];
    act(() => {
      emit('m1');
    });

    expect(await screen.findByText('1 executando')).toBeInTheDocument();
    expect(screen.getByText('0 aguarda você')).toBeInTheDocument();
    expect(api.missions.list).toHaveBeenCalledTimes(2);
  });

  it('a resposta com erro de um projeto não zera os contadores dos outros', async () => {
    installApi([project('p1'), project('p2')], (projectId) =>
      projectId === 'p1'
        ? { ok: false, error: { code: 'UNKNOWN', message: 'Falhou.', retryable: true } }
        : {
            ok: true,
            data: [mission('m1', 'p2', 'running'), mission('m2', 'p2', 'waiting_input')],
          },
    );

    render(<OverviewCounters />);

    expect(await screen.findByText('1 executando')).toBeInTheDocument();
    expect(screen.getByText('1 aguarda você')).toBeInTheDocument();
  });

  it('uma chamada que quebra num projeto não zera os contadores dos outros', async () => {
    installApi([project('p1'), project('p2')], (projectId) =>
      projectId === 'p1' ? 'reject' : { ok: true, data: [mission('m1', 'p2', 'running')] },
    );

    render(<OverviewCounters />);

    expect(await screen.findByText('1 executando')).toBeInTheDocument();
    expect(screen.getByText('0 aguarda você')).toBeInTheDocument();
  });

  it('cancela a assinatura quando sai da tela', async () => {
    const { unsubscribe } = installApi([project('p1')], () => ({
      ok: true,
      data: [mission('m1', 'p1', 'running')],
    }));

    const { unmount } = render(<OverviewCounters />);
    expect(await screen.findByText('1 executando')).toBeInTheDocument();
    expect(unsubscribe).not.toHaveBeenCalled();

    unmount();

    expect(unsubscribe).toHaveBeenCalledTimes(1);
  });

  it('põe os dois contadores numa região aria-live="polite", cada um com a sua cor', async () => {
    installApi([project('p1')], () => ({
      ok: true,
      data: [mission('m1', 'p1', 'running'), mission('m2', 'p1', 'planned')],
    }));

    render(<OverviewCounters />);

    const running = await screen.findByText('1 executando');
    expect(running.closest('.overview-counters')).toHaveAttribute('aria-live', 'polite');
    expect(running).toHaveClass('overview-counter', 'overview-counter--lime');
    expect(screen.getByText('1 aguarda você')).toHaveClass(
      'overview-counter',
      'overview-counter--violet',
    );
  });

  it('sem a API do preload, mostra zero e não quebra', () => {
    render(<OverviewCounters />);

    expect(screen.getByText('0 executando')).toBeInTheDocument();
    expect(screen.getByText('0 aguarda você')).toBeInTheDocument();
  });
});

describe('useOverview', () => {
  it('lista em failedProjects o projeto que falhou, e em items só as missões que contam', async () => {
    installApi([project('p1'), project('p2')], (projectId) =>
      projectId === 'p1'
        ? { ok: true, data: [mission('m1', 'p1', 'running'), mission('m2', 'p1', 'draft')] }
        : 'reject',
    );

    const { result } = renderHook(() => useOverview());

    await waitFor(() => expect(result.current.running).toBe(1));
    expect(result.current.failedProjects).toEqual(['p2']);
    expect(result.current.items).toEqual([
      { projectId: 'p1', mission: mission('m1', 'p1', 'running') },
    ]);
  });

  it('se a lista de projetos falha ao recarregar, mantém a última contagem', async () => {
    const { api, emit } = installApi([project('p1')], () => ({
      ok: true,
      data: [mission('m1', 'p1', 'running')],
    }));
    const { result } = renderHook(() => useOverview());
    await waitFor(() => expect(result.current.running).toBe(1));

    api.projects.list.mockResolvedValueOnce({
      ok: false,
      error: { code: 'UNKNOWN', message: 'Falhou.', retryable: true },
    });
    await act(async () => {
      emit('m1');
    });

    expect(api.projects.list).toHaveBeenCalledTimes(2);
    expect(result.current.running).toBe(1);
  });
});
