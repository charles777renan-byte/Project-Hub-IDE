import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ApprovalDto, MissionEventDto, MissionViewDto } from '@project-hub/contracts';
import { describe, expect, it, vi } from 'vitest';
import { DecisionColumn } from '../../src/renderer/components/workspace/DecisionColumn';

const approval: ApprovalDto = {
  id: 'ap1',
  missionId: 'm1',
  executionId: 'e1',
  actionType: 'write_outside_worktree',
  title: 'Gravar arquivo',
  rationale: 'O roteiro pediu a gravação.',
  affectedResources: ['C:\\app\\x.md'],
  status: 'pending',
  requestedAt: '2026-10-20T09:00:00.000Z',
};

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
      status: 'running',
      altersCode: true,
      acceptanceCriteria: [{ id: 'c1', position: 1, text: 'Login funciona' }],
      createdAt: '2026-10-20T09:00:00.000Z',
      updatedAt: '2026-10-20T09:00:00.000Z',
      ...overrides,
    },
    project: { id: 'p1', name: 'app', path: 'C:\\app', defaultBranch: 'main' },
    steps: [],
    executions: [],
    pendingApprovals: [],
    events: [],
    ...rest,
  };
}

function inputRequested(prompt: string): MissionEventDto {
  return {
    id: 'ev1',
    missionId: 'm1',
    aggregateType: 'execution',
    aggregateId: 'e1',
    eventType: 'input.requested',
    severity: 'info',
    actor: 'agent',
    payload: { request: { id: 'entrada', prompt } },
    sequence: 1,
    createdAt: '2026-10-20T09:00:00.000Z',
  };
}

function renderColumn(view: MissionViewDto, onDecide = vi.fn()) {
  render(<DecisionColumn view={view} busy={false} onDecide={onDecide} />);
  return { onDecide };
}

describe('DecisionColumn: Aguardando você', () => {
  it('uma aprovação pendente aparece na coluna, com Aprovar e Recusar, e Aprovar envia approved', async () => {
    const { onDecide } = renderColumn(viewOf({}, { pendingApprovals: [approval] }));

    const column = screen.getByRole('region', { name: 'Aguardando você' });
    const card = within(column).getByRole('region', { name: 'Gravar arquivo' });
    await userEvent.click(within(card).getByRole('button', { name: 'Aprovar' }));
    await userEvent.click(within(card).getByRole('button', { name: 'Recusar' }));

    expect(onDecide).toHaveBeenNthCalledWith(1, 'ap1', 'approved');
    expect(onDecide).toHaveBeenNthCalledWith(2, 'ap1', 'rejected');
  });

  it('o contador conta as aprovações pendentes mais a pergunta do agente', () => {
    renderColumn(
      viewOf(
        { status: 'waiting_input' },
        {
          pendingApprovals: [approval],
          events: [inputRequested('Qual o nome do arquivo?')],
        },
      ),
    );

    const column = screen.getByRole('region', { name: 'Aguardando você' });
    expect(within(column).getByText('2')).toBeInTheDocument();
  });

  it('sem nenhum item, mostra "Nada espera por você" e o contador zerado', () => {
    renderColumn(viewOf());

    const column = screen.getByRole('region', { name: 'Aguardando você' });
    expect(within(column).getByText('Nada espera por você')).toBeInTheDocument();
    expect(within(column).getByText('0')).toBeInTheDocument();
    expect(within(column).queryByRole('button', { name: 'Aprovar' })).toBeNull();
  });

  it.each([
    ['draft', 'Gerar plano'],
    ['planned', 'Aprovar plano'],
    ['queued', 'Iniciar missão'],
  ] as const)(
    'com a missão em %s, a coluna diz que a ação "%s" é no painel Plano, e não "Nada espera por você"',
    (status, action) => {
      renderColumn(viewOf({ status }));

      const column = screen.getByRole('region', { name: 'Aguardando você' });
      expect(
        within(column).getByText(`Esta missão espera uma ação no painel Plano: ${action}.`),
      ).toBeInTheDocument();
      expect(within(column).queryByText('Nada espera por você')).toBeNull();
    },
  );

  it('com o agente aguardando resposta, mostra a pergunta e "Responda na Conversa."', () => {
    renderColumn(
      viewOf({ status: 'waiting_input' }, { events: [inputRequested('Qual o nome do arquivo?')] }),
    );

    const column = screen.getByRole('region', { name: 'Aguardando você' });
    expect(within(column).getByText('Qual o nome do arquivo?')).toBeInTheDocument();
    expect(within(column).getByText('Responda na Conversa.')).toBeInTheDocument();
    expect(within(column).queryByText('Nada espera por você')).toBeNull();
  });
});

describe('DecisionColumn: Critérios de aceite', () => {
  it('mostra os critérios na ordem de position, cada um com "○ não verificado"', () => {
    const criteria = [
      { id: 'c2', position: 2, text: 'Segundo critério' },
      { id: 'c1', position: 1, text: 'Primeiro critério' },
    ];
    renderColumn(viewOf({ acceptanceCriteria: criteria }));

    const panel = screen.getByRole('region', { name: 'Critérios de aceite' });
    const items = within(panel).getAllByRole('listitem');
    expect(items.map((item) => item.textContent)).toEqual([
      'Primeiro critério○ não verificado',
      'Segundo critério○ não verificado',
    ]);
    expect(within(panel).getAllByText('○ não verificado')).toHaveLength(2);
    // A ordenação copia o array: a ordem que o contrato entregou não muda.
    expect(criteria.map((criterion) => criterion.id)).toEqual(['c2', 'c1']);
  });
});

describe('DecisionColumn: Git', () => {
  it('mostra a branch padrão e "worktree ainda não criado" quando falta o caminho', () => {
    renderColumn(viewOf());

    const panel = screen.getByRole('region', { name: 'Git' });
    expect(within(panel).getByText('main')).toBeInTheDocument();
    expect(within(panel).getByText('worktree ainda não criado')).toBeInTheDocument();
    expect(within(panel).getByText('Push e merge exigem a sua aprovação.')).toBeInTheDocument();
  });

  it('com o caminho do worktree, diz "worktree criado"', () => {
    renderColumn(viewOf({ worktreePath: 'C:\\app\\.worktrees\\m1' }));

    const panel = screen.getByRole('region', { name: 'Git' });
    expect(within(panel).getByText('worktree criado')).toBeInTheDocument();
    expect(within(panel).queryByText('worktree ainda não criado')).toBeNull();
  });

  it('sem branch padrão, diz "sem branch"', () => {
    const view = viewOf();
    renderColumn({ ...view, project: { ...view.project, defaultBranch: undefined } });

    expect(
      within(screen.getByRole('region', { name: 'Git' })).getByText('sem branch'),
    ).toBeInTheDocument();
  });
});

describe('DecisionColumn: texto vindo do agente ou do Git', () => {
  it('markup na aprovação, no critério, na pergunta e na branch aparece como texto', () => {
    renderColumn(
      viewOf(
        {
          status: 'waiting_input',
          acceptanceCriteria: [{ id: 'c1', position: 1, text: '<b>negrito</b>' }],
        },
        {
          pendingApprovals: [{ ...approval, title: '<img src=x onerror=alert(1)>' }],
          events: [inputRequested('<i>pergunta</i>')],
          project: { id: 'p1', name: 'app', path: 'C:\\app', defaultBranch: '<b>main</b>' },
        },
      ),
    );

    expect(screen.getByText('<img src=x onerror=alert(1)>')).toBeInTheDocument();
    expect(screen.getByText('<b>negrito</b>')).toBeInTheDocument();
    expect(screen.getByText('<i>pergunta</i>')).toBeInTheDocument();
    expect(screen.getByText('<b>main</b>')).toBeInTheDocument();
    expect(document.querySelector('img, b, i')).toBeNull();
  });
});
