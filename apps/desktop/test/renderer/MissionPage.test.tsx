import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type {
  AppResult,
  MissionEventDto,
  MissionViewDto,
  ProjectHubApi,
} from '@project-hub/contracts';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Link, MemoryRouter, Route, Routes } from 'react-router';
import { MissionPage } from '../../src/renderer/pages/MissionPage';
import { PROJECTS_CHANGED_EVENT } from '../../src/renderer/projects-events';
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
      delete: vi.fn(() => Promise.resolve<AppResult<void>>(OK)),
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
        <Route path={ROUTE_PATHS.projectDetail} element={<p>Página do projeto</p>} />
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

  it('missão em andamento não oferece Excluir missão', async () => {
    installApi(viewOf({ status: 'running' }));
    renderPage();

    await screen.findByRole('heading', { level: 1, name: 'Ajustar login' });
    expect(screen.queryByRole('button', { name: 'Excluir missão' })).not.toBeInTheDocument();
  });

  it('missão encerrada: Excluir missão pede confirmação, apaga e volta ao projeto', async () => {
    const { api } = installApi(viewOf({ status: 'succeeded' }));
    const avisos = vi.fn();
    window.addEventListener(PROJECTS_CHANGED_EVENT, avisos);
    const user = userEvent.setup();
    renderPage();

    await user.click(await screen.findByRole('button', { name: 'Excluir missão' }));
    expect(screen.getByRole('group', { name: /Excluir esta missão/ })).toBeInTheDocument();
    expect(api.missions.delete).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: 'Excluir' }));

    await waitFor(() => expect(api.missions.delete).toHaveBeenCalledWith('m1'));
    expect(await screen.findByText('Página do projeto')).toBeInTheDocument();
    expect(avisos).toHaveBeenCalled();
    window.removeEventListener(PROJECTS_CHANGED_EVENT, avisos);
  });

  it('falha ao excluir mostra a mensagem da API e a missão segue na tela', async () => {
    const { api } = installApi(viewOf({ status: 'failed' }));
    api.missions.delete.mockResolvedValueOnce({
      ok: false,
      error: {
        code: 'WORKTREE_HAS_UNSAVED_CHANGES',
        message: 'O worktree tem alterações não salvas.',
        retryable: false,
      },
    });
    const user = userEvent.setup();
    renderPage();

    await user.click(await screen.findByRole('button', { name: 'Excluir missão' }));
    await user.click(screen.getByRole('button', { name: 'Excluir' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'O worktree tem alterações não salvas.',
    );
    expect(screen.getByRole('heading', { level: 1, name: 'Ajustar login' })).toBeInTheDocument();
    expect(screen.queryByText('Página do projeto')).not.toBeInTheDocument();
  });
});

const TAB_NAMES = ['Conversa', 'Plano', 'Diff', 'Testes', 'Terminal', 'Logs'];

/** Troca para a aba pelo nome e devolve o painel dela. */
async function openTab(name: string): Promise<HTMLElement> {
  await userEvent.click(await screen.findByRole('tab', { name }));
  return screen.getByRole('tabpanel', { name });
}

const APPROVAL = {
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

function eventOf(overrides: Partial<MissionEventDto>): MissionEventDto {
  return {
    id: 'ev',
    missionId: 'm1',
    aggregateType: 'execution',
    aggregateId: 'e1',
    eventType: 'message.delta',
    severity: 'info',
    actor: 'agent',
    payload: {},
    sequence: 1,
    createdAt: '2026-10-20T09:00:00.000Z',
    ...overrides,
  };
}

function verificationEvent(
  id: string,
  sequence: number,
  payload: { command: string; passed: number; failed: number },
): MissionEventDto {
  return eventOf({
    id,
    sequence,
    eventType: 'verification.completed',
    payload: { type: 'verification.completed', durationMs: 1200, ...payload },
  });
}

describe('MissionPage: abas', () => {
  it('mostra as seis abas na ordem, com a Conversa aberta e só o painel dela visível', async () => {
    installApi(viewOf());
    renderPage();

    const tablist = await screen.findByRole('tablist', { name: 'Abas da missão' });
    const tabs = within(tablist).getAllByRole('tab');
    expect(tabs.map((tab) => tab.textContent)).toEqual(TAB_NAMES);
    expect(screen.getByRole('tab', { name: 'Conversa' })).toHaveAttribute('aria-selected', 'true');
    for (const tab of tabs.slice(1)) expect(tab).toHaveAttribute('aria-selected', 'false');
    // Os painéis de fora seguem montados, mas escondidos: só um é acessível.
    const panels = screen.getAllByRole('tabpanel');
    expect(panels).toHaveLength(1);
    expect(panels[0]).toHaveAccessibleName('Conversa');
    expect(document.querySelectorAll('[role="tabpanel"]')).toHaveLength(6);
  });

  it('trocar de aba mostra o painel certo e esconde o anterior', async () => {
    installApi(viewOf());
    renderPage();

    const plan = await openTab('Plano');

    expect(screen.getByRole('tab', { name: 'Plano' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tab', { name: 'Conversa' })).toHaveAttribute('aria-selected', 'false');
    expect(plan).toBeVisible();
    expect(within(plan).getByRole('list', { name: 'Etapas do plano' })).toBeVisible();
    expect(screen.queryByRole('tabpanel', { name: 'Conversa' })).toBeNull();
    expect(screen.getByRole('tab', { name: 'Plano' })).toHaveAttribute('aria-controls', plan.id);
  });

  it('as setas, Home e End do teclado trocam de aba', async () => {
    installApi(viewOf());
    const user = userEvent.setup();
    renderPage();
    const conversation = await screen.findByRole('tab', { name: 'Conversa' });
    conversation.focus();

    await user.keyboard('{ArrowRight}');
    expect(screen.getByRole('tab', { name: 'Plano' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tab', { name: 'Plano' })).toHaveFocus();

    await user.keyboard('{ArrowLeft}{ArrowLeft}');
    expect(screen.getByRole('tab', { name: 'Logs' })).toHaveAttribute('aria-selected', 'true');

    await user.keyboard('{Home}');
    expect(screen.getByRole('tab', { name: 'Conversa' })).toHaveAttribute('aria-selected', 'true');
    await user.keyboard('{End}');
    expect(screen.getByRole('tab', { name: 'Logs' })).toHaveFocus();
  });

  it('com a missão em rascunho, o Diff diz que ainda não há worktree, e Testes e Terminal dizem que nada foi executado', async () => {
    installApi(viewOf({ status: 'draft' }));
    renderPage();

    const diff = await openTab('Diff');
    expect(within(diff).getByText(/A missão ainda não tem worktree/)).toBeInTheDocument();
    const tests = await openTab('Testes');
    expect(
      within(tests).getByText('Nenhum comando de verificação foi executado'),
    ).toBeInTheDocument();
    const terminal = await openTab('Terminal');
    expect(within(terminal).getByText('O agente ainda não executou comandos.')).toBeInTheDocument();
  });

  it('com worktree e sem eventos, Diff, Testes e Terminal mostram o estado vazio', async () => {
    installApi(viewOf({ status: 'running', worktreePath: 'C:\\app\\.worktrees\\m1' }));
    renderPage();

    // O diff chega depois da primeira pintura: a espera é pelo texto, não pelo painel.
    const diff = await openTab('Diff');
    expect(
      await within(diff).findByText('A missão ainda não alterou arquivos.'),
    ).toBeInTheDocument();
    expect(
      within(await openTab('Testes')).getByText('Nenhum comando de verificação foi executado'),
    ).toBeInTheDocument();
    expect(
      within(await openTab('Terminal')).getByText('O agente ainda não executou comandos.'),
    ).toBeInTheDocument();
  });

  it('estado vazio é uma frase solta na aba, sem moldura de painel', async () => {
    installApi(viewOf({ status: 'running' }));
    renderPage();

    const terminal = await openTab('Terminal');

    expect(terminal.querySelector('.panel')).toBeNull();
    expect(within(terminal).getByText('O agente ainda não executou comandos.')).toHaveClass(
      'panel__empty',
    );
  });

  it('a aba Testes mostra os critérios de aceite, cada um não verificado até um teste passar', async () => {
    installApi(viewOf({ status: 'running' }));
    renderPage();

    const tests = await openTab('Testes');

    const criteria = within(tests).getByRole('region', { name: 'Critérios de aceite' });
    expect(within(criteria).getByText('Login funciona')).toBeInTheDocument();
    expect(within(criteria).getByText('○ não verificado')).toBeInTheDocument();
  });

  it('com 300 eventos, a lista fica no painel da aba Logs, que rola sozinho', async () => {
    const events = Array.from({ length: 300 }, (_, index) =>
      eventOf({
        id: `e${index}`,
        payload: { content: `linha ${index}` },
        sequence: index + 1,
        createdAt: new Date(Date.UTC(2026, 9, 20, 9, 0, index)).toISOString(),
      }),
    );
    installApi(viewOf({ status: 'running' }, { events }));
    renderPage();

    const logs = await openTab('Logs');
    const list = within(logs).getByRole('list', { name: 'Eventos do sistema' });
    expect(within(list).getAllByRole('listitem')).toHaveLength(300);
    expect(logs).toContainElement(list);
    const css = readCss('app.css');
    expect(ruleDeclarations(css, '.mission-tabpanel').get('overflow')).toBe('auto');
    expect(ruleDeclarations(css, '.mission-tabpanel').get('min-height')).toBe('0');
  });

  it('um evento com markup aparece como texto na Conversa e nos Logs, sem elemento img', async () => {
    installApi(
      viewOf(
        { status: 'running' },
        { events: [eventOf({ payload: { content: '<img src=x onerror=alert(1)>' } })] },
      ),
    );
    renderPage();

    expect(await screen.findAllByText('<img src=x onerror=alert(1)>')).toHaveLength(2);
    expect(document.querySelector('img')).toBeNull();
  });

  it('a Conversa mostra só a história da missão; o detalhe técnico fica nos Logs', async () => {
    installApi(
      viewOf(
        { status: 'running', worktreePath: 'C:\\app\\.worktrees\\m1' },
        {
          events: [
            eventOf({ id: 'a', sequence: 1, payload: { content: 'Vou aplicar o plano.' } }),
            eventOf({
              id: 'b',
              sequence: 2,
              eventType: 'worktree.created',
              payload: { path: 'C:\\app\\.worktrees\\m1' },
            }),
            eventOf({
              id: 'c',
              sequence: 3,
              eventType: 'tool.requested',
              payload: { call: { callId: 'x', name: 'write_file', input: {} } },
            }),
          ],
        },
      ),
    );
    renderPage();

    const conversation = await screen.findByRole('tabpanel', { name: 'Conversa' });
    expect(within(conversation).getByText('Vou aplicar o plano.')).toBeInTheDocument();
    expect(within(conversation).queryByText(/Worktree criado em/)).toBeNull();
    expect(within(conversation).queryByText(/Ferramenta solicitada/)).toBeNull();

    const logs = await openTab('Logs');
    expect(within(logs).getByText('Vou aplicar o plano.')).toBeInTheDocument();
    expect(within(logs).getByText(/Worktree criado em/)).toBeInTheDocument();
    expect(within(logs).getByText('Ferramenta solicitada: write_file.')).toBeInTheDocument();
  });

  it('os painéis seguem montados: a resposta digitada na Conversa sobrevive a uma visita a outra aba', async () => {
    installApi(
      viewOf(
        { status: 'waiting_input' },
        {
          events: [
            eventOf({
              eventType: 'input.requested',
              payload: { request: { id: 'entrada', prompt: 'Qual o nome do arquivo?' } },
            }),
          ],
        },
      ),
    );
    renderPage();
    await userEvent.type(await screen.findByLabelText('Qual o nome do arquivo?'), 'notas');

    await openTab('Logs');
    await openTab('Conversa');

    expect(screen.getByLabelText('Qual o nome do arquivo?')).toHaveValue('notas');
  });
});

/**
 * O que cada situação oferece como ação principal no resumo (e nada além dela em destaque). Esperando a
 * decisão, o resumo não tem ação: o banner "Aguardando você" é o único convite.
 */
const PRIMARY_BY_STATUS = [
  ['draft', 'Gerar plano'],
  ['planned', 'Aprovar plano'],
  ['queued', 'Iniciar missão'],
  ['waiting_approval', undefined],
  ['waiting_input', undefined],
  ['paused', 'Retomar'],
  ['failed', 'Tentar de novo'],
  ['cancelled', 'Tentar de novo'],
  ['running', undefined],
  ['succeeded', undefined],
] as const;

describe('MissionPage: resumo', () => {
  it.each(PRIMARY_BY_STATUS)(
    'com a missão em %s, a ação principal do resumo é %s',
    async (status, label) => {
      installApi(viewOf({ status }));
      renderPage();

      const summary = await screen.findByRole('region', { name: 'Resumo da missão' });
      const primary = summary.querySelectorAll('.mission-summary__primary');
      if (label === undefined) {
        expect(primary).toHaveLength(0);
      } else {
        expect(primary).toHaveLength(1);
        expect(primary[0]).toHaveTextContent(label);
        expect(within(summary).getByRole('button', { name: label })).toBeEnabled();
      }
    },
  );

  it('ações secundárias: pausar e cancelar em execução; só excluir com a missão encerrada', async () => {
    installApi(viewOf({ status: 'running' }));
    const { unmount } = renderPage();

    const summary = await screen.findByRole('region', { name: 'Resumo da missão' });
    expect(within(summary).getByRole('button', { name: 'Pausar' })).toBeInTheDocument();
    expect(within(summary).getByRole('button', { name: 'Cancelar missão' })).toBeInTheDocument();
    unmount();

    installApi(viewOf({ status: 'succeeded' }));
    renderPage();
    const ended = await screen.findByRole('region', { name: 'Resumo da missão' });
    expect(within(ended).getByRole('button', { name: 'Excluir missão' })).toBeInTheDocument();
    expect(within(ended).queryByRole('button', { name: 'Cancelar missão' })).toBeNull();
  });

  it('a ação principal chama a mesma API de antes, com a mesma missão', async () => {
    const hub = installApi(viewOf({ status: 'draft' }));
    renderPage();

    await userEvent.click(await screen.findByRole('button', { name: 'Gerar plano' }));

    await waitFor(() => expect(hub.api.missions.plan).toHaveBeenCalledWith('m1'));
  });

  it('o indicador de verificação diz "Nenhum teste rodou" quando não há verificação', async () => {
    installApi(viewOf({ status: 'running' }));
    renderPage();

    const indicators = await screen.findByRole('list', { name: 'Indicadores da missão' });

    expect(within(indicators).getByText('Verificação')).toBeInTheDocument();
    expect(within(indicators).getByText('Nenhum teste rodou')).toBeInTheDocument();
  });

  it('o indicador de verificação soma a última rodada de cada comando e marca falha', async () => {
    installApi(
      viewOf(
        { status: 'running' },
        {
          events: [
            verificationEvent('v1', 1, { command: 'pnpm test', passed: 3, failed: 2 }),
            verificationEvent('v2', 2, { command: 'pnpm test', passed: 12, failed: 2 }),
            verificationEvent('v3', 3, { command: 'pnpm lint', passed: 1, failed: 0 }),
          ],
        },
      ),
    );
    renderPage();

    const indicators = await screen.findByRole('list', { name: 'Indicadores da missão' });

    const value = within(indicators).getByText('13 de 15 passaram');
    expect(value.closest('li')).toHaveClass('mission-indicator--bad');
  });

  it('com verificação que passou, mostra X de Y e o tom de sucesso', async () => {
    installApi(
      viewOf(
        { status: 'succeeded' },
        { events: [verificationEvent('v1', 1, { command: 'pnpm test', passed: 14, failed: 0 })] },
      ),
    );
    renderPage();

    const indicators = await screen.findByRole('list', { name: 'Indicadores da missão' });

    expect(within(indicators).getByText('14 de 14 passaram').closest('li')).toHaveClass(
      'mission-indicator--ok',
    );
  });

  it('verificação que não contou testes aparece como "Sem verificação"', async () => {
    installApi(
      viewOf(
        { status: 'succeeded' },
        { events: [verificationEvent('v1', 1, { command: 'pnpm test', passed: 0, failed: 0 })] },
      ),
    );
    renderPage();

    const indicators = await screen.findByRole('list', { name: 'Indicadores da missão' });

    expect(within(indicators).getByText('Sem verificação')).toBeInTheDocument();
  });

  it('arquivos alterados: "—" sem worktree, e a contagem do Diff quando ele é lido', async () => {
    installApi(viewOf({ status: 'draft' }));
    const first = renderPage();
    const indicators = await screen.findByRole('list', { name: 'Indicadores da missão' });
    expect(within(indicators).getByText('Arquivos alterados').nextSibling).toHaveTextContent('—');
    first.unmount();

    const hub = installApi(viewOf({ status: 'running', worktreePath: 'C:\\app\\.worktrees\\m1' }));
    hub.api.missions.diff.mockResolvedValue({
      ok: true,
      data: {
        files: [
          { path: 'a.ts', status: 'modified', added: 1, removed: 0, binary: false },
          { path: 'b.ts', status: 'added', added: 2, removed: 0, binary: false },
        ],
        truncatedFiles: false,
      },
    } as never);
    renderPage();

    expect(await screen.findByText('2 arquivos')).toBeInTheDocument();
  });

  it('Git: "sem worktree" ou "worktree criado", sem repetir a branch num cartão à parte', async () => {
    installApi(viewOf({ status: 'draft' }));
    const first = renderPage();
    const indicators = await screen.findByRole('list', { name: 'Indicadores da missão' });
    expect(within(indicators).getByText('sem worktree')).toBeInTheDocument();
    first.unmount();

    installApi(viewOf({ status: 'running', worktreePath: 'C:\\app\\.worktrees\\m1' }));
    renderPage();
    expect(await screen.findByText('worktree criado')).toBeInTheDocument();
    expect(screen.getByText('Push e merge exigem a sua aprovação.')).toBeInTheDocument();
    // A branch e o worktree aparecem uma vez só, na linha do resumo.
    expect(screen.getAllByText(/branch main/)).toHaveLength(1);
    expect(screen.queryByText('Branch do projeto')).toBeNull();
    expect(screen.queryByRole('region', { name: 'Git' })).toBeNull();
  });
});

describe('MissionPage: banner Aguardando você', () => {
  it.each(['draft', 'planned', 'queued', 'running', 'paused', 'succeeded', 'failed'] as const)(
    'com a missão em %s e nada pendente, o banner não aparece',
    async (status) => {
      installApi(viewOf({ status }));
      renderPage();

      await screen.findByRole('region', { name: 'Resumo da missão' });
      expect(screen.queryByRole('region', { name: 'Aguardando você' })).toBeNull();
    },
  );

  it('com aprovação pendente, lista o item, aparece em todas as abas e o botão leva à Conversa', async () => {
    installApi(viewOf({ status: 'waiting_approval' }, { pendingApprovals: [APPROVAL] }));
    renderPage();

    const banner = await screen.findByRole('region', { name: 'Aguardando você' });
    expect(within(banner).getByText('Gravar arquivo')).toBeInTheDocument();

    for (const name of ['Plano', 'Diff', 'Testes', 'Terminal', 'Logs']) {
      await openTab(name);
      expect(screen.getByRole('region', { name: 'Aguardando você' })).toBeVisible();
    }
    expect(screen.queryByRole('tabpanel', { name: 'Conversa' })).toBeNull();

    await userEvent.click(
      within(screen.getByRole('region', { name: 'Aguardando você' })).getByRole('button', {
        name: 'Ver a decisão',
      }),
    );

    expect(screen.getByRole('tab', { name: 'Conversa' })).toHaveAttribute('aria-selected', 'true');
    const conversation = screen.getByRole('tabpanel', { name: 'Conversa' });
    expect(conversation).toBeVisible();
    const decisions = within(conversation).getByRole('region', { name: 'Decisões da missão' });
    expect(decisions).toHaveFocus();
  });

  it('com o agente pedindo resposta, lista a pergunta e leva à Conversa', async () => {
    installApi(
      viewOf(
        { status: 'waiting_input' },
        {
          events: [
            eventOf({
              eventType: 'input.requested',
              payload: { request: { id: 'entrada', prompt: 'Qual o nome do arquivo?' } },
            }),
          ],
        },
      ),
    );
    renderPage();
    const banner = await screen.findByRole('region', { name: 'Aguardando você' });
    expect(within(banner).getByText('Qual o nome do arquivo?')).toBeInTheDocument();

    await openTab('Logs');
    await userEvent.click(screen.getByRole('button', { name: 'Ver a decisão' }));

    expect(screen.getByRole('tab', { name: 'Conversa' })).toHaveAttribute('aria-selected', 'true');
    const conversation = screen.getByRole('tabpanel', { name: 'Conversa' });
    await waitFor(() => expect(conversation.contains(document.activeElement)).toBe(true));
  });

  it('o banner some quando a decisão é tomada', async () => {
    const hub = installApi(
      viewOf({ status: 'waiting_approval' }, { pendingApprovals: [APPROVAL] }),
    );
    renderPage();
    await screen.findByRole('region', { name: 'Aguardando você' });

    hub.setView(viewOf({ status: 'running' }));
    hub.emit({ eventType: 'approval.decided', payload: { decision: 'approved' } });

    await waitFor(() =>
      expect(screen.queryByRole('region', { name: 'Aguardando você' })).toBeNull(),
    );
  });
});

describe('MissionPage: banner e leitor de tela', () => {
  function statusRegion(): HTMLElement {
    const region = document.querySelector<HTMLElement>('[role="status"].decision-status');
    if (region === null) throw new Error('A região status do banner não existe.');
    return region;
  }

  it('o banner fica dentro de uma região status educada que já existe antes de ele entrar', async () => {
    const hub = installApi(viewOf({ status: 'running' }));
    renderPage();
    await screen.findByRole('region', { name: 'Resumo da missão' });
    const status = statusRegion();
    expect(status).toHaveAttribute('aria-live', 'polite');
    expect(status).toBeEmptyDOMElement();

    hub.setView(viewOf({ status: 'waiting_approval' }, { pendingApprovals: [APPROVAL] }));
    hub.emit({ eventType: 'approval.requested', payload: {} });

    const banner = await within(status).findByRole('region', { name: 'Aguardando você' });
    // A mesma região, sem ser refeita: é a entrada do conteúdo que o leitor de tela anuncia.
    expect(statusRegion()).toBe(status);
    expect(status).toContainElement(banner);
  });

  it('o banner é nomeado pelo próprio título, sem aria-label repetido', async () => {
    installApi(viewOf({ status: 'waiting_approval' }, { pendingApprovals: [APPROVAL] }));
    renderPage();

    const banner = await screen.findByRole('region', { name: 'Aguardando você' });
    const title = within(banner).getByRole('heading', { level: 2, name: 'Aguardando você' });
    expect(banner).toHaveAttribute('aria-labelledby', title.id);
    expect(title.id).not.toBe('');
    expect(banner).not.toHaveAttribute('aria-label');
  });
});

describe('MissionPage: troca de missão', () => {
  it('não leva a aba aberta nem a contagem de arquivos de uma missão para a outra', async () => {
    const worktree = { worktreePath: 'C:\\app\\.worktrees\\m' };
    const views: Record<string, MissionViewDto> = {
      m1: viewOf({ id: 'm1', title: 'Missão A', status: 'running', ...worktree }),
      m2: viewOf({ id: 'm2', title: 'Missão B', status: 'running', ...worktree }),
    };
    const hub = installApi(views.m1 as MissionViewDto);
    hub.api.missions.get.mockImplementation(((id: string) =>
      Promise.resolve({ ok: true, data: views[id] })) as never);
    // A missão A tem 2 arquivos alterados; o diff da B demora (nunca chega neste teste).
    hub.api.missions.diff.mockImplementation(((id: string) =>
      id === 'm1'
        ? Promise.resolve({
            ok: true,
            data: {
              files: [
                { path: 'a.ts', status: 'modified', added: 1, removed: 0, binary: false },
                { path: 'b.ts', status: 'added', added: 2, removed: 0, binary: false },
              ],
              truncatedFiles: false,
            },
          })
        : new Promise(() => undefined)) as never);

    render(
      <MemoryRouter initialEntries={['/projects/p1/missions/m1']}>
        <Link to="/projects/p1/missions/m2">Ir para a missão B</Link>
        <Routes>
          <Route path={ROUTE_PATHS.missionDetail} element={<MissionPage />} />
        </Routes>
      </MemoryRouter>,
    );
    await screen.findByRole('heading', { level: 1, name: 'Missão A' });
    expect(await screen.findByText('2 arquivos')).toBeInTheDocument();
    await openTab('Logs');
    expect(screen.getByRole('tab', { name: 'Logs' })).toHaveAttribute('aria-selected', 'true');

    await userEvent.click(screen.getByRole('link', { name: 'Ir para a missão B' }));

    await screen.findByRole('heading', { level: 1, name: 'Missão B' });
    expect(screen.getByRole('tab', { name: 'Conversa' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tab', { name: 'Logs' })).toHaveAttribute('aria-selected', 'false');
    const indicators = screen.getByRole('list', { name: 'Indicadores da missão' });
    expect(within(indicators).getByText('Arquivos alterados').nextSibling).toHaveTextContent('—');
    expect(screen.queryByText('2 arquivos')).toBeNull();
  });
});

describe('MissionPage: plano', () => {
  it('com o plano pronto, aprova o plano e busca a visão de novo', async () => {
    const hub = installApi(viewOf());
    renderPage();

    await userEvent.click(await screen.findByRole('button', { name: 'Aprovar plano' }));

    await waitFor(() => expect(hub.api.missions.approvePlan).toHaveBeenCalledWith('m1'));
    expect(hub.api.missions.get.mock.calls.length).toBeGreaterThanOrEqual(2);
  });

  it('pedir novo plano chama o planejamento de novo, na mesma missão', async () => {
    const hub = installApi(viewOf());
    renderPage();
    const plan = await openTab('Plano');

    await userEvent.click(within(plan).getByRole('button', { name: 'Pedir novo plano' }));

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
      expect(screen.getByText('Plano aprovado, aguardando início')).toBeInTheDocument();
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

    await userEvent.click(await screen.findByRole('button', { name: 'Aprovar plano' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Só um plano gerado pode ser aprovado.',
    );
  });
});

describe('MissionPage: conversa', () => {
  it('o cartão da aprovação pendente fica na Conversa, uma vez só, e a decisão vai para approvals.decide', async () => {
    const hub = installApi(
      viewOf({ status: 'waiting_approval' }, { pendingApprovals: [APPROVAL] }),
    );
    renderPage();

    const conversation = await screen.findByRole('tabpanel', { name: 'Conversa' });
    const card = within(conversation).getByRole('region', { name: 'Gravar arquivo' });
    // O banner só lista o item: o cartão com os botões não se repete.
    expect(screen.getAllByRole('region', { name: 'Gravar arquivo' })).toHaveLength(1);
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

  it('se a recarga falha, mantém a Conversa com a resposta digitada e mostra o erro acima das abas', async () => {
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
    expect(screen.getByRole('tabpanel', { name: 'Conversa' })).toBeInTheDocument();
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

  it('com a missão aguardando sua aprovação, o foco vai para as decisões, na Conversa, e o banner aparece', async () => {
    installApi(viewOf({ status: 'waiting_approval' }, { pendingApprovals: [APPROVAL] }));
    renderPage();

    const decisions = await screen.findByRole('region', { name: 'Decisões da missão' });
    await waitFor(() => expect(focusIsIn(decisions)).toBe(true));
    expect(screen.getByRole('region', { name: 'Aguardando você' })).toBeInTheDocument();
  });

  it('com o agente aguardando resposta, o foco vai direto para a caixa de resposta', async () => {
    installApi(viewOf({ status: 'waiting_input' }));
    renderPage();

    const answer = await screen.findByLabelText('O agente aguarda a sua resposta.');
    expect(answer.tagName).toBe('TEXTAREA');
    await waitFor(() => expect(answer).toHaveFocus());
  });

  it('sem decisão pendente, o foco não vai para a Conversa e o banner não aparece', async () => {
    installApi(viewOf({ status: 'running' }));
    renderPage();

    const conversation = await screen.findByRole('tabpanel', { name: 'Conversa' });
    expect(focusIsIn(conversation)).toBe(false);
    expect(screen.queryByRole('region', { name: 'Aguardando você' })).not.toBeInTheDocument();
  });

  it('quando a missão passa a esperar a decisão com outra aba aberta, nada troca e nada toma o foco; só o banner aparece', async () => {
    const hub = installApi(viewOf({ status: 'running' }));
    renderPage();
    await openTab('Logs');
    const logsTab = screen.getByRole('tab', { name: 'Logs' });
    expect(logsTab).toHaveFocus();

    hub.setView(viewOf({ status: 'waiting_approval' }, { pendingApprovals: [APPROVAL] }));
    hub.emit({
      eventType: 'mission.status_changed',
      payload: { from: 'running', to: 'waiting_approval' },
    });

    expect(await screen.findByRole('region', { name: 'Aguardando você' })).toBeVisible();
    expect(logsTab).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tab', { name: 'Conversa' })).toHaveAttribute('aria-selected', 'false');
    expect(logsTab).toHaveFocus();
    const decisions = document.querySelector('[aria-label="Decisões da missão"]') as HTMLElement;
    expect(focusIsIn(decisions)).toBe(false);
  });

  it('quando a missão passa a esperar a aprovação com a Conversa aberta, o foco vai para a decisão', async () => {
    const hub = installApi(viewOf({ status: 'running' }));
    renderPage();
    await screen.findByRole('tabpanel', { name: 'Conversa' });

    hub.setView(viewOf({ status: 'waiting_approval' }, { pendingApprovals: [APPROVAL] }));
    hub.emit({
      eventType: 'mission.status_changed',
      payload: { from: 'running', to: 'waiting_approval' },
    });

    const decisions = await screen.findByRole('region', { name: 'Decisões da missão' });
    await waitFor(() => expect(focusIsIn(decisions)).toBe(true));
  });

  it('quando o agente passa a pedir resposta com a Conversa aberta, o foco vai para a caixa de resposta', async () => {
    const hub = installApi(viewOf({ status: 'running' }));
    renderPage();
    await screen.findByRole('tabpanel', { name: 'Conversa' });

    hub.setView(viewOf({ status: 'waiting_input' }));
    hub.emit({
      eventType: 'mission.status_changed',
      payload: { from: 'running', to: 'waiting_input' },
    });

    const answer = await screen.findByLabelText('O agente aguarda a sua resposta.');
    await waitFor(() => expect(answer).toHaveFocus());
  });

  it('com aprovação pendente, o banner leva o foco de volta às decisões', async () => {
    installApi(viewOf({ status: 'waiting_approval' }, { pendingApprovals: [APPROVAL] }));
    renderPage();
    const decisions = await screen.findByRole('region', { name: 'Decisões da missão' });
    await waitFor(() => expect(focusIsIn(decisions)).toBe(true));
    (document.activeElement as HTMLElement).blur();
    expect(focusIsIn(decisions)).toBe(false);

    await userEvent.click(screen.getByRole('button', { name: 'Ver a decisão' }));

    expect(focusIsIn(decisions)).toBe(true);
  });

  it.each<[MissionViewDto['mission']['status'], Partial<MissionViewDto>]>([
    ['waiting_approval', { pendingApprovals: [APPROVAL] }],
    ['waiting_input', {}],
  ])(
    'com a missão em %s, o resumo não tem ação principal e o banner é o único convite',
    async (status, rest) => {
      installApi(viewOf({ status }, rest));
      renderPage();

      const summary = await screen.findByRole('region', { name: 'Resumo da missão' });
      expect(summary.querySelectorAll('.mission-summary__primary')).toHaveLength(0);
      expect(within(summary).queryByRole('button', { name: 'Ver decisão' })).toBeNull();
      expect(screen.queryByRole('button', { name: 'Ver decisão' })).toBeNull();
      const banner = screen.getByRole('region', { name: 'Aguardando você' });
      expect(within(banner).getByRole('button', { name: 'Ver a decisão' })).toBeEnabled();
    },
  );

  it('com o agente aguardando resposta, o banner leva o foco à caixa de resposta', async () => {
    installApi(viewOf({ status: 'waiting_input' }));
    renderPage();
    const answer = await screen.findByLabelText('O agente aguarda a sua resposta.');
    await waitFor(() => expect(answer).toHaveFocus());
    answer.blur();
    expect(answer).not.toHaveFocus();

    await userEvent.click(screen.getByRole('button', { name: 'Ver a decisão' }));

    expect(answer).toHaveFocus();
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
