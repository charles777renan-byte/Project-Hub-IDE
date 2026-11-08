import { act, render, renderHook, screen, waitFor } from '@testing-library/react';
import type {
  AppResult,
  MissionDto,
  MissionEventDto,
  ProjectHubApi,
  ProjectSummary,
  TerminalSummary,
} from '@project-hub/contracts';
import { MemoryRouter } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { OverviewCounters } from '../../src/renderer/components/OverviewCounters';
import { useOverview } from '../../src/renderer/use-overview';

/**
 * Contadores globais da barra de status: "N executando" conta as missões `running`, "N aguarda você"
 * conta as missões que esperam a pessoa (`planned`, `waiting_approval`, `waiting_input` e `review`) e as sessões de terminal
 * em `waiting`, pela regra única de `attention.ts`; e "N falharam" conta as que falharam, de todos os projetos. A API
 * do preload é falsa; cada teste monta os projetos e as missões.
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

/** Os contadores são links para o Início filtrado: precisam de um roteador. */
function renderCounters() {
  return render(<OverviewCounters />, { wrapper: MemoryRouter });
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

    renderCounters();

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

      renderCounters();

      // A missão em execução serve de marca: quando ela aparece, a leitura já chegou.
      expect(await screen.findByText('1 executando')).toBeInTheDocument();
      expect(screen.getByText('1 aguarda você')).toBeInTheDocument();
    },
  );

  it.each(['draft', 'queued', 'paused', 'succeeded', 'failed', 'cancelled'] as const)(
    'a missão em "%s" não entra nos contadores de executando nem de aguarda você',
    async (status) => {
      installApi([project('p1')], () => ({
        ok: true,
        data: [mission('m1', 'p1', status), mission('m2', 'p1', 'running')],
      }));

      renderCounters();

      expect(await screen.findByText('1 executando')).toBeInTheDocument();
      expect(screen.getByText('0 aguarda você')).toBeInTheDocument();
    },
  );

  it('um evento de missão refaz a leitura e atualiza a contagem', async () => {
    let current: MissionDto[] = [mission('m1', 'p1', 'planned')];
    const { api, emit } = installApi([project('p1')], () => ({ ok: true, data: current }));

    renderCounters();
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

    renderCounters();

    expect(await screen.findByText('1 executando')).toBeInTheDocument();
    expect(screen.getByText('1 aguarda você')).toBeInTheDocument();
  });

  it('uma chamada que quebra num projeto não zera os contadores dos outros', async () => {
    installApi([project('p1'), project('p2')], (projectId) =>
      projectId === 'p1' ? 'reject' : { ok: true, data: [mission('m1', 'p2', 'running')] },
    );

    renderCounters();

    expect(await screen.findByText('1 executando')).toBeInTheDocument();
    expect(screen.getByText('0 aguarda você')).toBeInTheDocument();
  });

  it('cancela a assinatura quando sai da tela', async () => {
    const { unsubscribe } = installApi([project('p1')], () => ({
      ok: true,
      data: [mission('m1', 'p1', 'running')],
    }));

    const { unmount } = renderCounters();
    expect(await screen.findByText('1 executando')).toBeInTheDocument();
    expect(unsubscribe).not.toHaveBeenCalled();

    unmount();

    expect(unsubscribe).toHaveBeenCalledTimes(1);
  });

  it('põe os contadores numa região aria-live="polite", cada um com a sua cor', async () => {
    installApi([project('p1')], () => ({
      ok: true,
      data: [mission('m1', 'p1', 'running'), mission('m2', 'p1', 'planned')],
    }));

    renderCounters();

    const running = await screen.findByText('1 executando');
    expect(running.closest('.overview-counters')).toHaveAttribute('aria-live', 'polite');
    // Selos de pílula (Tarefa 6): as classes .chip dão a forma e a cor do estado.
    expect(running).toHaveClass('overview-counter', 'overview-counter--lime', 'chip', 'chip--lime');
    expect(screen.getByText('1 aguarda você')).toHaveClass(
      'overview-counter',
      'overview-counter--warn',
      'chip',
      'chip--warn',
    );
  });

  it('cada contador é um link para o Início filtrado por estado, e o de falhas conta as missões que falharam', async () => {
    installApi([project('p1')], () => ({
      ok: true,
      data: [
        mission('m1', 'p1', 'running'),
        mission('m2', 'p1', 'planned'),
        mission('m3', 'p1', 'failed'),
        mission('m4', 'p1', 'failed'),
      ],
    }));

    renderCounters();

    expect(await screen.findByRole('link', { name: '1 executando' })).toHaveAttribute(
      'href',
      '/?estado=running',
    );
    expect(screen.getByRole('link', { name: '1 aguarda você' })).toHaveAttribute(
      'href',
      '/?estado=attention',
    );
    expect(screen.getByRole('link', { name: '2 falharam' })).toHaveAttribute(
      'href',
      '/?estado=failed',
    );
  });

  it('uma sessão de terminal em espera conta como aguarda você; a que roda não conta', async () => {
    installApi([project('p1')], () => ({ ok: true, data: [mission('m1', 'p1', 'running')] }));
    const session = (id: string, state: TerminalSummary['state']): TerminalSummary => ({
      id,
      kind: 'shell',
      title: `Sessão ${id}`,
      projectId: 'p1',
      projectName: 'Projeto p1',
      state,
      provider: 'shell',
      origin: 'new',
    });
    Object.assign(window.projectHub, {
      terminals: {
        list: vi.fn(() =>
          Promise.resolve({
            ok: true,
            data: [session('t1', 'waiting'), session('t2', 'running')],
          }),
        ),
      },
    });

    renderCounters();

    expect(await screen.findByText('1 aguarda você')).toBeInTheDocument();
    expect(screen.getByText('1 executando')).toBeInTheDocument();
  });

  it('antes da primeira leitura, mostra traço e não zero, que pareceria um dado', () => {
    window.projectHub = {
      ping: vi.fn(),
      projects: { list: vi.fn(() => new Promise<never>(() => {})) },
      missions: { list: vi.fn(), subscribe: vi.fn(() => () => {}) },
    } as unknown as ProjectHubApi;

    renderCounters();

    expect(screen.getByText('— executando')).toBeInTheDocument();
    expect(screen.getByText('— aguarda você')).toBeInTheDocument();
    expect(screen.getByText('— falharam')).toBeInTheDocument();
  });

  it('sem a API do preload, mostra traço e não quebra', () => {
    renderCounters();

    expect(screen.getByText('— executando')).toBeInTheDocument();
    expect(screen.getByText('— aguarda você')).toBeInTheDocument();
  });
});

/**
 * Selo zerado em cinza: o selo cujo número conhecido é 0 leva `data-zero="true"` (a CSS o pinta de cinza neutro);
 * o traço de "ainda não lido" e os selos com número maior que zero não levam. O texto "0 …" continua na tela.
 */
describe('OverviewCounters, selos zerados', () => {
  it('com tudo em zero, os três selos levam data-zero e mostram o "0" como texto', async () => {
    installApi([project('p1')], () => ({ ok: true, data: [] }));

    renderCounters();

    const running = await screen.findByRole('link', { name: '0 executando' });
    expect(running).toHaveAttribute('data-zero', 'true');
    expect(screen.getByRole('link', { name: '0 aguarda você' })).toHaveAttribute(
      'data-zero',
      'true',
    );
    expect(screen.getByRole('link', { name: '0 falharam' })).toHaveAttribute('data-zero', 'true');
  });

  it('com número maior que zero, o selo não leva data-zero, e os outros zerados levam', async () => {
    installApi([project('p1')], () => ({
      ok: true,
      data: [mission('m1', 'p1', 'running'), mission('m2', 'p1', 'running')],
    }));

    renderCounters();

    expect(await screen.findByRole('link', { name: '2 executando' })).not.toHaveAttribute(
      'data-zero',
    );
    expect(screen.getByRole('link', { name: '0 aguarda você' })).toHaveAttribute(
      'data-zero',
      'true',
    );
    expect(screen.getByRole('link', { name: '0 falharam' })).toHaveAttribute('data-zero', 'true');
  });

  it('"aguarda você" e "falharam" com número maior que zero não levam data-zero', async () => {
    installApi([project('p1')], () => ({
      ok: true,
      data: [mission('m1', 'p1', 'planned'), mission('m2', 'p1', 'failed')],
    }));

    renderCounters();

    expect(await screen.findByRole('link', { name: '1 aguarda você' })).not.toHaveAttribute(
      'data-zero',
    );
    expect(screen.getByRole('link', { name: '1 falhou' })).not.toHaveAttribute('data-zero');
    expect(screen.getByRole('link', { name: '0 executando' })).toHaveAttribute('data-zero', 'true');
  });

  it('antes da primeira leitura, o traço não leva data-zero', () => {
    window.projectHub = {
      ping: vi.fn(),
      projects: { list: vi.fn(() => new Promise<never>(() => {})) },
      missions: { list: vi.fn(), subscribe: vi.fn(() => () => {}) },
    } as unknown as ProjectHubApi;

    renderCounters();

    for (const name of ['— executando', '— aguarda você', '— falharam']) {
      expect(screen.getByRole('link', { name })).not.toHaveAttribute('data-zero');
    }
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
    expect(result.current.loaded).toBe(true);
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

    // O evento agora espera 250 ms (carga compartilhada, Tarefa 8a) antes de recarregar.
    await waitFor(() => expect(api.projects.list).toHaveBeenCalledTimes(2));
    expect(result.current.running).toBe(1);
  });
});
