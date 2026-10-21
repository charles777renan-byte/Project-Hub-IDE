import { act, render, renderHook, screen } from '@testing-library/react';
import type {
  AppResult,
  ApprovalDto,
  MissionDto,
  MissionEventDto,
  MissionViewDto,
  ProjectHubApi,
  ProjectSummary,
} from '@project-hub/contracts';
import { StrictMode, type ReactNode } from 'react';
import { MemoryRouter, useNavigate } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { OverviewCounters } from '../../src/renderer/components/OverviewCounters';
import { Sidebar } from '../../src/renderer/components/Sidebar';
import { getOverviewState, subscribeOverview } from '../../src/renderer/overview-data';
import { PROJECTS_CHANGED_EVENT } from '../../src/renderer/projects-events';
import { useOverview } from '../../src/renderer/use-overview';
import { useSidebarData } from '../../src/renderer/use-sidebar-data';

/*
 * Carga compartilhada (Tarefa 8a): a barra lateral, os contadores e o Início leem a mesma carga.
 * Uma só chamada de projetos, uma só assinatura de eventos e um só agrupamento de eventos.
 */

const DEBOUNCE_MS = 250;

function Router({ children }: { children: ReactNode }) {
  return <MemoryRouter>{children}</MemoryRouter>;
}

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

function mission(id: string, projectId: string, status: MissionDto['status']): MissionDto {
  return {
    id,
    projectId,
    title: `Missão ${id}`,
    objective: 'Objetivo',
    status,
    altersCode: false,
    acceptanceCriteria: [{ id: `${id}-c1`, position: 1, text: 'Critério' }],
    createdAt: '2026-10-20T09:00:00.000Z',
    updatedAt: '2026-10-20T09:00:00.000Z',
  };
}

function approval(id: string, missionId: string): ApprovalDto {
  return {
    id,
    missionId,
    executionId: 'e1',
    actionType: 'shell',
    title: `Aprovação ${id}`,
    rationale: 'Motivo',
    affectedResources: [],
    status: 'pending',
    requestedAt: '2026-10-20T09:00:00.000Z',
  };
}

type Setup = {
  projects?: ProjectSummary[];
  missions?: Record<string, MissionDto[] | 'error' | 'reject'>;
  approvals?: Record<string, ApprovalDto[]>;
};

function installApi(setup: Setup = {}) {
  const state = {
    projects: setup.projects ?? [project('p1')],
    missions: setup.missions ?? {},
    approvals: setup.approvals ?? {},
  };
  const listeners: Array<(event: MissionEventDto) => void> = [];
  const unsubscribe = vi.fn();
  const api = {
    projects: {
      list: vi.fn(() =>
        Promise.resolve<AppResult<ProjectSummary[]>>({ ok: true, data: state.projects }),
      ),
    },
    missions: {
      list: vi.fn((projectId: string) => {
        const entry = state.missions[projectId] ?? [];
        if (entry === 'reject') return Promise.reject(new Error('falha de IPC'));
        if (entry === 'error') {
          return Promise.resolve({
            ok: false,
            error: { code: 'UNKNOWN', message: 'Falhou.', retryable: true },
          });
        }
        return Promise.resolve({ ok: true, data: entry });
      }),
      get: vi.fn((missionId: string): Promise<unknown> =>
        Promise.resolve({
          ok: true,
          data: {
            pendingApprovals: state.approvals[missionId] ?? [],
          } as unknown as MissionViewDto,
        }),
      ),
      subscribe: vi.fn((listener: (event: MissionEventDto) => void) => {
        listeners.push(listener);
        return unsubscribe;
      }),
    },
  };
  window.projectHub = api as unknown as ProjectHubApi;
  return {
    api,
    state,
    unsubscribe,
    emit() {
      for (const listener of listeners) listener({} as MissionEventDto);
    },
  };
}

/** Deixa as promessas pendentes terminarem, sem avançar o relógio. */
async function flush() {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(0);
  });
}

async function advance(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  Reflect.deleteProperty(window, 'projectHub');
});

describe('carga compartilhada', () => {
  it('com a barra e os contadores montados, carrega e assina uma vez só', async () => {
    const { api } = installApi({ missions: { p1: [mission('m1', 'p1', 'running')] } });

    render(
      <MemoryRouter>
        <Sidebar />
        <OverviewCounters />
      </MemoryRouter>,
    );
    await flush();

    expect(screen.getByText('1 executando')).toBeInTheDocument();
    expect(api.projects.list).toHaveBeenCalledTimes(1);
    expect(api.missions.list).toHaveBeenCalledTimes(1);
    expect(api.missions.subscribe).toHaveBeenCalledTimes(1);
  });

  it('cinco eventos seguidos viram uma recarga só, depois de 250 ms', async () => {
    const { api, emit } = installApi();
    renderHook(() => useOverview());
    await flush();
    expect(api.projects.list).toHaveBeenCalledTimes(1);

    for (let i = 0; i < 5; i += 1) {
      emit();
      await advance(DEBOUNCE_MS - 50);
    }
    // Cada evento reinicia o atraso: até aqui nada recarregou.
    expect(api.projects.list).toHaveBeenCalledTimes(1);

    await advance(DEBOUNCE_MS);
    expect(api.projects.list).toHaveBeenCalledTimes(2);
  });

  it('o cadastro de um projeto também entra no agrupamento', async () => {
    const { api, emit } = installApi();
    renderHook(() => useOverview());
    await flush();

    emit();
    act(() => {
      window.dispatchEvent(new Event(PROJECTS_CHANGED_EVENT));
    });
    await advance(DEBOUNCE_MS);

    expect(api.projects.list).toHaveBeenCalledTimes(2);
  });

  it('um evento não cancela a carga em curso, e a mais nova é a que aparece', async () => {
    const replies: Array<(data: ProjectSummary[]) => void> = [];
    const { api, emit } = installApi();
    api.projects.list.mockImplementation(
      () =>
        new Promise((resolve) => {
          replies.push((data) => resolve({ ok: true, data }));
        }),
    );
    const { result } = renderHook(() => useSidebarData(), { wrapper: Router });
    await flush();
    expect(replies).toHaveLength(1);

    emit();
    await advance(DEBOUNCE_MS);
    expect(replies).toHaveLength(2);

    // A carga em curso (a primeira) ainda vale, enquanto a nova não chega.
    await act(async () => replies[0]!([project('p1')]));
    expect(result.current.projects.map((p) => p.id)).toEqual(['p1']);

    // A mais nova aparece; a antiga, atrasada, não a desfaz.
    await act(async () => replies[1]!([project('p1'), project('p2')]));
    expect(result.current.projects.map((p) => p.id)).toEqual(['p1', 'p2']);
  });

  it('a carga antiga que responde depois da nova não a substitui', async () => {
    const replies: Array<(data: ProjectSummary[]) => void> = [];
    const { api, emit } = installApi();
    api.projects.list.mockImplementation(
      () =>
        new Promise((resolve) => {
          replies.push((data) => resolve({ ok: true, data }));
        }),
    );
    const { result } = renderHook(() => useSidebarData(), { wrapper: Router });
    await flush();
    emit();
    await advance(DEBOUNCE_MS);

    await act(async () => replies[1]!([project('p1'), project('p2')]));
    await act(async () => replies[0]!([project('p1')]));

    expect(result.current.projects.map((p) => p.id)).toEqual(['p1', 'p2']);
  });

  it('failed traz as missões que falharam, com o projectId', async () => {
    installApi({
      projects: [project('p1'), project('p2')],
      missions: {
        p1: [mission('m1', 'p1', 'failed'), mission('m2', 'p1', 'running')],
        p2: [mission('m3', 'p2', 'failed')],
      },
    });
    const { result } = renderHook(() => useOverview());
    await flush();

    expect(result.current.failed).toEqual([
      { projectId: 'p1', mission: mission('m1', 'p1', 'failed') },
      { projectId: 'p2', mission: mission('m3', 'p2', 'failed') },
    ]);
  });

  it('approvals traz as pendentes só das missões em waiting_approval', async () => {
    const { api } = installApi({
      missions: {
        p1: [
          mission('m1', 'p1', 'waiting_approval'),
          mission('m2', 'p1', 'running'),
          mission('m3', 'p1', 'waiting_input'),
        ],
      },
      approvals: { m1: [approval('a1', 'm1'), approval('a2', 'm1')] },
    });
    const { result } = renderHook(() => useOverview());
    await flush();

    expect(api.missions.get).toHaveBeenCalledTimes(1);
    expect(api.missions.get).toHaveBeenCalledWith('m1');
    expect(result.current.approvals).toEqual([
      {
        projectId: 'p1',
        missionId: 'm1',
        missionTitle: 'Missão m1',
        approval: approval('a1', 'm1'),
      },
      {
        projectId: 'p1',
        missionId: 'm1',
        missionTitle: 'Missão m1',
        approval: approval('a2', 'm1'),
      },
    ]);
  });

  it('missions.get que falha não derruba a carga nem as contagens', async () => {
    const { api } = installApi({ missions: { p1: [mission('m1', 'p1', 'waiting_approval')] } });
    api.missions.get.mockRejectedValue(new Error('quebrou'));
    const { result } = renderHook(() => useOverview());
    await flush();

    expect(result.current.loaded).toBe(true);
    expect(result.current.waiting).toBe(1);
    expect(result.current.approvals).toEqual([]);
    expect(result.current.unreadApprovals).toEqual([
      { projectId: 'p1', missionId: 'm1', missionTitle: 'Missão m1' },
    ]);
    expect(result.current.approvalsLoaded).toBe(true);
  });

  it('missions.get com erro numa missão marca só ela como não lida; as outras entram', async () => {
    const { api } = installApi({
      missions: {
        p1: [mission('m1', 'p1', 'waiting_approval'), mission('m2', 'p1', 'waiting_approval')],
      },
      approvals: { m2: [approval('a2', 'm2')] },
    });
    api.missions.get.mockImplementation((missionId: string) =>
      Promise.resolve(
        missionId === 'm1'
          ? { ok: false, error: { code: 'UNKNOWN', message: 'Falhou.', retryable: true } }
          : { ok: true, data: { pendingApprovals: [approval('a2', 'm2')] } },
      ),
    );
    const { result } = renderHook(() => useOverview());
    await flush();

    expect(result.current.unreadApprovals.map((u) => u.missionId)).toEqual(['m1']);
    expect(result.current.approvals.map((a) => a.missionId)).toEqual(['m2']);
  });

  it('fase 1 publica a barra e a contagem sem esperar missions.get; a fase 2 traz as aprovações', async () => {
    const { api } = installApi({ missions: { p1: [mission('m1', 'p1', 'waiting_approval')] } });
    let resolveGet: (value: unknown) => void = () => undefined;
    api.missions.get.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveGet = resolve;
        }),
    );
    const overview = renderHook(() => useOverview());
    const sidebar = renderHook(() => useSidebarData(), { wrapper: Router });
    await flush();

    expect(sidebar.result.current.status).toBe('ready');
    expect(overview.result.current.loaded).toBe(true);
    expect(overview.result.current.waiting).toBe(1);
    expect(overview.result.current.approvals).toEqual([]);
    expect(overview.result.current.approvalsLoaded).toBe(false);

    await act(async () =>
      resolveGet({ ok: true, data: { pendingApprovals: [approval('a1', 'm1')] } }),
    );

    expect(overview.result.current.approvals.map((a) => a.approval.id)).toEqual(['a1']);
    expect(overview.result.current.approvalsLoaded).toBe(true);
  });

  it('uma recarga mostra a barra e a contagem, e mantém as aprovações da carga anterior até a fase 2 chegar', async () => {
    const { api, emit } = installApi({
      missions: { p1: [mission('m1', 'p1', 'waiting_approval')] },
      approvals: { m1: [approval('a1', 'm1')] },
    });
    const { result } = renderHook(() => useOverview());
    await flush();
    expect(result.current.approvals.map((a) => a.approval.id)).toEqual(['a1']);
    expect(result.current.approvalsLoaded).toBe(true);

    // A leitura de aprovação da próxima recarga não termina.
    api.missions.get.mockImplementationOnce(() => new Promise(() => {}));
    emit();
    await advance(DEBOUNCE_MS);
    await flush();

    expect(result.current.waiting).toBe(1);
    expect(result.current.approvals.map((a) => a.approval.id)).toEqual(['a1']);
    expect(result.current.approvalsLoaded).toBe(false);
  });

  it('uma carga que falha não invalida a fase 2 de uma carga boa anterior', async () => {
    const { api, emit } = installApi({
      missions: { p1: [mission('m1', 'p1', 'waiting_approval')] },
    });
    let resolveGet: (value: unknown) => void = () => undefined;
    api.missions.get.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveGet = resolve;
        }),
    );
    const { result } = renderHook(() => useOverview());
    await flush();
    expect(result.current.approvalsLoaded).toBe(false);

    // A carga seguinte falha ao listar os projetos; a fase 2 da anterior ainda está em voo.
    api.projects.list.mockResolvedValueOnce({
      ok: false,
      error: { code: 'UNKNOWN', message: 'Falhou.', retryable: true },
    });
    emit();
    await advance(DEBOUNCE_MS);
    await flush();

    await act(async () =>
      resolveGet({ ok: true, data: { pendingApprovals: [approval('a1', 'm1')] } }),
    );
    expect(result.current.approvals.map((a) => a.approval.id)).toEqual(['a1']);
    expect(result.current.approvalsLoaded).toBe(true);
  });

  it('sem nenhuma missão em waiting_approval, não há leitura de aprovação e approvalsLoaded vira verdadeiro', async () => {
    const { api } = installApi({ missions: { p1: [mission('m1', 'p1', 'running')] } });
    const { result } = renderHook(() => useOverview());
    await flush();

    expect(api.missions.get).not.toHaveBeenCalled();
    expect(result.current.approvals).toEqual([]);
    expect(result.current.approvalsLoaded).toBe(true);
  });

  it('a fase 2 de uma carga velha não sobrescreve a carga mais nova', async () => {
    const { api, emit } = installApi({
      missions: { p1: [mission('m1', 'p1', 'waiting_approval')] },
    });
    const gets: Array<(value: unknown) => void> = [];
    api.missions.get.mockImplementation(
      () =>
        new Promise((resolve) => {
          gets.push(resolve);
        }),
    );
    const { result } = renderHook(() => useOverview());
    await flush();
    emit();
    await advance(DEBOUNCE_MS);
    expect(gets).toHaveLength(2);

    const reply = (id: string) => ({ ok: true, data: { pendingApprovals: [approval(id, 'm1')] } });
    // A carga nova termina primeiro; a velha, atrasada, não a desfaz.
    await act(async () => gets[1]!(reply('nova')));
    await act(async () => gets[0]!(reply('velha')));

    expect(result.current.approvals.map((a) => a.approval.id)).toEqual(['nova']);
  });

  it('a fase 2 de uma carga velha que termina depois da nova ser exibida não vale depois dela', async () => {
    const { api, emit } = installApi({
      missions: { p1: [mission('m1', 'p1', 'waiting_approval')] },
    });
    const gets: Array<(value: unknown) => void> = [];
    api.missions.get.mockImplementation(
      () =>
        new Promise((resolve) => {
          gets.push(resolve);
        }),
    );
    const { result } = renderHook(() => useOverview());
    await flush();
    emit();
    await advance(DEBOUNCE_MS);

    const reply = (id: string) => ({ ok: true, data: { pendingApprovals: [approval(id, 'm1')] } });
    // A velha resolve com a nova já exibida (fase 1) e ainda sem aprovações: não pode publicar.
    await act(async () => gets[0]!(reply('velha')));
    expect(result.current.approvals).toEqual([]);
    expect(result.current.approvalsLoaded).toBe(false);
    await act(async () => gets[1]!(reply('nova')));
    expect(result.current.approvals.map((a) => a.approval.id)).toEqual(['nova']);
  });

  it('a falha de um projeto não zera os outros, mas a barra mostra a mensagem geral', async () => {
    installApi({
      projects: [project('p1'), project('p2')],
      missions: { p1: 'error', p2: [mission('m1', 'p2', 'running')] },
    });
    const overview = renderHook(() => useOverview());
    const sidebar = renderHook(() => useSidebarData(), { wrapper: Router });
    await flush();

    expect(overview.result.current.running).toBe(1);
    expect(overview.result.current.failedProjects).toEqual(['p1']);
    expect(sidebar.result.current.status).toBe('error');
    expect(sidebar.result.current.message).toBe(
      'Não foi possível carregar os projetos. Tente de novo.',
    );
  });

  it('ao desmontar o último consumidor cancela a assinatura; ao montar de novo, assina outra vez', async () => {
    const { api, unsubscribe } = installApi();
    const first = renderHook(() => useOverview());
    const second = renderHook(() => useSidebarData(), { wrapper: Router });
    await flush();

    first.unmount();
    expect(unsubscribe).not.toHaveBeenCalled();
    second.unmount();
    expect(unsubscribe).toHaveBeenCalledTimes(1);

    renderHook(() => useOverview());
    await flush();
    expect(api.missions.subscribe).toHaveBeenCalledTimes(2);
  });

  it('depois do último consumidor sair, PROJECTS_CHANGED_EVENT não recarrega mais', async () => {
    const { api } = installApi();
    const { unmount } = renderHook(() => useOverview());
    await flush();
    expect(api.projects.list).toHaveBeenCalledTimes(1);

    unmount();
    act(() => {
      window.dispatchEvent(new Event(PROJECTS_CHANGED_EVENT));
    });
    await advance(DEBOUNCE_MS * 2);

    expect(api.projects.list).toHaveBeenCalledTimes(1);
  });

  it('começar, parar e começar de novo (o ciclo do StrictMode) refaz a assinatura e a carga', async () => {
    const { api, unsubscribe } = installApi({
      missions: { p1: [mission('m1', 'p1', 'running')] },
    });
    const first = subscribeOverview(() => undefined);
    await flush();
    first();

    const second = subscribeOverview(() => undefined);
    await flush();

    expect(api.missions.subscribe).toHaveBeenCalledTimes(2);
    expect(unsubscribe).toHaveBeenCalledTimes(1);
    expect(getOverviewState().overview.loaded).toBe(true);
    expect(getOverviewState().overview.running).toBe(1);
    second();
  });

  it('em StrictMode (start, stop, start) fica uma assinatura ativa e a carga aparece', async () => {
    const { api, unsubscribe } = installApi({
      missions: { p1: [mission('m1', 'p1', 'running')] },
    });
    const { result } = renderHook(() => useOverview(), {
      wrapper: ({ children }: { children: ReactNode }) => <StrictMode>{children}</StrictMode>,
    });
    await flush();

    expect(api.missions.subscribe.mock.calls.length - unsubscribe.mock.calls.length).toBe(1);
    expect(result.current.loaded).toBe(true);
    expect(result.current.running).toBe(1);
  });

  it('duas trocas de rota dentro de 250 ms geram uma carga só', async () => {
    const { api } = installApi();
    const { result } = renderHook(() => ({ data: useSidebarData(), navigate: useNavigate() }), {
      wrapper: Router,
    });
    await flush();
    expect(api.projects.list).toHaveBeenCalledTimes(1);

    act(() => result.current.navigate('/a'));
    await advance(100);
    act(() => result.current.navigate('/b'));
    expect(api.projects.list).toHaveBeenCalledTimes(1);
    await advance(DEBOUNCE_MS);

    expect(api.projects.list).toHaveBeenCalledTimes(2);
  });

  it('não aplica carga que termina depois da desmontagem', async () => {
    const { api } = installApi();
    const replies: Array<() => void> = [];
    api.projects.list.mockImplementation(
      () =>
        new Promise((resolve) => {
          replies.push(() => resolve({ ok: true, data: [project('p1')] }));
        }),
    );
    const { unmount } = renderHook(() => useOverview());
    await flush();
    unmount();
    const fresh = renderHook(() => useOverview());
    await flush();
    // Só a primeira carga (da montagem desfeita) responde; a nova segue pendente.
    await act(async () => replies[0]?.());

    expect(fresh.result.current.loaded).toBe(false);
  });

  it('sem o preload, nada quebra e loaded continua falso', async () => {
    const { result } = renderHook(() => useOverview());
    await flush();
    await advance(DEBOUNCE_MS);

    expect(result.current.loaded).toBe(false);
    expect(result.current.failed).toEqual([]);
    expect(result.current.approvals).toEqual([]);
  });
});
