import { act, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type {
  MissionEventDto,
  MissionViewDto,
  ProjectHubApi,
  TerminalSummary,
} from '@project-hub/contracts';
import { MemoryRouter, useLocation } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ConversationPanel } from '../../src/renderer/components/ConversationPanel';
import { MissionSummary } from '../../src/renderer/components/workspace/MissionSummary';
import { projectViewPath } from '../../src/renderer/routes';
import { readCss, ruleDeclarations } from './css-rules';

type Status = MissionViewDto['mission']['status'];

/** O rótulo do chip da missão planejada, que o evento de mudança de situação também cita. */
const PLANNED_LABEL = 'Aguarda aprovação do plano';

function eventOf(overrides: Partial<MissionEventDto>): MissionEventDto {
  return {
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
    ...overrides,
  };
}

/** A visão de uma missão no estado dado, com a história que leva até ele (criada e mudança de situação). */
function viewOf(status: Status): MissionViewDto {
  return {
    mission: {
      id: 'm1',
      projectId: 'p1',
      title: 'Ajustar login',
      objective: 'Corrigir o login',
      status,
      altersCode: false,
      acceptanceCriteria: [],
      createdAt: '2026-10-20T09:00:00.000Z',
      updatedAt: '2026-10-20T09:00:00.000Z',
    },
    project: { id: 'p1', name: 'app', path: 'C:\\app', defaultBranch: 'main' },
    steps: [],
    executions: [],
    pendingApprovals: [],
    events: [
      eventOf({ id: 'e1', eventType: 'mission.created', sequence: 1 }),
      eventOf({
        id: 'e2',
        eventType: 'mission.status_changed',
        payload: { from: 'draft', to: status },
        sequence: 2,
      }),
    ],
  };
}

function summaryOf(view: MissionViewDto) {
  const noop = vi.fn();
  return (
    <MissionSummary
      mission={view.mission}
      project={view.project}
      controlBusy={false}
      onPause={noop}
      onCancel={noop}
      onDelete={noop}
    />
  );
}

describe('MissionSummary: cabeçalho com título, chip e menu', () => {
  it('mostra o chip de situação uma vez', () => {
    const view = viewOf('planned');
    // O resumo e a aba Atividade ficam na mesma tela: a situação não pode aparecer nos dois.
    render(
      <MemoryRouter>
        {summaryOf(view)}
        <ConversationPanel view={view} />
      </MemoryRouter>,
    );

    expect(screen.getAllByText(new RegExp(PLANNED_LABEL))).toHaveLength(1);
    const summary = screen.getByRole('region', { name: 'Resumo da missão' });
    expect(within(summary).getByText(PLANNED_LABEL)).toBeInTheDocument();
  });

  it('não repete a situação na aba Atividade', () => {
    render(<ConversationPanel view={viewOf('planned')} />);

    // A história continua lá; só a linha "Situação: ..." sai.
    expect(screen.getByText('Missão criada.')).toBeInTheDocument();
    expect(screen.queryByText(/Situação:/)).not.toBeInTheDocument();
  });

  it.each<[Status, string[]]>([
    ['running', ['Pausar', 'Cancelar missão']],
    ['planned', ['Cancelar missão']],
    ['failed', ['Excluir missão']],
    ['succeeded', ['Excluir missão']],
  ])(
    'o menu "Mais ações" tem Pausar, Cancelar e Excluir, e não tem Aprovar (missão %s)',
    async (status, labels) => {
      const user = userEvent.setup();
      render(<MemoryRouter>{summaryOf(viewOf(status))}</MemoryRouter>);

      await user.click(screen.getByRole('button', { name: 'Mais ações' }));

      expect(screen.getAllByRole('menuitem').map((item) => item.textContent)).toEqual(labels);
      expect(screen.queryByRole('menuitem', { name: /aprovar/i })).not.toBeInTheDocument();
    },
  );

  it.each<Status>(['planned', 'waiting_approval', 'review'])(
    'a ação principal não fica no cabeçalho (missão %s): só sobra o menu "Mais ações"',
    (status) => {
      render(<MemoryRouter>{summaryOf(viewOf(status))}</MemoryRouter>);

      const summary = screen.getByRole('region', { name: 'Resumo da missão' });
      expect(
        within(summary)
          .getAllByRole('button')
          .map((button) => button.textContent),
      ).toEqual(['Mais ações']);
      expect(within(summary).queryByRole('button', { name: /aprovar/i })).not.toBeInTheDocument();
    },
  );
});

describe('MissionSummary: Ver no terminal', () => {
  const TERMINAL_STATE_PROBE = 'estado-da-rota';

  /** A missão com o worktree criado, que é quando o agente tem terminal. */
  function viewWithWorktree(status: Status): MissionViewDto {
    const view = viewOf(status);
    return { ...view, mission: { ...view.mission, worktreePath: 'C:\\app\\.worktrees\\m1' } };
  }

  function agentTerminal(overrides: Partial<TerminalSummary>): TerminalSummary {
    return {
      id: 't-agente',
      kind: 'agent',
      title: 'Claude · app',
      projectId: 'p1',
      projectName: 'app',
      missionId: 'm1',
      state: 'running',
      provider: 'claude',
      origin: 'new',
      ...overrides,
    };
  }

  function installTerminals(terminals: TerminalSummary[]) {
    window.projectHub = {
      terminals: { list: vi.fn(() => Promise.resolve({ ok: true, data: terminals })) },
    } as unknown as ProjectHubApi;
  }

  /** Mostra o estado da rota atual, que é por onde o pedido de foco chega à visão Terminais. */
  function RouteState() {
    const location = useLocation();
    return <p data-testid={TERMINAL_STATE_PROBE}>{JSON.stringify(location.state)}</p>;
  }

  /** A lista dos terminais chega depois da primeira pintura: deixa a resposta pendente entrar. */
  async function listArrives() {
    await act(async () => {
      await Promise.resolve();
    });
  }

  afterEach(() => {
    Reflect.deleteProperty(window, 'projectHub');
  });

  it('o botão "Ver no terminal" leva à visão Terminais do projeto', () => {
    render(<MemoryRouter>{summaryOf(viewWithWorktree('running'))}</MemoryRouter>);

    expect(screen.getByRole('link', { name: 'Ver no terminal' })).toHaveAttribute(
      'href',
      projectViewPath('p1', 'terminais'),
    );
  });

  it('com a sessão do agente da missão viva, leva a ela e a põe em foco', async () => {
    const user = userEvent.setup();
    installTerminals([
      agentTerminal({ id: 't-outra', missionId: 'm2' }),
      agentTerminal({ id: 't-encerrada', state: 'exited' }),
      agentTerminal({ id: 't-agente' }),
    ]);
    const view = viewWithWorktree('running');
    render(
      <MemoryRouter>
        {summaryOf(view)}
        <RouteState />
      </MemoryRouter>,
    );

    await listArrives();
    await user.click(screen.getByRole('link', { name: 'Ver no terminal' }));

    expect(screen.getByTestId(TERMINAL_STATE_PROBE)).toHaveTextContent(
      '{"showTerminal":"t-agente"}',
    );
  });

  it('sem sessão da missão na lista, leva só à visão, sem pedido de foco', async () => {
    const user = userEvent.setup();
    installTerminals([agentTerminal({ id: 't-outra', missionId: 'm2' })]);
    render(
      <MemoryRouter>
        {summaryOf(viewWithWorktree('running'))}
        <RouteState />
      </MemoryRouter>,
    );

    await listArrives();
    await user.click(screen.getByRole('link', { name: 'Ver no terminal' }));

    expect(screen.getByTestId(TERMINAL_STATE_PROBE)).toHaveTextContent('null');
  });

  it('sem worktree, a missão não tem terminal e o botão não aparece', () => {
    render(<MemoryRouter>{summaryOf(viewOf('planned'))}</MemoryRouter>);

    expect(screen.queryByRole('link', { name: 'Ver no terminal' })).not.toBeInTheDocument();
  });
});

describe('MissionSummary: cabeçalho enxuto', () => {
  function withWorktree(): MissionViewDto {
    const view = viewOf('review');
    return { ...view, mission: { ...view.mission, worktreePath: 'C:\\app\\.worktrees\\m1' } };
  }

  afterEach(() => {
    Reflect.deleteProperty(window, 'projectHub');
  });

  it('o "← Missões", o projeto e o worktree dividem a linha de cima, antes do título', () => {
    window.projectHub = {
      terminals: { list: vi.fn(() => Promise.resolve({ ok: true, data: [] })) },
    } as unknown as ProjectHubApi;
    render(<MemoryRouter>{summaryOf(withWorktree())}</MemoryRouter>);

    const header = screen.getByRole('region', { name: 'Resumo da missão' });
    const top = header.querySelector('.mission-head__top');
    expect(top).not.toBeNull();
    expect(header.firstElementChild).toBe(top);
    const inTop = within(top as HTMLElement);
    expect(inTop.getByRole('link', { name: /Missões/ })).toBeInTheDocument();
    expect(inTop.getByText(/Missão · app/i)).toBeInTheDocument();
    expect(inTop.getByRole('button', { name: 'Copiar caminho' })).toBeInTheDocument();
    expect(inTop.getByRole('link', { name: 'Ver no terminal' })).toBeInTheDocument();
    // O título, o objetivo, o selo e o menu ficam na linha de baixo.
    expect(inTop.queryByRole('heading', { name: 'Ajustar login' })).toBeNull();
    const row = header.querySelector('.mission-head__row');
    expect(top?.nextElementSibling).toBe(row);
    expect(header.children).toHaveLength(2);
    expect(
      within(row as HTMLElement).getByRole('heading', { name: 'Ajustar login' }),
    ).toBeVisible();
    expect(within(row as HTMLElement).getByRole('button', { name: 'Mais ações' })).toBeVisible();
  });

  it('sem worktree, a linha de cima só tem o "← Missões" e o projeto', () => {
    render(<MemoryRouter>{summaryOf(viewOf('review'))}</MemoryRouter>);

    const top = screen
      .getByRole('region', { name: 'Resumo da missão' })
      .querySelector<HTMLElement>('.mission-head__top');
    expect(top).not.toBeNull();
    expect(top?.querySelector('.mission-meta')).toBeNull();
    expect(within(top as HTMLElement).queryByRole('button', { name: 'Copiar caminho' })).toBeNull();
  });

  describe('folha de estilo (mission.css)', () => {
    const css = readCss('mission.css');

    it('a linha de cima é uma faixa que quebra de linha em janela estreita', () => {
      const top = ruleDeclarations(css, '.mission-head__top');
      expect(top.get('display')).toBe('flex');
      expect(top.get('flex-wrap')).toBe('wrap');
      expect(top.get('align-items')).toBe('center');
    });

    it('o worktree vai para a direita da linha de cima', () => {
      expect(ruleDeclarations(css, '.mission-head .mission-meta').get('margin-left')).toBe('auto');
    });

    it('o "Ver no terminal" é um botão baixo, para não engordar a linha', () => {
      expect(ruleDeclarations(css, '.mission-terminal-link').get('padding')).toBe(
        'var(--space-1) var(--space-3)',
      );
    });
  });
});
