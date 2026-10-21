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
import { readCss, ruleDeclarations } from './css-rules';

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
      diff: vi.fn(() => Promise.resolve({ ok: true, data: { files: [], truncatedFiles: false } })),
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

describe('MissionPage: cabeçalho', () => {
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
});

const PANEL_TITLES = ['Conversa', 'Plano', 'Diff', 'Testes', 'Terminal', 'Logs do sistema'];

describe('MissionPage: grade de painéis', () => {
  it('mostra os seis painéis com os títulos, todos na grade, e nenhuma aba', async () => {
    installApi(viewOf());
    renderPage();

    for (const title of PANEL_TITLES) {
      const panel = await screen.findByRole('region', { name: title });
      expect(screen.getByRole('heading', { level: 2, name: title })).toBeInTheDocument();
      expect(panel.parentElement).toHaveClass('mission-grid');
    }
    expect(screen.queryByRole('tab')).toBeNull();
  });

  it('com a missão em rascunho, Diff, Testes e Terminal dizem que ainda não há worktree', async () => {
    installApi(viewOf({ status: 'draft' }));
    renderPage();

    for (const title of ['Diff', 'Testes', 'Terminal']) {
      const panel = await screen.findByRole('region', { name: title });
      expect(within(panel).getByText(/A missão ainda não tem worktree/)).toBeInTheDocument();
    }
  });

  it('com worktree, cada painel de tarefa futura diz em qual tarefa chega', async () => {
    installApi(viewOf({ status: 'running', worktreePath: 'C:\\app\\.worktrees\\m1' }));
    renderPage();

    expect(
      within(await screen.findByRole('region', { name: 'Diff' })).getByText(
        'A missão ainda não alterou arquivos.',
      ),
    ).toBeInTheDocument();
    expect(
      within(screen.getByRole('region', { name: 'Testes' })).getByText('Chega com a Tarefa 12.'),
    ).toBeInTheDocument();
    expect(
      within(screen.getByRole('region', { name: 'Terminal' })).getByText('Chega com a Tarefa 13.'),
    ).toBeInTheDocument();
  });

  it('com 300 eventos, a lista fica no corpo do painel de logs, que rola sozinho', async () => {
    const events = Array.from({ length: 300 }, (_, index) => ({
      id: `e${index}`,
      missionId: 'm1',
      aggregateType: 'execution' as const,
      aggregateId: 'e1',
      eventType: 'message.delta',
      severity: 'info' as const,
      actor: 'agent' as const,
      payload: { content: `linha ${index}` },
      sequence: index + 1,
      createdAt: new Date(Date.UTC(2026, 9, 20, 9, 0, index)).toISOString(),
    }));
    installApi(viewOf({ status: 'running' }, { events }));
    renderPage();

    const logs = await screen.findByRole('region', { name: 'Logs do sistema' });
    const list = within(logs).getByRole('list', { name: 'Eventos do sistema' });
    expect(within(list).getAllByRole('listitem')).toHaveLength(300);
    expect(logs.querySelector('.panel__body')).toContainElement(list);
    expect(ruleDeclarations(readCss('app.css'), '.panel__body').get('overflow')).toBe('auto');
  });

  it('um evento com markup aparece como texto na Conversa e nos Logs, sem elemento img', async () => {
    installApi(
      viewOf(
        { status: 'running' },
        {
          events: [
            {
              id: 'ev1',
              missionId: 'm1',
              aggregateType: 'execution',
              aggregateId: 'e1',
              eventType: 'message.delta',
              severity: 'info',
              actor: 'agent',
              payload: { content: '<img src=x onerror=alert(1)>' },
              sequence: 1,
              createdAt: '2026-10-20T09:00:00.000Z',
            },
          ],
        },
      ),
    );
    renderPage();

    expect(await screen.findAllByText('<img src=x onerror=alert(1)>')).toHaveLength(2);
    expect(document.querySelector('img')).toBeNull();
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

  it.each([
    [
      'WORKTREE_CREATE_FAILED',
      'Não foi possível criar o worktree da missão. Tente de novo; se o erro voltar, confira o repositório do projeto no Git.',
    ],
    [
      'WORKTREE_COLLISION',
      'Já existe uma branch ou uma pasta com o nome do worktree desta missão, provavelmente de uma tentativa anterior. Confira o que sobrou no Git antes de apagar algo e tente de novo.',
    ],
    [
      'PROJECT_WITHOUT_GIT',
      'Este projeto não é um repositório Git. Inicialize o Git na pasta e tente de novo.',
    ],
  ] as const)(
    'falha de início por %s mostra a mensagem desse código, e a missão segue na fila',
    async (code, message) => {
      const hub = installApi(viewOf({ status: 'queued' }));
      hub.api.missions.start.mockResolvedValueOnce({
        ok: false,
        error: { code, message: 'Mensagem técnica.', retryable: false },
      } as never);
      renderPage();

      await userEvent.click(await screen.findByRole('button', { name: 'Iniciar missão' }));

      const alert = await screen.findByRole('alert');
      expect(alert).toHaveTextContent(message);
      if (code !== 'PROJECT_WITHOUT_GIT') expect(alert).not.toHaveTextContent('Inicialize o Git');
      expect(screen.queryByText('Mensagem técnica.')).not.toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Cancelar missão' })).toBeEnabled();
      expect(screen.getByText('Plano aprovado, na fila')).toBeInTheDocument();
    },
  );

  it('falha de início por outro erro mantém a mensagem da ação, sem a do worktree', async () => {
    const hub = installApi(viewOf({ status: 'queued' }));
    hub.api.missions.start.mockResolvedValueOnce({
      ok: false,
      error: {
        code: 'AGENT_UNAVAILABLE',
        message: 'O agente não está disponível.',
        retryable: true,
      },
    } as never);
    renderPage();

    await userEvent.click(await screen.findByRole('button', { name: 'Iniciar missão' }));

    expect(await screen.findByText('O agente não está disponível.')).toBeInTheDocument();
    expect(screen.queryByText(/Não foi possível criar o worktree/)).not.toBeInTheDocument();
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

  it('a aprovação pendente aparece só na coluna Aguardando você, e a decisão vai para approvals.decide', async () => {
    const hub = installApi(
      viewOf({ status: 'waiting_approval' }, { pendingApprovals: [approval] }),
    );
    renderPage();

    const column = await screen.findByRole('region', { name: 'Aguardando você' });
    const card = within(column).getByRole('region', { name: 'Gravar arquivo' });
    // A decisão não aparece duas vezes: a Conversa mostra o histórico, a coluna é o lugar da decisão.
    expect(screen.getAllByRole('region', { name: 'Gravar arquivo' })).toHaveLength(1);
    const conversation = screen.getByRole('region', { name: 'Conversa' });
    expect(within(conversation).queryByRole('region', { name: 'Gravar arquivo' })).toBeNull();
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

    const answer = await screen.findByLabelText('Qual o nome do arquivo?');
    await userEvent.type(answer, 'notas.md');
    await userEvent.click(screen.getByRole('button', { name: 'Enviar resposta' }));

    await waitFor(() =>
      expect(hub.api.missions.provideInput).toHaveBeenCalledWith({
        missionId: 'm1',
        text: 'notas.md',
      }),
    );
  });

  it('se a recarga falha, mantém a Conversa com a resposta digitada e mostra o erro acima da grade', async () => {
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
    const answer = await screen.findByLabelText('Qual o nome do arquivo?');
    await userEvent.type(answer, 'notas.md');

    hub.api.missions.get.mockResolvedValueOnce({
      ok: false,
      error: { code: 'UNKNOWN', message: 'Falha ao reler a missão.', retryable: true },
    } as unknown as AppResult<MissionViewDto>);
    hub.emit({ eventType: 'execution.paused' });

    expect(await screen.findByRole('alert')).toHaveTextContent('Falha ao reler a missão.');
    expect(screen.getByLabelText('Qual o nome do arquivo?')).toHaveValue('notas.md');
    expect(screen.getByRole('region', { name: 'Conversa' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 1, name: 'Ajustar login' })).toBeInTheDocument();
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

describe('MissionPage: foco da decisão (R182)', () => {
  /** Verdadeiro quando o foco está dentro do painel dado (ou no próprio painel). */
  function focusIsIn(panel: HTMLElement): boolean {
    return panel.contains(document.activeElement);
  }

  it('com a missão aguardando sua aprovação, o foco vai para a coluna Aguardando você e o aviso aparece', async () => {
    installApi(viewOf({ status: 'waiting_approval' }));
    renderPage();

    const column = await screen.findByRole('complementary', { name: 'Decisões da missão' });
    await waitFor(() => expect(focusIsIn(column)).toBe(true));
    expect(screen.getByText('Aguarda sua decisão')).toBeInTheDocument();
  });

  it('com o agente aguardando resposta, o foco também vai para o painel Conversa', async () => {
    installApi(viewOf({ status: 'waiting_input' }));
    renderPage();

    const conversation = await screen.findByRole('region', { name: 'Conversa' });
    await waitFor(() => expect(focusIsIn(conversation)).toBe(true));
  });

  it('sem decisão pendente, o foco não vai para a Conversa e o aviso não aparece', async () => {
    installApi(viewOf({ status: 'running' }));
    renderPage();

    await screen.findByRole('region', { name: 'Plano' });
    expect(focusIsIn(screen.getByRole('region', { name: 'Conversa' }))).toBe(false);
    expect(screen.queryByText('Aguarda sua decisão')).not.toBeInTheDocument();
  });

  it('com aprovação pendente, o aviso leva o foco de volta à coluna Aguardando você', async () => {
    installApi(viewOf({ status: 'waiting_approval' }));
    renderPage();
    const column = await screen.findByRole('complementary', { name: 'Decisões da missão' });
    await waitFor(() => expect(focusIsIn(column)).toBe(true));
    (document.activeElement as HTMLElement).blur();
    expect(focusIsIn(column)).toBe(false);

    await userEvent.click(screen.getByRole('button', { name: 'Ver a decisão' }));

    expect(focusIsIn(column)).toBe(true);
  });

  it('com o agente aguardando resposta, o aviso leva o foco à Conversa, onde fica a resposta', async () => {
    installApi(viewOf({ status: 'waiting_input' }));
    renderPage();
    const conversation = await screen.findByRole('region', { name: 'Conversa' });
    await waitFor(() => expect(focusIsIn(conversation)).toBe(true));
    (document.activeElement as HTMLElement).blur();
    expect(focusIsIn(conversation)).toBe(false);

    await userEvent.click(screen.getByRole('button', { name: 'Ver a decisão' }));

    expect(focusIsIn(conversation)).toBe(true);
  });

  it('a resposta não enviada continua na caixa depois de uma ação da missão', async () => {
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
    const answer = await screen.findByLabelText('Qual o nome do arquivo?');
    await userEvent.type(answer, 'notas');

    await userEvent.click(screen.getByRole('button', { name: 'Cancelar missão' }));

    await waitFor(() => expect(hub.api.missions.cancel).toHaveBeenCalledWith('m1'));
    expect(screen.getByLabelText('Qual o nome do arquivo?')).toHaveValue('notas');
  });
});

describe('MissionPage: controles sem espera de chamadas longas (R183)', () => {
  it('com o início ainda pendente, Pausar funciona e chama pause', async () => {
    const hub = installApi(viewOf({ status: 'queued' }));
    hub.api.missions.start.mockImplementation(() => new Promise<never>(() => undefined));
    renderPage();

    await userEvent.click(await screen.findByRole('button', { name: 'Iniciar missão' }));
    hub.setView(viewOf({ status: 'running' }));
    hub.emit({ eventType: 'mission.status_changed', payload: { from: 'queued', to: 'running' } });

    const pause = await screen.findByRole('button', { name: 'Pausar' });
    expect(pause).toBeEnabled();
    await userEvent.click(pause);

    await waitFor(() => expect(hub.api.missions.pause).toHaveBeenCalledWith('m1'));
  });

  it('com o início pendente, Cancelar continua habilitado', async () => {
    const hub = installApi(viewOf({ status: 'queued' }));
    hub.api.missions.start.mockImplementation(() => new Promise<never>(() => undefined));
    renderPage();

    await userEvent.click(await screen.findByRole('button', { name: 'Iniciar missão' }));

    expect(screen.getByRole('button', { name: 'Cancelar missão' })).toBeEnabled();
  });
});
