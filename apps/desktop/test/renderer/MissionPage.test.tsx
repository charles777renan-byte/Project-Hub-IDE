import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type {
  AppResult,
  MissionEventDto,
  MissionViewDto,
  ProjectHubApi,
} from '@project-hub/contracts';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter, Route, Routes } from 'react-router';
import { MissionPage } from '../../src/renderer/pages/MissionPage';
import { ROUTE_PATHS } from '../../src/renderer/routes';

const OK = { ok: true as const, data: undefined };

function viewOf(
  overrides: Partial<MissionViewDto['mission']> = {},
  rest: Partial<MissionViewDto> = {},
): MissionViewDto {
  return {
    mission: {
      id: 'm1',
      projectId: 'p1',
      title: 'Ajustar login',
      objective: 'Corrigir o login',
      status: 'planned',
      altersCode: false,
      acceptanceCriteria: [{ id: 'c1', position: 1, text: 'Login funciona' }],
      createdAt: '2026-10-20T09:00:00.000Z',
      updatedAt: '2026-10-20T09:00:00.000Z',
      ...overrides,
    },
    project: { id: 'p1', name: 'app', path: 'C:\\app', defaultBranch: 'main' },
    steps: [{ id: 's1', position: 1, title: 'Login funciona', status: 'pending' }],
    executions: [],
    pendingApprovals: [],
    events: [],
    ...rest,
  };
}

type Listener = (event: MissionEventDto) => void;

/** Instala a API do preload. `get` devolve a visão atual; cada teste troca a visão quando quer. */
function installApi(initial: MissionViewDto) {
  let current = initial;
  let listener: Listener | undefined;
  const api = {
    missions: {
      get: vi.fn(() => Promise.resolve<AppResult<MissionViewDto>>({ ok: true, data: current })),
      approvePlan: vi.fn(() => Promise.resolve(OK)),
      plan: vi.fn(() => Promise.resolve({ ok: true, data: { missionId: 'm1', steps: [] } })),
      start: vi.fn(() => Promise.resolve({ ok: true, data: { id: 'e1' } })),
      cancel: vi.fn(() => Promise.resolve(OK)),
      pause: vi.fn(() => Promise.resolve(OK)),
      resume: vi.fn(() => Promise.resolve(OK)),
      retry: vi.fn(() => Promise.resolve({ ok: true, data: { id: 'e2', attempt: 2 } })),
      provideInput: vi.fn(() => Promise.resolve(OK)),
      subscribe: vi.fn((next: Listener) => {
        listener = next;
        return () => {
          listener = undefined;
        };
      }),
    },
    approvals: { decide: vi.fn(() => Promise.resolve(OK)) },
  };
  window.projectHub = api as unknown as ProjectHubApi;
  return {
    api,
    setView(next: MissionViewDto) {
      current = next;
    },
    emit(event: Partial<MissionEventDto>) {
      listener?.({
        id: 'ev',
        missionId: 'm1',
        aggregateType: 'mission',
        aggregateId: 'm1',
        eventType: 'mission.status_changed',
        severity: 'info',
        actor: 'user',
        payload: {},
        sequence: 1,
        createdAt: '2026-10-20T09:00:00.000Z',
        ...event,
      });
    },
  };
}

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/projects/p1/missions/m1']}>
      <Routes>
        <Route path={ROUTE_PATHS.missionDetail} element={<MissionPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

afterEach(() => {
  Reflect.deleteProperty(window, 'projectHub');
});

describe('MissionPage: cabeçalho e abas', () => {
  it('mostra o título, a situação em linguagem clara e o projeto, branch e worktree', async () => {
    installApi(viewOf());
    renderPage();

    expect(
      await screen.findByRole('heading', { level: 1, name: 'Ajustar login' }),
    ).toBeInTheDocument();
    expect(screen.getByText('Aguarda aprovação do plano')).toBeInTheDocument();
    expect(screen.getByText(/branch main · worktree ainda não criado/)).toBeInTheDocument();
  });

  it('não oferece pausar; cancelar sai de missão encerrada', async () => {
    installApi(viewOf({ status: 'succeeded' }));
    renderPage();

    await screen.findByRole('heading', { level: 1, name: 'Ajustar login' });
    expect(screen.queryByRole('button', { name: 'Pausar' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Cancelar missão' })).not.toBeInTheDocument();
  });

  it('abas sem conteúdo nesta etapa dizem que ficam para a próxima', async () => {
    installApi(viewOf());
    renderPage();

    await userEvent.click(await screen.findByRole('tab', { name: 'Terminal' }));

    expect(screen.getByText('Disponível na próxima etapa.')).toBeInTheDocument();
  });
});

describe('MissionPage: plano', () => {
  it('com o plano pronto, aprova o plano e busca a visão de novo', async () => {
    const hub = installApi(viewOf());
    renderPage();
    const decision = await screen.findByRole('region', { name: 'Aprovar plano?' });

    await userEvent.click(within(decision).getByRole('button', { name: 'Aprovar plano' }));

    await waitFor(() => expect(hub.api.missions.approvePlan).toHaveBeenCalledWith('m1'));
    expect(hub.api.missions.get.mock.calls.length).toBeGreaterThanOrEqual(2);
  });

  it('pedir novo plano chama o planejamento de novo, na mesma missão', async () => {
    const hub = installApi(viewOf());
    renderPage();
    const decision = await screen.findByRole('region', { name: 'Aprovar plano?' });

    await userEvent.click(within(decision).getByRole('button', { name: 'Pedir novo plano' }));

    await waitFor(() => expect(hub.api.missions.plan).toHaveBeenCalledWith('m1'));
    expect(hub.api.missions.approvePlan).not.toHaveBeenCalled();
  });

  it('depois de aprovado, inicia a missão', async () => {
    const hub = installApi(viewOf({ status: 'queued' }));
    renderPage();

    await userEvent.click(await screen.findByRole('button', { name: 'Iniciar missão' }));

    await waitFor(() => expect(hub.api.missions.start).toHaveBeenCalledWith('m1'));
  });

  it('uma falha da API aparece como alerta, sem derrubar a tela', async () => {
    const hub = installApi(viewOf());
    hub.api.missions.approvePlan.mockResolvedValueOnce({
      ok: false,
      error: {
        code: 'MISSION_INVALID_STATE',
        message: 'Só um plano gerado pode ser aprovado.',
        retryable: false,
      },
    } as unknown as typeof OK);
    renderPage();
    const decision = await screen.findByRole('region', { name: 'Aprovar plano?' });

    await userEvent.click(within(decision).getByRole('button', { name: 'Aprovar plano' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Só um plano gerado pode ser aprovado.',
    );
  });
});

describe('MissionPage: conversa', () => {
  const approval = {
    id: 'ap1',
    missionId: 'm1',
    executionId: 'e1',
    actionType: 'write_outside_worktree' as const,
    title: 'Gravar arquivo',
    rationale: 'O roteiro pediu.',
    affectedResources: ['C:\\app\\x.md'],
    status: 'pending' as const,
    requestedAt: '2026-10-20T09:00:00.000Z',
  };

  it('mostra o cartão de aprovação pendente e envia a decisão da pessoa', async () => {
    const hub = installApi(
      viewOf({ status: 'waiting_approval' }, { pendingApprovals: [approval] }),
    );
    renderPage();

    await userEvent.click(await screen.findByRole('tab', { name: 'Conversa' }));
    const card = screen.getByRole('region', { name: 'Gravar arquivo' });
    await userEvent.click(within(card).getByRole('button', { name: 'Aprovar' }));

    await waitFor(() =>
      expect(hub.api.approvals.decide).toHaveBeenCalledWith({
        approvalId: 'ap1',
        decision: 'approved',
      }),
    );
  });

  it('com o agente pedindo resposta, mostra a caixa e envia o texto', async () => {
    const hub = installApi(
      viewOf(
        { status: 'waiting_input' },
        {
          events: [
            {
              id: 'ev1',
              missionId: 'm1',
              aggregateType: 'execution',
              aggregateId: 'e1',
              eventType: 'input.requested',
              severity: 'info',
              actor: 'agent',
              payload: { request: { id: 'entrada', prompt: 'Qual o nome do arquivo?' } },
              sequence: 1,
              createdAt: '2026-10-20T09:00:00.000Z',
            },
          ],
        },
      ),
    );
    renderPage();

    await userEvent.click(await screen.findByRole('tab', { name: 'Conversa' }));
    const answer = screen.getByLabelText('Qual o nome do arquivo?');
    await userEvent.type(answer, 'notas.md');
    await userEvent.click(screen.getByRole('button', { name: 'Enviar resposta' }));

    await waitFor(() =>
      expect(hub.api.missions.provideInput).toHaveBeenCalledWith({
        missionId: 'm1',
        text: 'notas.md',
      }),
    );
  });

  it('um evento da missão faz a visão ser buscada de novo', async () => {
    const hub = installApi(viewOf());
    renderPage();
    await screen.findByRole('heading', { level: 1, name: 'Ajustar login' });
    const before = hub.api.missions.get.mock.calls.length;

    hub.setView(viewOf({ status: 'queued' }));
    hub.emit({ eventType: 'mission.status_changed', payload: { from: 'planned', to: 'queued' } });

    await waitFor(() => expect(hub.api.missions.get.mock.calls.length).toBeGreaterThan(before));
    expect(await screen.findByRole('button', { name: 'Iniciar missão' })).toBeInTheDocument();
  });

  it('evento de outra missão não recarrega esta', async () => {
    const hub = installApi(viewOf());
    renderPage();
    await screen.findByRole('heading', { level: 1, name: 'Ajustar login' });
    const before = hub.api.missions.get.mock.calls.length;

    hub.emit({ missionId: 'outra' });

    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(hub.api.missions.get.mock.calls.length).toBe(before);
  });
});

describe('MissionPage: pausa, retomada e nova tentativa (R180, R181)', () => {
  it('com a missão em execução, Pausar chama pause e busca a visão de novo', async () => {
    const hub = installApi(viewOf({ status: 'running' }));
    renderPage();

    await userEvent.click(await screen.findByRole('button', { name: 'Pausar' }));

    await waitFor(() => expect(hub.api.missions.pause).toHaveBeenCalledWith('m1'));
    expect(hub.api.missions.get.mock.calls.length).toBeGreaterThanOrEqual(2);
  });

  it('com a missão pausada, mostra Retomar sem Pausar, e Cancelar continua disponível', async () => {
    const hub = installApi(viewOf({ status: 'paused' }));
    renderPage();

    await userEvent.click(await screen.findByRole('button', { name: 'Retomar' }));

    expect(screen.queryByRole('button', { name: 'Pausar' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Cancelar missão' })).toBeInTheDocument();
    await waitFor(() => expect(hub.api.missions.resume).toHaveBeenCalledWith('m1'));
  });

  it.each(['failed', 'cancelled'] as const)(
    'missão %s oferece Tentar de novo, que chama retry',
    async (status) => {
      const hub = installApi(viewOf({ status }));
      renderPage();

      await userEvent.click(await screen.findByRole('button', { name: 'Tentar de novo' }));

      await waitFor(() => expect(hub.api.missions.retry).toHaveBeenCalledWith('m1'));
    },
  );

  it('missão concluída não oferece Tentar de novo', async () => {
    installApi(viewOf({ status: 'succeeded' }));
    renderPage();

    await screen.findByRole('heading', { level: 1, name: 'Ajustar login' });
    expect(screen.queryByRole('button', { name: 'Tentar de novo' })).not.toBeInTheDocument();
  });
});

describe('MissionPage: aba da decisão (R182)', () => {
  it('com a missão aguardando sua aprovação, abre na Conversa e mostra o aviso', async () => {
    installApi(viewOf({ status: 'waiting_approval' }));
    renderPage();

    expect(await screen.findByRole('tab', { name: 'Conversa' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    expect(screen.getByText('Aguarda sua decisão')).toBeInTheDocument();
  });

  it('com o agente aguardando resposta, abre na Conversa', async () => {
    installApi(viewOf({ status: 'waiting_input' }));
    renderPage();

    expect(await screen.findByRole('tab', { name: 'Conversa' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
  });

  it('sem decisão pendente, abre no Plano e não mostra o aviso', async () => {
    installApi(viewOf({ status: 'running' }));
    renderPage();

    expect(await screen.findByRole('tab', { name: 'Plano' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    expect(screen.queryByText('Aguarda sua decisão')).not.toBeInTheDocument();
  });

  it('o aviso leva de volta à Conversa', async () => {
    installApi(viewOf({ status: 'waiting_approval' }));
    renderPage();
    await userEvent.click(await screen.findByRole('tab', { name: 'Plano' }));

    await userEvent.click(screen.getByRole('button', { name: 'Ver na conversa' }));

    expect(screen.getByRole('tab', { name: 'Conversa' })).toHaveAttribute('aria-selected', 'true');
  });

  it('a resposta não enviada continua na caixa quando a pessoa troca de aba', async () => {
    installApi(
      viewOf(
        { status: 'waiting_input' },
        {
          events: [
            {
              id: 'ev1',
              missionId: 'm1',
              aggregateType: 'execution',
              aggregateId: 'e1',
              eventType: 'input.requested',
              severity: 'info',
              actor: 'agent',
              payload: { request: { id: 'entrada', prompt: 'Qual o nome do arquivo?' } },
              sequence: 1,
              createdAt: '2026-10-20T09:00:00.000Z',
            },
          ],
        },
      ),
    );
    renderPage();
    const answer = await screen.findByLabelText('Qual o nome do arquivo?');
    await userEvent.type(answer, 'notas');

    await userEvent.click(screen.getByRole('tab', { name: 'Plano' }));
    await userEvent.click(screen.getByRole('tab', { name: 'Conversa' }));

    expect(screen.getByLabelText('Qual o nome do arquivo?')).toHaveValue('notas');
  });
});
