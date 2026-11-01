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
    expect(within(cards[1] as HTMLElement).getByText('Backend')).toBeInTheDocument();
  });

  it('cada cartão de papel tem a linha que descreve o papel', () => {
    render(
      <OrchestratorBoard
        steps={[
          stepOf('a', 1, 'frontend'),
          stepOf('b', 2, 'backend'),
          stepOf('c', 3, 'database'),
          stepOf('d', 4, 'docs'),
          stepOf('e', 5, 'qa'),
          stepOf('f', 6, 'general'),
        ]}
      />,
    );

    const lines = roleCards().map((card) => card.querySelector('.orchestrator-board__description'));
    expect(lines.map((line) => line?.textContent)).toEqual([
      'Interface e componentes',
      'APIs e lógica do sistema',
      'Modelagem e consultas',
      'README e guias de uso',
      'Testes e verificação',
      'Tarefas gerais',
    ]);
  });

  it('o cartão Frontend diz "Interface e componentes" e mostra o programa ao lado do nome', () => {
    render(<OrchestratorBoard steps={[stepOf('a', 1, 'frontend')]} />);

    const [card] = roleCards();
    const head = (card as HTMLElement).querySelector('.orchestrator-board__head');
    expect(head).toHaveTextContent('FrontendClaude');
    expect(within(card as HTMLElement).getByText('Interface e componentes')).toBeInTheDocument();
  });

  describe('integração e entrega', () => {
    function deliveryOf(statuses: MissionStepDto['status'][]): string {
      const { unmount } = render(
        <OrchestratorBoard
          steps={statuses.map((status, index) => stepOf(`t${index}`, index + 1, 'backend', status))}
        />,
      );
      const card = document.querySelector('.orchestrator-board__delivery');
      const text = card?.querySelector('.orchestrator-board__status')?.textContent;
      unmount();
      return text ?? '';
    }

    it('sem tarefa concluída, diz "aguardando tarefas"', () => {
      expect(deliveryOf(['pending', 'pending'])).toBe('aguardando tarefas');
      expect(deliveryOf(['running', 'pending'])).toBe('aguardando tarefas');
    });

    it('com todas as tarefas concluídas, diz "tarefas concluídas"', () => {
      expect(deliveryOf(['succeeded', 'succeeded'])).toBe('tarefas concluídas');
    });

    it('com uma tarefa que falhou, diz que a entrega está bloqueada', () => {
      expect(deliveryOf(['succeeded', 'failed'])).toBe('bloqueada: uma tarefa falhou');
    });
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

  function renderPanel(steps: MissionStepDto[], planning = true) {
    render(
      <PlanPanel
        mission={mission}
        steps={steps}
        busy={false}
        planning={planning}
        onEditStep={vi.fn()}
      />,
    );
  }

  it('mostra o quadro, sem a lista, quando há tarefas com papel e o plano é gerado', () => {
    renderPanel([stepOf('a', 1, 'backend'), stepOf('b', 2, 'frontend')]);

    expect(screen.getByRole('region', { name: 'Quadro do orquestrador' })).toBeInTheDocument();
    expect(screen.queryByRole('list', { name: 'Etapas do plano' })).toBeNull();
  });

  it('não mostra o quadro quando nenhuma tarefa tem papel, e a lista também fica de fora', () => {
    renderPanel([stepOf('a', 1, undefined)]);

    expect(screen.queryByRole('region', { name: 'Quadro do orquestrador' })).toBeNull();
    expect(screen.queryByRole('list', { name: 'Etapas do plano' })).toBeNull();
  });

  it('fora do planejamento, o quadro não aparece: só a lista de etapas', () => {
    renderPanel([stepOf('a', 1, 'backend'), stepOf('b', 2, 'frontend')], false);

    expect(screen.queryByRole('region', { name: 'Quadro do orquestrador' })).toBeNull();
    expect(screen.getByRole('list', { name: 'Etapas do plano' })).toBeInTheDocument();
  });
});
