import { render, screen, within } from '@testing-library/react';
import type { MissionDto, MissionStepDto } from '@project-hub/contracts';
import { describe, expect, it, vi } from 'vitest';
import { OrchestratorBoard } from '../../src/renderer/components/OrchestratorBoard';
import { PlanPanel } from '../../src/renderer/components/PlanPanel';

function stepOf(
  id: string,
  position: number,
  role: MissionStepDto['role'],
  status: MissionStepDto['status'] = 'pending',
): MissionStepDto {
  return {
    id,
    position,
    title: `Tarefa ${id}`,
    status,
    agent: 'claude-code',
    ...(role === undefined ? {} : { role }),
  };
}

function roleCards(): HTMLElement[] {
  const board = screen.getByRole('region', { name: 'Quadro do orquestrador' });
  return within(within(board).getByRole('list')).getAllByRole('listitem');
}

describe('OrchestratorBoard', () => {
  it('mostra o orquestrador, um cartão por papel (não por tarefa) e a integração', () => {
    render(
      <OrchestratorBoard
        steps={[stepOf('a', 1, 'frontend'), stepOf('b', 2, 'backend'), stepOf('c', 3, 'backend')]}
      />,
    );

    expect(screen.getByText('Orquestrador principal')).toBeInTheDocument();
    expect(
      screen.getByText('Analisa o pedido, planeja tarefas e acompanha os resultados'),
    ).toBeInTheDocument();
    expect(screen.getByText('Integração e entrega')).toBeInTheDocument();
    expect(
      screen.getByText(
        'Reúne alterações, executa verificações e apresenta o resultado para aprovação',
      ),
    ).toBeInTheDocument();

    const cards = roleCards();
    expect(cards).toHaveLength(2);
    expect(within(cards[0] as HTMLElement).getByText('Frontend')).toBeInTheDocument();
    expect(within(cards[0] as HTMLElement).getByText('1 tarefa')).toBeInTheDocument();
    expect(within(cards[1] as HTMLElement).getByText('Backend')).toBeInTheDocument();
    expect(within(cards[1] as HTMLElement).getByText('2 tarefas')).toBeInTheDocument();
  });

  it('ordena os cartões pela posição da primeira tarefa de cada papel', () => {
    render(
      <OrchestratorBoard
        steps={[stepOf('a', 1, 'qa'), stepOf('b', 2, 'database'), stepOf('c', 3, 'qa')]}
      />,
    );

    const names = roleCards().map((card) => within(card).getByRole('heading').textContent);
    expect(names).toEqual(['QA', 'Banco de dados']);
  });

  it('mostra o nome do programa como texto em cada cartão', () => {
    render(<OrchestratorBoard steps={[stepOf('a', 1, 'frontend'), stepOf('b', 2, 'backend')]} />);

    for (const card of roleCards()) {
      expect(within(card).getByText('Claude')).toBeInTheDocument();
    }
  });

  it('não repete o programa quando várias tarefas do papel usam o mesmo', () => {
    render(
      <OrchestratorBoard
        steps={[stepOf('a', 1, 'backend'), stepOf('b', 2, 'backend'), stepOf('c', 3, 'backend')]}
      />,
    );

    const [card] = roleCards();
    expect(within(card as HTMLElement).getAllByText('Claude')).toHaveLength(1);
  });

  describe('estado agregado do papel', () => {
    function stateOf(statuses: MissionStepDto['status'][]): string {
      const { unmount } = render(
        <OrchestratorBoard
          steps={statuses.map((status, index) => stepOf(`t${index}`, index + 1, 'backend', status))}
        />,
      );
      const [card] = roleCards();
      const text = (card as HTMLElement).querySelector('.orchestrator-board__status')?.textContent;
      unmount();
      return text ?? '';
    }

    it('qualquer falha vence: "falhou"', () => {
      expect(stateOf(['succeeded', 'failed', 'pending'])).toBe('falhou');
    });

    it('falha vence andamento', () => {
      expect(stateOf(['running', 'failed'])).toBe('falhou');
    });

    it('sem falha, qualquer tarefa em andamento: "em andamento"', () => {
      expect(stateOf(['succeeded', 'running', 'pending'])).toBe('em andamento');
    });

    it('todas concluídas: "concluído"', () => {
      expect(stateOf(['succeeded', 'succeeded'])).toBe('concluído');
    });

    it('o resto: "aguardando"', () => {
      expect(stateOf(['pending', 'pending'])).toBe('aguardando');
    });

    it('concluídas misturadas com pendentes ou bloqueadas: "aguardando"', () => {
      expect(stateOf(['succeeded', 'blocked'])).toBe('aguardando');
      expect(stateOf(['succeeded', 'pending'])).toBe('aguardando');
    });
  });

  it('não renderiza nada sem tarefas com papel', () => {
    const { container } = render(
      <OrchestratorBoard steps={[stepOf('a', 1, undefined), stepOf('b', 2, undefined)]} />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it('não renderiza nada sem tarefas', () => {
    const { container } = render(<OrchestratorBoard steps={[]} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('as setas entre as camadas são decorativas (aria-hidden)', () => {
    render(<OrchestratorBoard steps={[stepOf('a', 1, 'backend')]} />);
    const board = screen.getByRole('region', { name: 'Quadro do orquestrador' });
    const arrows = board.querySelectorAll('.orchestrator-board__arrow');
    expect(arrows).toHaveLength(2);
    for (const arrow of arrows) expect(arrow).toHaveAttribute('aria-hidden', 'true');
  });
});

describe('PlanPanel com o quadro do orquestrador', () => {
  const mission: MissionDto = {
    id: 'm1',
    projectId: 'p1',
    title: 'Ajustar login',
    objective: 'Corrigir o login',
    status: 'planned',
    altersCode: false,
    acceptanceCriteria: [],
    createdAt: '2026-10-20T09:00:00.000Z',
    updatedAt: '2026-10-20T09:00:00.000Z',
  };

  function renderPanel(steps: MissionStepDto[]) {
    render(
      <PlanPanel
        mission={mission}
        steps={steps}
        busy={false}
        planning={false}
        onEditStep={vi.fn()}
        onRequestNewPlan={vi.fn()}
      />,
    );
  }

  it('mostra o quadro acima da tabela quando há tarefas com papel', () => {
    renderPanel([stepOf('a', 1, 'backend'), stepOf('b', 2, 'frontend')]);

    const board = screen.getByRole('region', { name: 'Quadro do orquestrador' });
    const table = screen.getByRole('table', { name: 'Etapas do plano' });
    expect(board.compareDocumentPosition(table) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('não mostra o quadro quando nenhuma tarefa tem papel', () => {
    renderPanel([stepOf('a', 1, undefined)]);

    expect(screen.queryByRole('region', { name: 'Quadro do orquestrador' })).toBeNull();
    expect(screen.getByRole('table', { name: 'Etapas do plano' })).toBeInTheDocument();
  });
});
