import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type {
  AppResult,
  MissionEventDto,
  MissionUsageEventDto,
  MissionViewDto,
  ProjectHubApi,
} from '@project-hub/contracts';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Link, MemoryRouter, Route, Routes, useParams } from 'react-router';
import { App } from '../../src/renderer/App';
import { Toaster } from '../../src/renderer/components/Toaster';
import { notify } from '../../src/renderer/notify';
import { MissionPage } from '../../src/renderer/pages/MissionPage';
import { PROJECTS_CHANGED_EVENT } from '../../src/renderer/projects-events';
import { ROUTE_PATHS } from '../../src/renderer/routes';
import { readCss, ruleDeclarations } from './css-rules';
import { moveSeparatorsAway } from './separator-geometry';

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
    steps: [
      { id: 's1', position: 1, title: 'Login funciona', status: 'pending', agent: 'claude-code' },
    ],
    executions: [],
    pendingApprovals: [],
    events: [],
    ...rest,
  };
}

type Listener = (event: MissionEventDto) => void;
type UsageListener = (event: MissionUsageEventDto) => void;

/** Instala a API do preload. `get` devolve a visão atual; cada teste troca a visão quando quer. */
function installApi(initial: MissionViewDto) {
  let current = initial;
  let listener: Listener | undefined;
  let usageListener: UsageListener | undefined;
  const unsubscribeUsage = vi.fn();
  const api = {
    missions: {
      get: vi.fn(() => Promise.resolve<AppResult<MissionViewDto>>({ ok: true, data: current })),
      diff: vi.fn(() => Promise.resolve({ ok: true, data: { files: [], truncatedFiles: false } })),
      approvePlan: vi.fn(() => Promise.resolve(OK)),
      plan: vi.fn((_missionId: string, _instruction?: string) =>
        Promise.resolve<AppResult<{ missionId: string; steps: [] }>>({
          ok: true,
          data: { missionId: 'm1', steps: [] },
        }),
      ),
      editPlanStep: vi.fn((_input: unknown) =>
        Promise.resolve<AppResult<{ missionId: string; steps: [] }>>({
          ok: true,
          data: { missionId: 'm1', steps: [] },
        }),
      ),
      start: vi.fn(() => Promise.resolve({ ok: true, data: { id: 'e1' } })),
      cancel: vi.fn(() => Promise.resolve(OK)),
      pause: vi.fn(() => Promise.resolve(OK)),
      resume: vi.fn(() => Promise.resolve(OK)),
      retry: vi.fn(() => Promise.resolve({ ok: true, data: { id: 'e2', attempt: 2 } })),
      delete: vi.fn(() => Promise.resolve<AppResult<void>>(OK)),
      provideInput: vi.fn(() => Promise.resolve(OK)),
      approveReview: vi.fn(() => Promise.resolve(OK)),
      requestChanges: vi.fn(() => Promise.resolve({ ok: true, data: { id: 'e3', attempt: 2 } })),
      subscribe: vi.fn((next: Listener) => {
        listener = next;
        return () => {
          listener = undefined;
        };
      }),
      subscribeUsage: vi.fn((next: UsageListener) => {
        usageListener = next;
        return () => {
          usageListener = undefined;
          unsubscribeUsage();
        };
      }),
    },
    approvals: { decide: vi.fn(() => Promise.resolve(OK)) },
    terminals: { list: vi.fn(() => Promise.resolve({ ok: true, data: [] })) },
  };
  window.projectHub = api as unknown as ProjectHubApi;
  return {
    api,
    setView(next: MissionViewDto) {
      current = next;
    },
    unsubscribeUsage,
    emitUsage(event: MissionUsageEventDto) {
      usageListener?.(event);
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

/** A rota da missão: lê o id do endereço e abre a página, como a aba do projeto faz. */
function MissionRoute() {
  const { missionId = '' } = useParams();
  return <MissionPage missionId={missionId} />;
}

function renderPage(state?: unknown) {
  return render(
    <>
      <MemoryRouter initialEntries={[{ pathname: '/workspaces/p1/missoes/m1', state }]}>
        <Routes>
          <Route path={ROUTE_PATHS.missionDetail} element={<MissionRoute />} />
          <Route path={ROUTE_PATHS.workspace} element={<p>Página do projeto</p>} />
        </Routes>
      </MemoryRouter>
      <Toaster />
    </>,
  );
}

/** Abre o menu "Mais ações" do resumo, onde ficam Pausar, Cancelar missão e Excluir missão. */
async function openActionsMenu(user = userEvent.setup()) {
  await user.click(await screen.findByRole('button', { name: 'Mais ações' }));
}

// A página da missão tem uma divisória (painel inferior): sem geometria, ela engoliria os cliques.
beforeEach(moveSeparatorsAway);

afterEach(() => {
  notify.clear();
  Reflect.deleteProperty(window, 'projectHub');
  vi.restoreAllMocks();
});

describe('MissionPage: cabeçalho', () => {
  it('mostra "Missão · projeto", o título, o objetivo e a situação em linguagem clara', async () => {
    installApi(viewOf());
    renderPage();

    expect(
      await screen.findByRole('heading', { level: 1, name: 'Ajustar login' }),
    ).toBeInTheDocument();
    const summary = screen.getByRole('region', { name: 'Resumo da missão' });
    expect(within(summary).getByText('Missão · app')).toHaveClass('eyebrow');
    expect(within(summary).getByText('Corrigir o login')).toBeInTheDocument();
    expect(within(summary).getByText('Aguarda aprovação do plano')).toHaveClass(
      'chip',
      'chip--warn',
    );
    // Sem worktree, não há caminho para copiar nem linha de worktree.
    expect(within(summary).queryByText(/worktree/)).toBeNull();
    expect(within(summary).queryByRole('button', { name: 'Copiar caminho' })).toBeNull();
  });

  it('o "← Missões" leva de volta à lista de missões do projeto', async () => {
    installApi(viewOf());
    renderPage();

    const back = await screen.findByRole('link', { name: '← Missões' });
    expect(back).toHaveAttribute('href', '/workspaces/p1?visao=missoes');

    await userEvent.click(back);

    expect(await screen.findByText('Página do projeto')).toBeInTheDocument();
  });

  it('o cabeçalho não tem a ação principal nem os três indicadores', async () => {
    installApi(viewOf({ status: 'draft' }));
    renderPage();

    const summary = await screen.findByRole('region', { name: 'Resumo da missão' });
    // O único botão do cabeçalho é o "Mais ações".
    expect(
      within(summary)
        .getAllByRole('button')
        .map((button) => button.textContent),
    ).toEqual(['Mais ações']);
    expect(screen.queryByRole('list', { name: 'Indicadores da missão' })).toBeNull();
    expect(screen.queryByText('Verificação')).toBeNull();
    expect(screen.queryByText('Worktree criado')).toBeNull();
  });

  it('o selo da situação leva o ícone do estado, que o leitor de tela ignora', async () => {
    installApi(viewOf({ status: 'waiting_approval' }));
    renderPage();

    const summary = await screen.findByRole('region', { name: 'Resumo da missão' });
    const chip = within(summary).getByText('Aguarda sua aprovação');
    expect(chip.querySelector('svg')).toHaveAttribute('aria-hidden', 'true');
  });

  it('"Copiar caminho" tem um ícone decorativo e o nome acessível continua o mesmo', async () => {
    installApi(viewOf({ status: 'running', worktreePath: 'C:\\app\\.worktrees\\m1' }));
    renderPage();

    const button = await screen.findByRole('button', { name: 'Copiar caminho' });
    expect(button.querySelector('svg')).toHaveAttribute('aria-hidden', 'true');
    expect(button).toHaveTextContent(/^Copiar caminho$/);
  });

  it('com worktree, mostra só o nome curto da pasta, e o caminho inteiro fica no título', async () => {
    installApi(
      viewOf({ status: 'running', worktreePath: 'C:\\app\\.worktrees\\m1-ajustar-login' }),
    );
    renderPage();

    const summary = await screen.findByRole('region', { name: 'Resumo da missão' });
    const name = within(summary).getByText('m1-ajustar-login');
    expect(name).toHaveAttribute('title', 'C:\\app\\.worktrees\\m1-ajustar-login');
    expect(within(summary).queryByText(/C:\\app\\.worktrees/)).toBeNull();
  });

  it('"Copiar caminho" copia o caminho inteiro do worktree e diz "Copiado"', async () => {
    installApi(viewOf({ status: 'running', worktreePath: 'C:\\app\\.worktrees\\m1' }));
    const user = userEvent.setup();
    const writeText = vi.spyOn(navigator.clipboard, 'writeText').mockResolvedValue(undefined);
    renderPage();

    await user.click(await screen.findByRole('button', { name: 'Copiar caminho' }));

    expect(writeText).toHaveBeenCalledWith('C:\\app\\.worktrees\\m1');
    expect(await screen.findByText('Copiado')).toBeInTheDocument();
    writeText.mockRestore();
  });

  it('se a cópia falha, o aviso diz que não foi possível copiar o caminho', async () => {
    installApi(viewOf({ status: 'running', worktreePath: 'C:\\app\\.worktrees\\m1' }));
    const user = userEvent.setup();
    const writeText = vi
      .spyOn(navigator.clipboard, 'writeText')
      .mockRejectedValue(new Error('negado'));
    renderPage();

    await user.click(await screen.findByRole('button', { name: 'Copiar caminho' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Não foi possível copiar o caminho.',
    );
    const summary = screen.getByRole('region', { name: 'Resumo da missão' });
    expect(within(summary).queryByText('Não foi possível copiar o caminho.')).toBeNull();
    expect(screen.queryByText('Copiado')).toBeNull();
    writeText.mockRestore();
  });

  it('não oferece pausar; cancelar sai de missão encerrada', async () => {
    installApi(viewOf({ status: 'succeeded' }));
    renderPage();

    await screen.findByRole('heading', { level: 1, name: 'Ajustar login' });
    await openActionsMenu();
    expect(screen.queryByRole('menuitem', { name: 'Pausar' })).not.toBeInTheDocument();
    expect(screen.queryByRole('menuitem', { name: 'Cancelar missão' })).not.toBeInTheDocument();
    // Só a ação de excluir sobrou: o menu aberto não está vazio.
    expect(screen.getByRole('menuitem', { name: 'Excluir missão' })).toBeInTheDocument();
  });

  it('missão em andamento não oferece Excluir missão', async () => {
    installApi(viewOf({ status: 'running' }));
    renderPage();

    await screen.findByRole('heading', { level: 1, name: 'Ajustar login' });
    await openActionsMenu();
    expect(screen.queryByRole('menuitem', { name: 'Excluir missão' })).not.toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: 'Cancelar missão' })).toBeInTheDocument();
  });

  it('missão encerrada: Excluir missão pede confirmação, apaga e volta ao projeto', async () => {
    const { api } = installApi(viewOf({ status: 'succeeded' }));
    const avisos = vi.fn();
    window.addEventListener(PROJECTS_CHANGED_EVENT, avisos);
    const user = userEvent.setup();
    renderPage();

    await openActionsMenu(user);
    await user.click(screen.getByRole('menuitem', { name: 'Excluir missão' }));
    // A pergunta fica de pé depois que o menu fecha, com o foco no Voltar (a escolha segura).
    expect(screen.getByRole('group', { name: /Excluir esta missão/ })).toBeInTheDocument();
    expect(screen.queryByRole('menuitem', { name: 'Excluir missão' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Voltar' })).toHaveFocus();
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

    await openActionsMenu(user);
    await user.click(screen.getByRole('menuitem', { name: 'Excluir missão' }));
    await user.click(screen.getByRole('button', { name: 'Excluir' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'O worktree tem alterações não salvas.',
    );
    expect(screen.getByRole('heading', { level: 1, name: 'Ajustar login' })).toBeInTheDocument();
    expect(screen.queryByText('Página do projeto')).not.toBeInTheDocument();
  });

  it('falha ao excluir: a pergunta some e o menu volta, com a missão ainda na tela', async () => {
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

    await openActionsMenu(user);
    await user.click(screen.getByRole('menuitem', { name: 'Excluir missão' }));
    await user.click(screen.getByRole('button', { name: 'Excluir' }));

    await screen.findByRole('alert');
    expect(screen.queryByRole('group', { name: /Excluir esta missão/ })).not.toBeInTheDocument();
    // Dá para tentar de novo: o menu voltou e ainda oferece Excluir missão.
    await openActionsMenu(user);
    expect(screen.getByRole('menuitem', { name: 'Excluir missão' })).toBeInTheDocument();
  });

  it('falha ao excluir: o foco volta ao botão Mais ações', async () => {
    const { api } = installApi(viewOf({ status: 'failed' }));
    api.missions.delete.mockResolvedValueOnce({
      ok: false,
      error: { code: 'WORKTREE_HAS_UNSAVED_CHANGES', message: 'Falhou.', retryable: false },
    });
    const user = userEvent.setup();
    renderPage();

    await openActionsMenu(user);
    await user.click(screen.getByRole('menuitem', { name: 'Excluir missão' }));
    await user.click(screen.getByRole('button', { name: 'Excluir' }));

    await screen.findByRole('alert');
    await waitFor(() => expect(screen.getByRole('button', { name: 'Mais ações' })).toHaveFocus());
  });

  it('Voltar desfaz o pedido de exclusão: nada é apagado e o foco volta ao menu', async () => {
    const { api } = installApi(viewOf({ status: 'succeeded' }));
    const user = userEvent.setup();
    renderPage();

    await openActionsMenu(user);
    await user.click(screen.getByRole('menuitem', { name: 'Excluir missão' }));
    await user.click(screen.getByRole('button', { name: 'Voltar' }));

    expect(screen.queryByRole('group', { name: /Excluir esta missão/ })).not.toBeInTheDocument();
    expect(api.missions.delete).not.toHaveBeenCalled();
    await waitFor(() => expect(screen.getByRole('button', { name: 'Mais ações' })).toHaveFocus());
  });

  it('a pergunta de exclusão aberta não sobrevive a uma nova tentativa nem volta sozinha quando a missão falha de novo', async () => {
    const hub = installApi(viewOf({ status: 'failed' }));
    const user = userEvent.setup();
    renderPage();

    await openActionsMenu(user);
    await user.click(screen.getByRole('menuitem', { name: 'Excluir missão' }));
    expect(screen.getByRole('group', { name: /Excluir esta missão/ })).toBeInTheDocument();

    // A pessoa tenta de novo: a missão volta a rodar e o menu reaparece, sem a pergunta.
    hub.setView(viewOf({ status: 'running' }));
    hub.emit({ eventType: 'mission.status_changed', payload: { from: 'failed', to: 'running' } });
    await openActionsMenu(user);
    expect(await screen.findByRole('menuitem', { name: 'Pausar' })).toBeInTheDocument();
    expect(screen.queryByRole('group', { name: /Excluir esta missão/ })).not.toBeInTheDocument();
    await user.keyboard('{Escape}');

    // Falha de novo: a pergunta antiga não volta, e o foco não pula para o "Voltar".
    hub.setView(viewOf({ status: 'failed' }));
    hub.emit({ eventType: 'mission.status_changed', payload: { from: 'running', to: 'failed' } });
    await screen.findByRole('button', { name: 'Tentar de novo' });
    expect(screen.queryByRole('group', { name: /Excluir esta missão/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Voltar' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Mais ações' })).toBeInTheDocument();
  });
});

const TAB_NAMES = ['Conversa', 'Diff', 'Testes', 'Terminal', 'Logs'];

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
  it('mostra as cinco abas na ordem, com a Conversa aberta e só o painel dela visível', async () => {
    installApi(viewOf());
    renderPage();

    const tablist = await screen.findByRole('tablist', { name: 'Abas da missão' });
    const tabs = within(tablist).getAllByRole('tab');
    // O nome é o primeiro texto da aba; a contagem (quando há) vem depois e não entra no nome.
    expect(tabs.map((tab) => tab.firstChild?.textContent)).toEqual(TAB_NAMES);
    expect(tabs[1]).toHaveAccessibleName('Diff');
    expect(screen.getByRole('tab', { name: 'Conversa' })).toHaveAttribute('aria-selected', 'true');
    for (const tab of tabs.slice(1)) expect(tab).toHaveAttribute('aria-selected', 'false');
    // Os painéis de fora seguem montados, mas escondidos: só um é acessível.
    const panels = screen.getAllByRole('tabpanel');
    expect(panels).toHaveLength(1);
    expect(panels[0]).toHaveAccessibleName('Conversa');
    expect(document.querySelectorAll('[role="tabpanel"]')).toHaveLength(5);
  });

  it('a página não tem a aba Plano nem a faixa do fluxo da missão', async () => {
    installApi(viewOf());
    renderPage();

    await screen.findByRole('tablist', { name: 'Abas da missão' });
    expect(screen.queryByRole('tab', { name: 'Plano' })).toBeNull();
    expect(screen.queryByRole('list', { name: 'Fluxo da missão' })).toBeNull();
  });

  it('cada aba leva a classe-gancho tab--<id> (sem cor própria)', async () => {
    installApi(viewOf());
    renderPage();

    const ids = ['conversation', 'diff', 'tests', 'terminal', 'logs'];
    const tabs = within(
      await screen.findByRole('tablist', { name: 'Abas da missão' }),
    ).getAllByRole('tab');
    expect(tabs.map((tab) => tab.className)).toEqual(ids.map((id) => `tab tab--${id}`));
  });

  it('sem plano, diff ou verificação, nenhuma aba mostra contagem', async () => {
    installApi(viewOf({ status: 'draft' }, { steps: [] }));
    renderPage();

    const tablist = await screen.findByRole('tablist', { name: 'Abas da missão' });
    expect(tablist.querySelectorAll('.tab__count')).toHaveLength(0);
    for (const tab of within(tablist).getAllByRole('tab')) {
      expect(tab).not.toHaveAttribute('aria-describedby');
    }
  });

  it('Diff conta os arquivos alterados e Testes os que passaram, sem mudar o nome da aba', async () => {
    const hub = installApi(
      viewOf(
        { status: 'running', worktreePath: 'C:\\app\\.worktrees\\m1' },
        {
          steps: [
            { id: 's1', position: 1, title: 'Primeira', status: 'succeeded', agent: 'claude-code' },
            { id: 's2', position: 2, title: 'Segunda', status: 'running', agent: 'claude-code' },
          ],
          events: [verificationEvent('v1', 1, { command: 'pnpm test', passed: 12, failed: 2 })],
        },
      ),
    );
    hub.api.missions.diff.mockResolvedValue({
      ok: true,
      data: {
        files: [
          { path: 'a.ts', status: 'modified', added: 1, removed: 0, binary: false },
          { path: 'b.ts', status: 'added', added: 2, removed: 0, binary: false },
          { path: 'c.ts', status: 'deleted', added: 0, removed: 4, binary: false },
        ],
        truncatedFiles: false,
      },
    } as never);
    renderPage();

    const diff = await screen.findByRole('tab', { name: 'Diff' });
    await waitFor(() => expect(diff.querySelector('.tab__count')).toHaveTextContent('3'));
    expect(diff).toHaveAccessibleDescription('3 arquivos alterados');

    const tests = screen.getByRole('tab', { name: 'Testes' });
    expect(tests.querySelector('.tab__count')).toHaveTextContent('12/14');
    expect(tests).toHaveAccessibleDescription('12 de 14 testes passaram');
    // O número fica escondido do leitor de tela: ele lê a descrição.
    expect(tests.querySelector('.tab__count')).toHaveAttribute('aria-hidden', 'true');

    for (const name of ['Conversa', 'Terminal', 'Logs']) {
      expect(screen.getByRole('tab', { name }).querySelector('.tab__count')).toBeNull();
    }
  });

  it('com o worktree sem alterações, o Diff não mostra contagem', async () => {
    installApi(viewOf({ status: 'running', worktreePath: 'C:\\app\\.worktrees\\m1' }));
    renderPage();

    const diffPanel = await openTab('Diff');
    await within(diffPanel).findByText('A missão ainda não alterou arquivos.');
    expect(screen.getByRole('tab', { name: 'Diff' }).querySelector('.tab__count')).toBeNull();
  });

  it('trocar de aba mostra o painel certo e esconde o anterior', async () => {
    installApi(viewOf());
    renderPage();

    const tests = await openTab('Testes');

    expect(screen.getByRole('tab', { name: 'Testes' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tab', { name: 'Conversa' })).toHaveAttribute('aria-selected', 'false');
    expect(tests).toBeVisible();
    expect(within(tests).getByRole('region', { name: 'Critérios de aceite' })).toBeVisible();
    expect(screen.queryByRole('tabpanel', { name: 'Conversa' })).toBeNull();
    expect(screen.getByRole('tab', { name: 'Testes' })).toHaveAttribute('aria-controls', tests.id);
  });

  it('as setas, Home e End do teclado trocam de aba', async () => {
    installApi(viewOf());
    const user = userEvent.setup();
    renderPage();
    const conversation = await screen.findByRole('tab', { name: 'Conversa' });
    conversation.focus();

    await user.keyboard('{ArrowRight}');
    expect(screen.getByRole('tab', { name: 'Diff' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tab', { name: 'Diff' })).toHaveFocus();

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
    const empty = within(terminal).getByText('O agente ainda não executou comandos.');
    expect(empty).toHaveClass('empty-state__title');
    expect(empty.closest('.panel__empty')).not.toBeNull();
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
    const css = readCss('mission.css');
    expect(ruleDeclarations(css, '.mission-dock__panel').get('overflow')).toBe('auto');
    expect(ruleDeclarations(css, '.mission-dock__panel').get('min-height')).toBe('0');
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

  it('a resposta digitada no bloco sobrevive a uma visita às abas do painel inferior', async () => {
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
 * O que cada situação oferece como ação principal no bloco "Sua decisão" (e nada além dela em destaque).
 * Esperando a decisão (aprovação, resposta, revisão), os controles são os da própria decisão, testados à parte.
 */
const PRIMARY_BY_STATUS = [
  ['draft', 'Orquestrar'],
  ['planned', 'Aprovar plano'],
  ['queued', 'Iniciar missão'],
  ['paused', 'Retomar'],
  ['failed', 'Tentar de novo'],
  ['cancelled', 'Tentar de novo'],
  ['running', undefined],
  ['succeeded', undefined],
] as const;

describe('MissionPage: ações e decisão', () => {
  it.each(PRIMARY_BY_STATUS)(
    'com a missão em %s, a ação principal do bloco Sua decisão é %s',
    async (status, label) => {
      installApi(viewOf({ status }));
      renderPage();

      const decision = await screen.findByRole('region', { name: 'Sua decisão' });
      const summary = screen.getByRole('region', { name: 'Resumo da missão' });
      // A ação principal não está mais no cabeçalho.
      expect(summary.querySelectorAll('.btn-primary, .btn-decision')).toHaveLength(0);
      // Só a ação principal tem o estilo cheio no bloco (Planejar de novo é de contorno).
      const filled = decision.querySelectorAll('.btn-primary, .btn-decision');
      if (label === undefined) {
        expect(filled).toHaveLength(0);
      } else {
        expect(filled).toHaveLength(1);
        expect(filled[0]).toHaveTextContent(label);
        expect(within(decision).getByRole('button', { name: label })).toBeEnabled();
      }
    },
  );

  it('ações secundárias: pausar e cancelar em execução; só excluir com a missão encerrada', async () => {
    installApi(viewOf({ status: 'running' }));
    const { unmount } = renderPage();

    // As três ações moram no menu "Mais ações": soltas no resumo não aparecem mais.
    const summary = await screen.findByRole('region', { name: 'Resumo da missão' });
    expect(within(summary).queryByRole('button', { name: 'Pausar' })).toBeNull();
    expect(within(summary).queryByRole('button', { name: 'Cancelar missão' })).toBeNull();
    await openActionsMenu();
    expect(screen.getByRole('menuitem', { name: 'Pausar' })).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: 'Cancelar missão' })).toBeInTheDocument();
    expect(screen.queryByRole('menuitem', { name: 'Excluir missão' })).toBeNull();
    unmount();

    installApi(viewOf({ status: 'succeeded' }));
    renderPage();
    const ended = await screen.findByRole('region', { name: 'Resumo da missão' });
    expect(within(ended).queryByRole('button', { name: 'Excluir missão' })).toBeNull();
    await openActionsMenu();
    expect(screen.getByRole('menuitem', { name: 'Excluir missão' })).toBeInTheDocument();
    expect(screen.queryByRole('menuitem', { name: 'Cancelar missão' })).toBeNull();
    expect(screen.queryByRole('menuitem', { name: 'Pausar' })).toBeNull();
  });

  it('aberta por "Criar e orquestrar" em rascunho, planeja uma vez sozinha', async () => {
    const hub = installApi(viewOf({ status: 'draft' }));
    renderPage({ orchestrate: true });

    await waitFor(() => expect(hub.api.missions.plan).toHaveBeenCalledWith('m1'));
    await screen.findByRole('button', { name: 'Orquestrar' });
    expect(hub.api.missions.plan).toHaveBeenCalledTimes(1);
  });

  it('o pedido de orquestrar não planeja missão que já saiu do rascunho', async () => {
    const hub = installApi(viewOf({ status: 'planned' }));
    renderPage({ orchestrate: true });

    await screen.findByRole('button', { name: 'Aprovar plano' });
    expect(hub.api.missions.plan).not.toHaveBeenCalled();
  });

  it('sem o pedido, abrir a missão em rascunho não planeja', async () => {
    const hub = installApi(viewOf({ status: 'draft' }));
    renderPage();

    await screen.findByRole('button', { name: 'Orquestrar' });
    expect(hub.api.missions.plan).not.toHaveBeenCalled();
  });

  it('Orquestrar chama o planejamento da missão, sem instrução', async () => {
    const hub = installApi(viewOf({ status: 'draft' }));
    renderPage();

    await userEvent.click(await screen.findByRole('button', { name: 'Orquestrar' }));

    await waitFor(() => expect(hub.api.missions.plan).toHaveBeenCalledWith('m1'));
    expect(hub.api.missions.plan.mock.calls[0]).toHaveLength(1);
  });

  it('em rascunho, o aviso da cota fica junto do Orquestrar e descreve o botão', async () => {
    installApi(viewOf({ status: 'draft' }));
    renderPage();

    const decision = await screen.findByRole('region', { name: 'Sua decisão' });
    expect(within(decision).getByText('Planejar usa a cota do seu Claude.')).toBeInTheDocument();
    expect(
      within(decision).getByRole('button', { name: 'Orquestrar' }),
    ).toHaveAccessibleDescription('Planejar usa a cota do seu Claude.');
  });

  it('o aviso da cota não aparece onde não há planejamento', async () => {
    installApi(viewOf({ status: 'queued' }));
    renderPage();

    await screen.findByRole('region', { name: 'Resumo da missão' });
    expect(screen.queryByText('Planejar usa a cota do seu Claude.')).toBeNull();
  });

  it('enquanto planeja, mostra "Planejando…" com o botão desabilitado, e volta ao fim', async () => {
    const hub = installApi(viewOf({ status: 'draft' }));
    let finish: (result: AppResult<{ missionId: string; steps: [] }>) => void = () => undefined;
    hub.api.missions.plan.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    renderPage();

    await userEvent.click(await screen.findByRole('button', { name: 'Orquestrar' }));

    expect(await screen.findByRole('button', { name: 'Planejando…' })).toBeDisabled();
    expect(screen.queryByRole('button', { name: 'Orquestrar' })).toBeNull();
    await act(async () => {
      finish({ ok: true, data: { missionId: 'm1', steps: [] } });
      await Promise.resolve();
    });
    expect(await screen.findByRole('button', { name: 'Orquestrar' })).toBeEnabled();
  });

  it('dois cliques seguidos no Orquestrar chamam o planejamento uma vez só', async () => {
    const hub = installApi(viewOf({ status: 'draft' }));
    hub.api.missions.plan.mockImplementationOnce(() => new Promise(() => undefined));
    renderPage();
    const button = await screen.findByRole('button', { name: 'Orquestrar' });

    await userEvent.dblClick(button);

    expect(hub.api.missions.plan).toHaveBeenCalledTimes(1);
  });

  it('falha do planejamento aparece como alerta e o Orquestrar segue disponível', async () => {
    const hub = installApi(viewOf({ status: 'draft' }));
    hub.api.missions.plan.mockResolvedValueOnce({
      ok: false,
      error: { code: 'PROCESS_START_FAILED', message: 'O Claude não respondeu.', retryable: true },
    });
    renderPage();

    await userEvent.click(await screen.findByRole('button', { name: 'Orquestrar' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('O Claude não respondeu.');
    expect(screen.getByRole('button', { name: 'Orquestrar' })).toBeEnabled();
  });

  it('"Arquivos alterados" lista cada arquivo do worktree com as linhas a mais e a menos', async () => {
    const hub = installApi(viewOf({ status: 'running', worktreePath: 'C:\\app\\.worktrees\\m1' }));
    hub.api.missions.diff.mockResolvedValue({
      ok: true,
      data: {
        files: [
          { path: 'src/a.ts', status: 'modified', added: 3, removed: 1, binary: false },
          { path: 'src/b.ts', status: 'added', added: 2, removed: 0, binary: false },
        ],
        truncatedFiles: false,
      },
    } as never);
    renderPage();

    const section = await screen.findByRole('region', { name: 'Arquivos alterados' });
    const items = await within(section).findAllByRole('listitem');
    expect(items.map((item) => item.textContent)).toEqual(['src/a.ts +3 −1', 'src/b.ts +2 −0']);
    expect(hub.api.missions.diff).toHaveBeenCalledWith('m1');
  });

  it('sem worktree, "Arquivos alterados" diz "Nenhuma alteração pendente." e o diff não é lido', async () => {
    const hub = installApi(viewOf({ status: 'draft' }));
    renderPage();

    const section = await screen.findByRole('region', { name: 'Arquivos alterados' });
    expect(within(section).getByText('Nenhuma alteração pendente.')).toBeInTheDocument();
    expect(hub.api.missions.diff).not.toHaveBeenCalled();
  });

  it('com worktree e o diff sem arquivos, também diz "Nenhuma alteração pendente."', async () => {
    installApi(viewOf({ status: 'running', worktreePath: 'C:\\app\\.worktrees\\m1' }));
    renderPage();

    const section = await screen.findByRole('region', { name: 'Arquivos alterados' });
    expect(await within(section).findByText('Nenhuma alteração pendente.')).toBeInTheDocument();
  });

  it('a missão mostra, de cima para baixo, o cabeçalho, as tarefas, os arquivos alterados e a decisão', async () => {
    installApi(viewOf({ status: 'planned' }));
    renderPage();

    const regions = [
      await screen.findByRole('region', { name: 'Resumo da missão' }),
      screen.getByRole('region', { name: 'Plano da missão' }),
      screen.getByRole('region', { name: 'Arquivos alterados' }),
      screen.getByRole('region', { name: 'Sua decisão' }),
    ];
    for (let index = 1; index < regions.length; index += 1) {
      const before = regions[index - 1] as HTMLElement;
      const after = regions[index] as HTMLElement;
      expect(before.compareDocumentPosition(after) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    }
    // O painel inferior vem depois do corpo.
    const tablist = screen.getByRole('tablist', { name: 'Abas da missão' });
    expect(
      (regions[3] as HTMLElement).compareDocumentPosition(tablist) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it('com tarefas que têm papel, o quadro do orquestrador mostra a descrição de cada papel e a entrega aguardando', async () => {
    installApi(
      viewOf(
        { status: 'planned' },
        {
          steps: [
            {
              id: 's1',
              position: 1,
              title: 'Tela',
              status: 'pending',
              agent: 'claude-code',
              role: 'frontend',
            },
            {
              id: 's2',
              position: 2,
              title: 'API',
              status: 'pending',
              agent: 'claude-code',
              role: 'backend',
            },
          ],
        },
      ),
    );
    renderPage();

    const board = await screen.findByRole('region', { name: 'Quadro do orquestrador' });
    expect(within(board).getByText('Interface e componentes')).toBeInTheDocument();
    expect(within(board).getByText('APIs e lógica do sistema')).toBeInTheDocument();
    expect(within(board).getByText('aguardando tarefas')).toBeInTheDocument();
    expect(screen.getByRole('table', { name: 'Etapas do plano' })).toBeInTheDocument();
  });
});

describe('MissionPage: resumo de conclusão', () => {
  const CONCLUSION = {
    summary: 'Login corrigido.',
    verification: { passed: 14, failed: 0 },
    changedFiles: 3,
    gitState: 'uncommitted' as const,
  };

  it('missão concluída mostra a frase final e o próximo passo do Git no bloco Sua decisão, sem os indicadores', async () => {
    installApi(
      viewOf(
        { status: 'succeeded', worktreePath: 'C:\\app\\.worktrees\\m1' },
        {
          conclusion: CONCLUSION,
          events: [verificationEvent('v1', 1, { command: 'pnpm test', passed: 14, failed: 0 })],
        },
      ),
    );
    renderPage();

    const summary = await screen.findByRole('region', { name: 'Resumo da missão' });
    const decision = screen.getByRole('region', { name: 'Sua decisão' });
    const block = within(decision).getByRole('region', { name: 'Resumo da conclusão' });
    expect(within(block).getByText('Login corrigido.')).toBeInTheDocument();
    expect(
      within(block).getByText('Há alterações sem commit na pasta da missão. Elas ainda não entraram no projeto.'),
    ).toBeInTheDocument();
    // O resumo da conclusão saiu do cabeçalho: ele não aparece duas vezes.
    expect(screen.getAllByText('Login corrigido.')).toHaveLength(1);
    expect(within(summary).queryByRole('region', { name: 'Resumo da conclusão' })).toBeNull();
    expect(within(summary).queryByRole('list', { name: 'Indicadores da missão' })).toBeNull();
    // Sem ação principal: só o menu "Mais ações" (com Excluir missão) e o caminho do worktree.
    expect(
      within(summary)
        .getAllByRole('button')
        .map((button) => button.textContent),
    ).toEqual(['Mais ações', 'Copiar caminho']);
    await openActionsMenu();
    expect(screen.getByRole('menuitem', { name: 'Excluir missão' })).toBeInTheDocument();
  });

  it.each(['running', 'failed', 'cancelled', 'planned'] as const)(
    'missão %s não mostra o bloco de conclusão',
    async (status) => {
      installApi(viewOf({ status }, { conclusion: CONCLUSION }));
      renderPage();

      await screen.findByRole('region', { name: 'Resumo da missão' });
      expect(screen.queryByRole('region', { name: 'Resumo da conclusão' })).toBeNull();
      expect(screen.queryByText('Login corrigido.')).toBeNull();
    },
  );

  it('em revisão, o resumo da conclusão fica no bloco, ao lado de Aprovar conclusão', async () => {
    installApi(viewOf({ status: 'review' }, { conclusion: CONCLUSION }));
    renderPage();

    const decision = await screen.findByRole('region', { name: 'Sua decisão' });
    expect(within(decision).getByRole('region', { name: 'Resumo da conclusão' })).toBeVisible();
    expect(within(decision).getByRole('button', { name: 'Aprovar conclusão' })).toBeEnabled();
  });

  it('missão concluída sem resumo não mostra o bloco do resumo, e o bloco diz que ela terminou', async () => {
    installApi(viewOf({ status: 'succeeded' }));
    renderPage();

    const decision = await screen.findByRole('region', { name: 'Sua decisão' });
    expect(screen.queryByRole('region', { name: 'Resumo da conclusão' })).toBeNull();
    expect(within(decision).getByText('Missão concluída.')).toBeInTheDocument();
  });
});

describe('MissionPage: decisão pendente no bloco Sua decisão', () => {
  it.each(['draft', 'planned', 'queued', 'running', 'paused', 'succeeded', 'failed'] as const)(
    'com a missão em %s e nada pendente, o bloco não tem cartão nem caixa de resposta',
    async (status) => {
      installApi(viewOf({ status }));
      renderPage();

      const decision = await screen.findByRole('region', { name: 'Sua decisão' });
      expect(within(decision).queryByText('Aprovação necessária')).toBeNull();
      expect(within(decision).queryByRole('form', { name: 'Resposta ao agente' })).toBeNull();
      // O banner "Aguardando você" não existe mais: o bloco é o aviso.
      expect(screen.queryByRole('region', { name: 'Aguardando você' })).toBeNull();
    },
  );

  it('com aprovação pendente, o cartão fica no bloco, visível em todas as abas do painel inferior', async () => {
    installApi(viewOf({ status: 'waiting_approval' }, { pendingApprovals: [APPROVAL] }));
    renderPage();

    const decision = await screen.findByRole('region', { name: 'Sua decisão' });
    expect(within(decision).getByRole('region', { name: 'Gravar arquivo' })).toBeVisible();

    for (const name of TAB_NAMES) {
      await openTab(name);
      expect(
        within(screen.getByRole('region', { name: 'Sua decisão' })).getByRole('region', {
          name: 'Gravar arquivo',
        }),
      ).toBeVisible();
    }
  });

  it('com o agente pedindo resposta, a pergunta e a caixa ficam no bloco', async () => {
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

    const decision = await screen.findByRole('region', { name: 'Sua decisão' });
    expect(within(decision).getByLabelText('Qual o nome do arquivo?')).toBeInTheDocument();
  });

  it('o cartão some quando a decisão é tomada', async () => {
    const hub = installApi(
      viewOf({ status: 'waiting_approval' }, { pendingApprovals: [APPROVAL] }),
    );
    renderPage();
    await screen.findByRole('region', { name: 'Gravar arquivo' });

    hub.setView(viewOf({ status: 'running' }));
    hub.emit({ eventType: 'approval.decided', payload: { decision: 'approved' } });

    await waitFor(() =>
      expect(screen.queryByRole('region', { name: 'Gravar arquivo' })).toBeNull(),
    );
    expect(
      within(screen.getByRole('region', { name: 'Sua decisão' })).getByText(
        'O Orquestrador está acompanhando as tarefas.',
      ),
    ).toBeInTheDocument();
  });
});

describe('MissionPage: aviso e leitor de tela', () => {
  function announceRegion(): HTMLElement {
    const region = document.querySelector<HTMLElement>('[role="status"].decision-announce');
    if (region === null) throw new Error('A região de anúncio da decisão não existe.');
    return region;
  }

  it('a região de anúncio já existe, vazia, antes de a decisão chegar, e recebe o aviso na mesma região', async () => {
    const hub = installApi(viewOf({ status: 'running' }));
    renderPage();
    await screen.findByRole('region', { name: 'Resumo da missão' });
    const region = announceRegion();
    expect(region).toHaveAttribute('aria-live', 'polite');
    expect(region).toBeEmptyDOMElement();

    hub.setView(viewOf({ status: 'waiting_approval' }, { pendingApprovals: [APPROVAL] }));
    hub.emit({ eventType: 'approval.requested', payload: {} });

    await waitFor(() =>
      expect(region).toHaveTextContent('Aguardando você: aprovação, Gravar arquivo.'),
    );
    // A mesma região, sem ser refeita: é a entrada do conteúdo que o leitor de tela anuncia.
    expect(announceRegion()).toBe(region);
  });

  it('com outra aba do painel inferior aberta, a decisão que chega é anunciada, sem trocar de aba nem tomar o foco', async () => {
    const hub = installApi(viewOf({ status: 'running' }));
    renderPage();
    await openTab('Logs');
    const logsTab = screen.getByRole('tab', { name: 'Logs' });
    expect(announceRegion()).toBeEmptyDOMElement();

    hub.setView(viewOf({ status: 'waiting_input' }));
    hub.emit({
      eventType: 'mission.status_changed',
      payload: { from: 'running', to: 'waiting_input' },
    });

    await waitFor(() =>
      expect(announceRegion()).toHaveTextContent('Aguardando você: o agente espera uma resposta.'),
    );
    expect(logsTab).toHaveAttribute('aria-selected', 'true');
    expect(logsTab).toHaveFocus();
  });

  it('o bloco é nomeado pelo próprio título, sem aria-label repetido', async () => {
    installApi(viewOf({ status: 'waiting_approval' }, { pendingApprovals: [APPROVAL] }));
    renderPage();

    const decision = await screen.findByRole('region', { name: 'Sua decisão' });
    const title = within(decision).getByRole('heading', { level: 2, name: 'Sua decisão' });
    expect(decision).toHaveAttribute('aria-labelledby', title.id);
    expect(title.id).not.toBe('');
    expect(decision).not.toHaveAttribute('aria-label');
  });
});

describe('MissionPage: troca de missão', () => {
  it('não leva a aba aberta nem os arquivos alterados de uma missão para a outra', async () => {
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
      <MemoryRouter initialEntries={['/workspaces/p1/missoes/m1']}>
        <Link to="/workspaces/p1/missoes/m2">Ir para a missão B</Link>
        <Routes>
          <Route path={ROUTE_PATHS.missionDetail} element={<MissionRoute />} />
        </Routes>
      </MemoryRouter>,
    );
    await screen.findByRole('heading', { level: 1, name: 'Missão A' });
    const files = await screen.findByRole('region', { name: 'Arquivos alterados' });
    expect(await within(files).findByText('a.ts')).toBeInTheDocument();
    await waitFor(() =>
      expect(
        screen.getByRole('tab', { name: 'Diff' }).querySelector('.tab__count'),
      ).toHaveTextContent('2'),
    );
    await openTab('Logs');
    expect(screen.getByRole('tab', { name: 'Logs' })).toHaveAttribute('aria-selected', 'true');

    await userEvent.click(screen.getByRole('link', { name: 'Ir para a missão B' }));

    await screen.findByRole('heading', { level: 1, name: 'Missão B' });
    expect(screen.getByRole('tab', { name: 'Conversa' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tab', { name: 'Logs' })).toHaveAttribute('aria-selected', 'false');
    expect(screen.getByRole('tab', { name: 'Diff' }).querySelector('.tab__count')).toBeNull();
    expect(screen.queryByText('a.ts')).toBeNull();
  });
});

describe('MissionPage: plano e início', () => {
  it('com o plano pronto, aprova o plano e busca a visão de novo', async () => {
    const hub = installApi(viewOf());
    renderPage();

    await userEvent.click(await screen.findByRole('button', { name: 'Aprovar plano' }));

    await waitFor(() => expect(hub.api.missions.approvePlan).toHaveBeenCalledWith('m1'));
    expect(hub.api.missions.get.mock.calls.length).toBeGreaterThanOrEqual(2);
  });

  it('Planejar de novo sem instrução chama o planejamento da mesma missão', async () => {
    const hub = installApi(viewOf());
    renderPage();
    const decision = await screen.findByRole('region', { name: 'Sua decisão' });

    await userEvent.click(within(decision).getByRole('button', { name: 'Planejar de novo' }));

    await waitFor(() => expect(hub.api.missions.plan).toHaveBeenCalledWith('m1'));
    expect(hub.api.missions.plan.mock.calls[0]).toHaveLength(1);
    expect(hub.api.missions.approvePlan).not.toHaveBeenCalled();
  });

  it('o aviso da cota fica junto do Planejar de novo e descreve o botão', async () => {
    installApi(viewOf());
    renderPage();

    const decision = await screen.findByRole('region', { name: 'Sua decisão' });
    expect(within(decision).getByText('Planejar usa a cota do seu Claude.')).toBeInTheDocument();
    expect(
      within(decision).getByRole('button', { name: 'Planejar de novo' }),
    ).toHaveAccessibleDescription('Planejar usa a cota do seu Claude.');
  });

  it('com o plano pronto, o bloco diz que nada muda no código antes da aprovação', async () => {
    installApi(viewOf());
    renderPage();

    const decision = await screen.findByRole('region', { name: 'Sua decisão' });
    expect(
      within(decision).getByText('Nada muda no código antes da sua aprovação.'),
    ).toBeInTheDocument();
  });

  it('enquanto o novo plano é gerado, as tarefas não podem ser editadas', async () => {
    const hub = installApi(viewOf());
    hub.api.missions.plan.mockImplementationOnce(() => new Promise(() => undefined));
    renderPage();
    const decision = await screen.findByRole('region', { name: 'Sua decisão' });
    const plan = screen.getByRole('region', { name: 'Plano da missão' });

    await userEvent.click(within(decision).getByRole('button', { name: 'Planejar de novo' }));

    expect(await within(decision).findByRole('button', { name: 'Planejando…' })).toBeDisabled();
    expect(within(decision).getByRole('button', { name: 'Aprovar plano' })).toBeDisabled();
    expect(
      within(plan).getByRole('button', { name: 'Renomear tarefa Login funciona' }),
    ).toBeDisabled();
    expect(
      within(plan).getByRole('button', { name: 'Remover tarefa Login funciona' }),
    ).toBeDisabled();
    expect(hub.api.missions.editPlanStep).not.toHaveBeenCalled();
  });

  it('dois cliques seguidos no Planejar de novo chamam o planejamento uma vez só', async () => {
    const hub = installApi(viewOf());
    hub.api.missions.plan.mockImplementationOnce(() => new Promise(() => undefined));
    renderPage();
    const button = await screen.findByRole('button', { name: 'Planejar de novo' });

    await userEvent.dblClick(button);

    expect(hub.api.missions.plan).toHaveBeenCalledTimes(1);
  });

  it('se o novo plano falha, as tarefas anteriores continuam na tela, editáveis', async () => {
    const hub = installApi(viewOf());
    hub.api.missions.plan.mockResolvedValueOnce({
      ok: false,
      error: { code: 'PROCESS_START_FAILED', message: 'O Claude não respondeu.', retryable: true },
    });
    renderPage();
    const decision = await screen.findByRole('region', { name: 'Sua decisão' });
    const plan = screen.getByRole('region', { name: 'Plano da missão' });

    await userEvent.click(within(decision).getByRole('button', { name: 'Planejar de novo' }));

    expect(await within(decision).findByRole('alert')).toHaveTextContent('O Claude não respondeu.');
    expect(within(plan).getByText('Login funciona')).toBeInTheDocument();
    expect(
      within(plan).getByRole('button', { name: 'Renomear tarefa Login funciona' }),
    ).toBeEnabled();
    expect(within(decision).getByRole('button', { name: 'Planejar de novo' })).toBeEnabled();
  });

  it('Planejar de novo envia a instrução digitada', async () => {
    const hub = installApi(viewOf());
    renderPage();
    const decision = await screen.findByRole('region', { name: 'Sua decisão' });

    await userEvent.type(
      within(decision).getByRole('textbox', { name: 'Instrução para o novo plano' }),
      '  Separe o banco da API  ',
    );
    await userEvent.click(within(decision).getByRole('button', { name: 'Planejar de novo' }));

    await waitFor(() =>
      expect(hub.api.missions.plan).toHaveBeenCalledWith('m1', 'Separe o banco da API'),
    );
  });

  it('com a aprovação do plano em curso, Planejar de novo fica desabilitado', async () => {
    const hub = installApi(viewOf());
    hub.api.missions.approvePlan.mockImplementationOnce(() => new Promise(() => undefined));
    renderPage();

    await userEvent.click(await screen.findByRole('button', { name: 'Aprovar plano' }));

    expect(await screen.findByRole('button', { name: 'Planejar de novo' })).toBeDisabled();
    expect(hub.api.missions.plan).not.toHaveBeenCalled();
  });

  it('com a aprovação do plano em curso, as tarefas não podem ser editadas', async () => {
    const hub = installApi(viewOf());
    hub.api.missions.approvePlan.mockImplementationOnce(() => new Promise(() => undefined));
    renderPage();
    const plan = await screen.findByRole('region', { name: 'Plano da missão' });

    await userEvent.click(await screen.findByRole('button', { name: 'Aprovar plano' }));

    expect(
      within(plan).getByRole('button', { name: 'Renomear tarefa Login funciona' }),
    ).toBeDisabled();
    expect(
      within(plan).getByRole('button', { name: 'Remover tarefa Login funciona' }),
    ).toBeDisabled();
    expect(hub.api.missions.editPlanStep).not.toHaveBeenCalled();
  });

  it('editar uma tarefa chama editPlanStep com a missão, a tarefa e a edição, e busca a visão', async () => {
    const hub = installApi(viewOf());
    renderPage();
    const plan = await screen.findByRole('region', { name: 'Plano da missão' });
    const loads = hub.api.missions.get.mock.calls.length;

    await userEvent.click(
      within(plan).getByRole('button', { name: 'Renomear tarefa Login funciona' }),
    );
    await userEvent.type(within(plan).getByRole('textbox', { name: /Novo nome/ }), ' bem{Enter}');

    await waitFor(() =>
      expect(hub.api.missions.editPlanStep).toHaveBeenCalledWith({
        missionId: 'm1',
        stepId: 's1',
        edit: { op: 'rename', title: 'Login funciona bem' },
      }),
    );
    await waitFor(() => expect(hub.api.missions.get.mock.calls.length).toBeGreaterThan(loads));
  });

  it('falha ao editar aparece junto das tarefas, uma vez só', async () => {
    const hub = installApi(viewOf());
    hub.api.missions.editPlanStep.mockResolvedValueOnce({
      ok: false,
      error: {
        code: 'VALIDATION_FAILED',
        message: 'A tarefa não está mais neste plano.',
        retryable: false,
      },
    });
    renderPage();
    const plan = await screen.findByRole('region', { name: 'Plano da missão' });

    await userEvent.click(
      within(plan).getByRole('button', { name: 'Remover tarefa Login funciona' }),
    );
    await userEvent.click(within(plan).getByRole('button', { name: 'Remover' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'A tarefa não está mais neste plano.',
    );
    expect(within(plan).getByRole('alert')).toBeInTheDocument();
    expect(screen.getAllByRole('alert')).toHaveLength(1);
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
      await openActionsMenu();
      // O Radix marca o item desabilitado com aria-disabled, não com o atributo `disabled`.
      expect(screen.getByRole('menuitem', { name: 'Cancelar missão' })).not.toHaveAttribute(
        'aria-disabled',
        'true',
      );
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

describe('MissionPage: decisões no bloco, história na Conversa', () => {
  it('o cartão da aprovação pendente fica no bloco, uma vez só, e a decisão vai para approvals.decide', async () => {
    const hub = installApi(
      viewOf({ status: 'waiting_approval' }, { pendingApprovals: [APPROVAL] }),
    );
    renderPage();

    const decision = await screen.findByRole('region', { name: 'Sua decisão' });
    const card = within(decision).getByRole('region', { name: 'Gravar arquivo' });
    expect(screen.getAllByRole('region', { name: 'Gravar arquivo' })).toHaveLength(1);
    await userEvent.click(within(card).getByRole('button', { name: 'Aprovar' }));

    await waitFor(() =>
      expect(hub.api.approvals.decide).toHaveBeenCalledWith({
        approvalId: 'ap1',
        decision: 'approved',
      }),
    );
  });

  it('recusar a aprovação vai para approvals.decide como rejeitada', async () => {
    const hub = installApi(
      viewOf({ status: 'waiting_approval' }, { pendingApprovals: [APPROVAL] }),
    );
    renderPage();

    await userEvent.click(await screen.findByRole('button', { name: 'Recusar' }));

    await waitFor(() =>
      expect(hub.api.approvals.decide).toHaveBeenCalledWith({
        approvalId: 'ap1',
        decision: 'rejected',
      }),
    );
  });

  it('em revisão, o bloco oferece aprovar a conclusão, que vai para missions.approveReview', async () => {
    const hub = installApi(viewOf({ status: 'review' }));
    renderPage();

    const decision = await screen.findByRole('region', { name: 'Sua decisão' });
    await userEvent.click(within(decision).getByRole('button', { name: 'Aprovar conclusão' }));

    await waitFor(() => expect(hub.api.missions.approveReview).toHaveBeenCalledWith('m1'));
  });

  it('em revisão, pedir ajustes exige texto e envia o pedido aparado para missions.requestChanges', async () => {
    const hub = installApi(viewOf({ status: 'review' }));
    renderPage();

    const decision = await screen.findByRole('region', { name: 'Sua decisão' });
    const request = within(decision).getByRole('form', { name: 'Pedir ajustes' });
    const adjust = within(request).getByRole('button', { name: 'Pedir ajustes' });
    expect(adjust).toBeDisabled();

    await userEvent.type(within(request).getByLabelText('O que ajustar'), '  Trocar a função  ');
    await userEvent.click(adjust);

    await waitFor(() =>
      expect(hub.api.missions.requestChanges).toHaveBeenCalledWith({
        missionId: 'm1',
        feedback: 'Trocar a função',
      }),
    );
  });

  it('com o agente pedindo resposta, mostra a caixa e envia o texto', async () => {
    const hub = installApi(
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

    const answer = await screen.findByLabelText('Qual o nome do arquivo?');
    await userEvent.type(answer, 'notas.md');
    await userEvent.click(screen.getByRole('button', { name: 'Enviar resposta' }));

    await waitFor(() =>
      expect(hub.api.missions.provideInput).toHaveBeenCalledWith({
        missionId: 'm1',
        text: 'notas.md',
      }),
    );
    await waitFor(() => expect(answer).toHaveValue(''));
  });

  it('se o envio da resposta falha, o texto fica na caixa e o erro aparece no bloco', async () => {
    const hub = installApi(viewOf({ status: 'waiting_input' }));
    hub.api.missions.provideInput.mockResolvedValueOnce({
      ok: false,
      error: { code: 'MISSION_INVALID_STATE', message: 'A missão já seguiu.', retryable: false },
    } as unknown as typeof OK);
    renderPage();

    const answer = await screen.findByLabelText('O agente aguarda a sua resposta.');
    await userEvent.type(answer, 'notas.md');
    await userEvent.click(screen.getByRole('button', { name: 'Enviar resposta' }));

    const decision = screen.getByRole('region', { name: 'Sua decisão' });
    expect(await within(decision).findByRole('alert')).toHaveTextContent('A missão já seguiu.');
    expect(answer).toHaveValue('notas.md');
  });

  it.each<[MissionViewDto['mission']['status'], Partial<MissionViewDto>]>([
    ['waiting_approval', { pendingApprovals: [APPROVAL] }],
    ['waiting_input', {}],
    ['review', {}],
  ])(
    'com a missão em %s, a Conversa tem só a história: sem aprovar, recusar, responder nem pedir ajustes',
    async (status, rest) => {
      installApi(viewOf({ status }, rest));
      renderPage();

      const conversation = await screen.findByRole('tabpanel', { name: 'Conversa' });
      expect(within(conversation).queryByRole('button')).toBeNull();
      expect(within(conversation).queryByRole('textbox')).toBeNull();
      expect(within(conversation).queryByRole('form')).toBeNull();
      expect(within(conversation).queryByText('Aprovação necessária')).toBeNull();
      // Os controles existem uma vez só, no bloco.
      expect(
        within(screen.getByRole('region', { name: 'Sua decisão' })).getAllByRole('button').length,
      ).toBeGreaterThan(0);
    },
  );

  it('se a recarga falha, mantém a resposta digitada e mostra o erro da visão acima do plano, fora do bloco', async () => {
    const hub = installApi(
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
    const answer = await screen.findByLabelText('Qual o nome do arquivo?');
    await userEvent.type(answer, 'notas.md');

    hub.api.missions.get.mockResolvedValueOnce({
      ok: false,
      error: { code: 'UNKNOWN', message: 'Falha ao reler a missão.', retryable: true },
    } as unknown as AppResult<MissionViewDto>);
    hub.emit({ eventType: 'execution.paused' });

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Falha ao reler a missão.');
    // Falha de carregar a visão (e não de uma ação): fica no alto do corpo, não no bloco da decisão.
    const decision = screen.getByRole('region', { name: 'Sua decisão' });
    expect(decision).not.toContainElement(alert);
    const plan = screen.getByRole('region', { name: 'Plano da missão' });
    expect(alert.compareDocumentPosition(plan) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
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

describe('MissionPage: falha de uma ação (R3)', () => {
  it('a falha de uma ação da decisão aparece dentro do bloco, depois do botão, e em nenhum outro lugar', async () => {
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

    const decision = screen.getByRole('region', { name: 'Sua decisão' });
    const alert = await within(decision).findByRole('alert');
    expect(alert).toHaveTextContent('O agente não está disponível.');
    expect(screen.getAllByRole('alert')).toHaveLength(1);
    const button = within(decision).getByRole('button', { name: 'Iniciar missão' });
    expect(button.compareDocumentPosition(alert) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('o alerta do bloco some na ação seguinte', async () => {
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
    expect(await screen.findByRole('alert')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Iniciar missão' }));

    await waitFor(() => expect(screen.queryByRole('alert')).toBeNull());
  });

  it('a falha de uma ação do cabeçalho (excluir) fica junto do cabeçalho, não no bloco', async () => {
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

    await openActionsMenu(user);
    await user.click(screen.getByRole('menuitem', { name: 'Excluir missão' }));
    await user.click(screen.getByRole('button', { name: 'Excluir' }));

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('O worktree tem alterações não salvas.');
    expect(screen.getByRole('region', { name: 'Sua decisão' })).not.toContainElement(alert);
    const summary = screen.getByRole('region', { name: 'Resumo da missão' });
    expect(summary.compareDocumentPosition(alert) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(
      alert.compareDocumentPosition(screen.getByRole('region', { name: 'Plano da missão' })) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it('uma ação do cabeçalho que dá certo apaga a falha antiga que estava no bloco', async () => {
    const hub = installApi(viewOf({ status: 'queued' }));
    hub.api.missions.start.mockResolvedValueOnce({
      ok: false,
      error: {
        code: 'AGENT_UNAVAILABLE',
        message: 'O agente não está disponível.',
        retryable: true,
      },
    } as never);
    const user = userEvent.setup();
    renderPage();
    await user.click(await screen.findByRole('button', { name: 'Iniciar missão' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('O agente não está disponível.');

    await openActionsMenu(user);
    await user.click(screen.getByRole('menuitem', { name: 'Cancelar missão' }));

    await waitFor(() => expect(hub.api.missions.cancel).toHaveBeenCalledWith('m1'));
    await waitFor(() => expect(screen.queryByRole('alert')).toBeNull());
  });

  it('uma ação do bloco que dá certo apaga a falha antiga que estava no cabeçalho', async () => {
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
    await openActionsMenu(user);
    await user.click(screen.getByRole('menuitem', { name: 'Excluir missão' }));
    await user.click(screen.getByRole('button', { name: 'Excluir' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'O worktree tem alterações não salvas.',
    );

    await user.click(screen.getByRole('button', { name: 'Tentar de novo' }));

    await waitFor(() => expect(api.missions.retry).toHaveBeenCalledWith('m1'));
    await waitFor(() => expect(screen.queryByRole('alert')).toBeNull());
  });

  it('Retomar que falha mostra o erro no bloco, junto do botão', async () => {
    const hub = installApi(viewOf({ status: 'paused' }));
    hub.api.missions.resume.mockResolvedValueOnce({
      ok: false,
      error: {
        code: 'MISSION_INVALID_STATE',
        message: 'A missão não está pausada.',
        retryable: false,
      },
    } as never);
    renderPage();

    await userEvent.click(await screen.findByRole('button', { name: 'Retomar' }));

    const decision = screen.getByRole('region', { name: 'Sua decisão' });
    expect(await within(decision).findByRole('alert')).toHaveTextContent(
      'A missão não está pausada.',
    );
  });

  it('a falha da decisão de uma aprovação aparece no bloco', async () => {
    const hub = installApi(
      viewOf({ status: 'waiting_approval' }, { pendingApprovals: [APPROVAL] }),
    );
    hub.api.approvals.decide.mockResolvedValueOnce({
      ok: false,
      error: {
        code: 'MISSION_INVALID_STATE',
        message: 'A aprovação já foi decidida.',
        retryable: false,
      },
    } as never);
    renderPage();

    await userEvent.click(await screen.findByRole('button', { name: 'Aprovar' }));

    const decision = screen.getByRole('region', { name: 'Sua decisão' });
    expect(await within(decision).findByRole('alert')).toHaveTextContent(
      'A aprovação já foi decidida.',
    );
  });
});

describe('MissionPage: pausa, retomada e nova tentativa (R180, R181)', () => {
  it('com a missão em execução, Pausar chama pause e busca a visão de novo', async () => {
    const hub = installApi(viewOf({ status: 'running' }));
    renderPage();

    await openActionsMenu();
    await userEvent.click(screen.getByRole('menuitem', { name: 'Pausar' }));

    await waitFor(() => expect(hub.api.missions.pause).toHaveBeenCalledWith('m1'));
    expect(hub.api.missions.get.mock.calls.length).toBeGreaterThanOrEqual(2);
  });

  it('com a missão pausada, mostra Retomar sem Pausar, e Cancelar continua disponível', async () => {
    const hub = installApi(viewOf({ status: 'paused' }));
    renderPage();

    await userEvent.click(await screen.findByRole('button', { name: 'Retomar' }));

    await waitFor(() => expect(hub.api.missions.resume).toHaveBeenCalledWith('m1'));
    await openActionsMenu();
    expect(screen.queryByRole('menuitem', { name: 'Pausar' })).not.toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: 'Cancelar missão' })).toBeInTheDocument();
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

describe('MissionPage: Sua decisão à vista ao abrir', () => {
  let scrollIntoView: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    scrollIntoView = vi.fn();
    Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
      value: scrollIntoView,
      configurable: true,
      writable: true,
    });
  });

  afterEach(() => {
    Reflect.deleteProperty(HTMLElement.prototype, 'scrollIntoView');
  });

  it.each(['draft', 'planned', 'queued', 'paused', 'failed'] as const)(
    'abrir a missão %s rola até o bloco Sua decisão uma vez, sem mover o foco',
    async (status) => {
      installApi(viewOf({ status }));
      renderPage();

      const decision = await screen.findByRole('region', { name: 'Sua decisão' });
      await waitFor(() => expect(scrollIntoView).toHaveBeenCalledTimes(1));
      expect(scrollIntoView).toHaveBeenCalledWith({ block: 'nearest' });
      expect(scrollIntoView.mock.contexts[0]).toBe(decision);
      expect(decision.contains(document.activeElement)).toBe(false);
    },
  );

  it.each(['running', 'succeeded'] as const)(
    'a missão %s não espera nada da pessoa: não rola',
    async (status) => {
      installApi(viewOf({ status }));
      renderPage();

      await screen.findByRole('region', { name: 'Sua decisão' });
      expect(scrollIntoView).not.toHaveBeenCalled();
    },
  );

  it('recargas e eventos depois da abertura não rolam de novo', async () => {
    const hub = installApi(viewOf({ status: 'planned' }));
    renderPage();
    await waitFor(() => expect(scrollIntoView).toHaveBeenCalledTimes(1));

    hub.setView(viewOf({ status: 'queued' }));
    hub.emit({ eventType: 'mission.status_changed', payload: { from: 'planned', to: 'queued' } });
    await screen.findByRole('button', { name: /Iniciar/ });

    expect(scrollIntoView).toHaveBeenCalledTimes(1);
  });
});

describe('MissionPage: foco da decisão (R182)', () => {
  /** Verdadeiro quando o foco está dentro do elemento dado (ou no próprio elemento). */
  function focusIsIn(element: HTMLElement): boolean {
    return element.contains(document.activeElement);
  }

  it('com a missão aguardando sua aprovação, o foco vai para o bloco Sua decisão', async () => {
    installApi(viewOf({ status: 'waiting_approval' }, { pendingApprovals: [APPROVAL] }));
    renderPage();

    const decision = await screen.findByRole('region', { name: 'Sua decisão' });
    await waitFor(() => expect(decision).toHaveFocus());
    expect(within(decision).getByRole('region', { name: 'Gravar arquivo' })).toBeVisible();
  });

  it('em revisão, o foco vai para o bloco Sua decisão', async () => {
    installApi(viewOf({ status: 'review' }));
    renderPage();

    const decision = await screen.findByRole('region', { name: 'Sua decisão' });
    await waitFor(() => expect(decision).toHaveFocus());
  });

  it('com o agente aguardando resposta, o foco vai direto para a caixa de resposta, no bloco', async () => {
    installApi(viewOf({ status: 'waiting_input' }));
    renderPage();

    const answer = await screen.findByLabelText('O agente aguarda a sua resposta.');
    expect(answer.tagName).toBe('TEXTAREA');
    expect(screen.getByRole('region', { name: 'Sua decisão' })).toContainElement(answer);
    await waitFor(() => expect(answer).toHaveFocus());
  });

  it.each(['planned', 'queued', 'running', 'draft'] as const)(
    'com a missão %s, nada pede decisão e o foco não vai para o bloco',
    async (status) => {
      installApi(viewOf({ status }));
      renderPage();

      const decision = await screen.findByRole('region', { name: 'Sua decisão' });
      expect(focusIsIn(decision)).toBe(false);
    },
  );

  it('quando a missão passa a esperar a decisão com outra aba aberta, nada troca e nada toma o foco; o aviso fica na região de anúncio', async () => {
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

    const decision = screen.getByRole('region', { name: 'Sua decisão' });
    expect(await within(decision).findByRole('region', { name: 'Gravar arquivo' })).toBeVisible();
    expect(logsTab).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tab', { name: 'Conversa' })).toHaveAttribute('aria-selected', 'false');
    expect(logsTab).toHaveFocus();
    expect(focusIsIn(decision)).toBe(false);
    expect(document.querySelector('.decision-announce')).toHaveTextContent(
      'Aguardando você: aprovação, Gravar arquivo.',
    );
  });

  it('quando a missão passa a esperar a aprovação com a Conversa aberta, o foco vai para o bloco', async () => {
    const hub = installApi(viewOf({ status: 'running' }));
    renderPage();
    await screen.findByRole('tabpanel', { name: 'Conversa' });

    hub.setView(viewOf({ status: 'waiting_approval' }, { pendingApprovals: [APPROVAL] }));
    hub.emit({
      eventType: 'mission.status_changed',
      payload: { from: 'running', to: 'waiting_approval' },
    });

    const decision = await screen.findByRole('region', { name: 'Sua decisão' });
    await waitFor(() => expect(decision).toHaveFocus());
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

  it('uma nova aprovação com a missão já esperando aprovação não leva o foco de novo', async () => {
    const hub = installApi(
      viewOf({ status: 'waiting_approval' }, { pendingApprovals: [APPROVAL] }),
    );
    renderPage();
    const decision = await screen.findByRole('region', { name: 'Sua decisão' });
    await waitFor(() => expect(decision).toHaveFocus());
    (document.activeElement as HTMLElement).blur();

    hub.setView(
      viewOf(
        { status: 'waiting_approval' },
        { pendingApprovals: [APPROVAL, { ...APPROVAL, id: 'ap2', title: 'Rodar comando' }] },
      ),
    );
    hub.emit({ eventType: 'approval.requested', payload: {} });

    await screen.findByRole('region', { name: 'Rodar comando' });
    expect(focusIsIn(decision)).toBe(false);
  });

  it.each<[MissionViewDto['mission']['status'], Partial<MissionViewDto>, string[]]>([
    ['waiting_approval', { pendingApprovals: [APPROVAL] }, ['Aprovar', 'Recusar']],
    ['waiting_input', {}, ['Enviar resposta']],
    ['review', {}, ['Aprovar conclusão', 'Pedir ajustes']],
  ])(
    'com a missão em %s, o cabeçalho não tem ação principal: as decisões moram só no bloco',
    async (status, rest, labels) => {
      installApi(viewOf({ status }, rest));
      renderPage();

      const summary = await screen.findByRole('region', { name: 'Resumo da missão' });
      expect(
        within(summary)
          .getAllByRole('button')
          .map((button) => button.textContent),
      ).toEqual(['Mais ações']);
      expect(screen.queryByRole('button', { name: 'Ver decisão' })).toBeNull();
      expect(screen.queryByRole('button', { name: 'Ver a decisão' })).toBeNull();
      const decision = screen.getByRole('region', { name: 'Sua decisão' });
      expect(
        within(decision)
          .getAllByRole('button')
          .map((button) => button.textContent),
      ).toEqual(labels);
    },
  );

  it('a resposta não enviada continua na caixa depois de uma ação da missão', async () => {
    const hub = installApi(
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
    const answer = await screen.findByLabelText('Qual o nome do arquivo?');
    await userEvent.type(answer, 'notas');

    await openActionsMenu();
    await userEvent.click(screen.getByRole('menuitem', { name: 'Cancelar missão' }));

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

    await openActionsMenu();
    const pause = await screen.findByRole('menuitem', { name: 'Pausar' });
    expect(pause).not.toHaveAttribute('aria-disabled', 'true');
    await userEvent.click(pause);

    await waitFor(() => expect(hub.api.missions.pause).toHaveBeenCalledWith('m1'));
  });

  it('com o início pendente, Cancelar continua habilitado', async () => {
    const hub = installApi(viewOf({ status: 'queued' }));
    hub.api.missions.start.mockImplementation(() => new Promise<never>(() => undefined));
    renderPage();

    await userEvent.click(await screen.findByRole('button', { name: 'Iniciar missão' }));

    await openActionsMenu();
    expect(screen.getByRole('menuitem', { name: 'Cancelar missão' })).not.toHaveAttribute(
      'aria-disabled',
      'true',
    );
  });

  it('com uma pausa em curso, as ações do menu ficam desabilitadas até ela terminar', async () => {
    const hub = installApi(viewOf({ status: 'running' }));
    hub.api.missions.pause.mockImplementation(() => new Promise<never>(() => undefined));
    const user = userEvent.setup();
    renderPage();

    await openActionsMenu(user);
    await user.click(screen.getByRole('menuitem', { name: 'Pausar' }));
    await waitFor(() => expect(hub.api.missions.pause).toHaveBeenCalledWith('m1'));

    await openActionsMenu(user);
    expect(await screen.findByRole('menuitem', { name: 'Pausar' })).toHaveAttribute(
      'aria-disabled',
      'true',
    );
    expect(screen.getByRole('menuitem', { name: 'Cancelar missão' })).toHaveAttribute(
      'aria-disabled',
      'true',
    );
  });
});

// Ctrl+K vem do App, então o caso monta o App inteiro na rota da missão. Nesta montagem o clique não leva o
// foco ao campo (o separador da barra lateral fica focado no jsdom; a causa não foi investigada a fundo),
// então o teste põe o foco direto e segue com teclas de verdade.
describe('MissionPage: Ctrl+K sobre a resposta ao agente', () => {
  it('a paleta abre e fecha com Escape sem apagar o rascunho, e o foco volta ao campo', async () => {
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
    const user = userEvent.setup();
    render(
      <MemoryRouter initialEntries={['/workspaces/p1/missoes/m1']}>
        <App />
      </MemoryRouter>,
    );
    const campo = await screen.findByLabelText('Qual o nome do arquivo?');
    act(() => campo.focus());
    await user.keyboard('rascunho');
    expect(campo).toHaveValue('rascunho');

    await user.keyboard('{Control>}k{/Control}');
    expect(screen.getByRole('combobox')).toHaveFocus();
    await user.keyboard('{Escape}');

    expect(screen.queryByRole('combobox')).toBeNull();
    expect(campo).toHaveValue('rascunho');
    expect(campo).toHaveFocus();
  });
});

describe('MissionPage: gasto de tokens', () => {
  const execution = (id: string, usage?: { inputTokens: number; outputTokens: number }) => ({
    id,
    missionId: 'm1',
    attempt: 1,
    stepId: 's1',
    status: 'running' as const,
    ...(usage === undefined ? {} : { usage }),
  });

  it('a seção fica entre as tarefas e os arquivos alterados', async () => {
    installApi(viewOf({ status: 'running' }, { executions: [execution('e1', usageOf(100, 20))] }));
    renderPage();

    const plan = await screen.findByRole('region', { name: 'Plano da missão' });
    const usage = screen.getByRole('region', { name: 'Gasto de tokens' });
    const files = screen.getByRole('region', { name: 'Arquivos alterados' });
    expect(plan.compareDocumentPosition(usage) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(usage.compareDocumentPosition(files) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('sem nenhuma tentativa com gasto, a seção não aparece', async () => {
    installApi(viewOf({ status: 'running' }, { executions: [execution('e1')] }));
    renderPage();

    await screen.findByRole('region', { name: 'Plano da missão' });
    expect(screen.queryByRole('region', { name: 'Gasto de tokens' })).toBeNull();
  });

  it('um evento de gasto troca o número da tentativa, sem buscar a visão de novo', async () => {
    const { api, emitUsage } = installApi(
      viewOf({ status: 'running' }, { executions: [execution('e1', usageOf(100, 20))] }),
    );
    renderPage();

    const section = await screen.findByRole('region', { name: 'Gasto de tokens' });
    expect(within(section).getByText('120')).toBeInTheDocument();
    expect(api.missions.get).toHaveBeenCalledTimes(1);

    act(() => emitUsage({ missionId: 'm1', executionId: 'e1', usage: usageOf(1000, 234) }));

    // O evento traz o total da tentativa: o número substitui o anterior, não soma.
    expect(within(section).getByText('1.234')).toBeInTheDocument();
    expect(within(section).queryByText('120')).toBeNull();
    expect(api.missions.get).toHaveBeenCalledTimes(1);
  });

  it('um evento de gasto de outra missão ou de uma tentativa que a visão não tem é ignorado', async () => {
    const { api, emitUsage } = installApi(
      viewOf({ status: 'running' }, { executions: [execution('e1', usageOf(100, 20))] }),
    );
    renderPage();

    const section = await screen.findByRole('region', { name: 'Gasto de tokens' });
    act(() => {
      emitUsage({ missionId: 'outra', executionId: 'e1', usage: usageOf(9000, 9) });
      emitUsage({ missionId: 'm1', executionId: 'e9', usage: usageOf(8000, 8) });
    });

    expect(within(section).getByText('120')).toBeInTheDocument();
    expect(screen.queryByText('9.009')).toBeNull();
    expect(screen.queryByText('8.008')).toBeNull();
    expect(api.missions.get).toHaveBeenCalledTimes(1);
  });

  it('o primeiro gasto de uma tentativa que já está na visão faz a seção aparecer', async () => {
    const { emitUsage } = installApi(
      viewOf({ status: 'running' }, { executions: [execution('e1')] }),
    );
    renderPage();

    await screen.findByRole('region', { name: 'Plano da missão' });
    expect(screen.queryByRole('region', { name: 'Gasto de tokens' })).toBeNull();

    act(() => emitUsage({ missionId: 'm1', executionId: 'e1', usage: usageOf(5, 6) }));

    expect(await screen.findByRole('region', { name: 'Gasto de tokens' })).toBeInTheDocument();
  });

  it('cancela a assinatura do gasto ao sair da página', async () => {
    const { api, unsubscribeUsage } = installApi(viewOf({ status: 'running' }));
    const { unmount } = renderPage();
    await screen.findByRole('region', { name: 'Plano da missão' });
    expect(api.missions.subscribeUsage).toHaveBeenCalledTimes(1);
    expect(unsubscribeUsage).not.toHaveBeenCalled();

    unmount();

    expect(unsubscribeUsage).toHaveBeenCalledTimes(1);
  });
});

function usageOf(inputTokens: number, outputTokens: number) {
  return { inputTokens, outputTokens };
}
