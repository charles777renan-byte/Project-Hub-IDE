import { render, screen, within } from '@testing-library/react';
import type { ExecutionDto, MissionDto } from '@project-hub/contracts';
import { describe, expect, it } from 'vitest';
import { MissionFlow } from '../../src/renderer/components/workspace/MissionFlow';

// A faixa "Objetivo → Plano → …" saiu da página da missão. O componente segue no código até a limpeza da
// reestruturação (Tarefa 8), e este teste guarda o que a página cobria dele.

function missionOf(status: MissionDto['status']): MissionDto {
  return {
    id: 'm1',
    projectId: 'p1',
    title: 'Ajustar login',
    objective: 'Corrigir o login',
    status,
    altersCode: false,
    acceptanceCriteria: [{ id: 'c1', position: 1, text: 'Login funciona' }],
    createdAt: '2026-10-20T09:00:00.000Z',
    updatedAt: '2026-10-20T09:00:00.000Z',
  };
}

function renderFlow(status: MissionDto['status'], executions: ExecutionDto[] = []) {
  const props = {
    steps: [],
    events: [],
    diff: undefined,
    conclusion: undefined,
    executions,
  };
  const view = render(<MissionFlow mission={missionOf(status)} {...props} />);
  return {
    rerender: (next: MissionDto['status']) =>
      view.rerender(<MissionFlow mission={missionOf(next)} {...props} />),
  };
}

const items = () =>
  within(screen.getByRole('list', { name: 'Fluxo da missão' })).getAllByRole('listitem');

describe('MissionFlow', () => {
  it('mostra as cinco etapas, e a em curso leva aria-current', () => {
    renderFlow('planned');

    expect(items().map((item) => item.querySelector('strong')?.textContent)).toEqual([
      'Objetivo',
      'Plano',
      'Execução',
      'Verificação',
      'Revisão',
    ]);
    const current = items().filter((item) => item.getAttribute('aria-current') === 'step');
    expect(current).toHaveLength(1);
    expect(current[0]).toHaveTextContent('Plano');
    expect(current[0]).toHaveTextContent('Aguardando sua aprovação');
  });

  it('em revisão, a Revisão é a etapa em curso e a execução está concluída', () => {
    renderFlow('review', [{ id: 'e1', missionId: 'm1', attempt: 1, status: 'succeeded' }]);

    expect(items()[2]).toHaveTextContent('Tentativa 1 · Concluída');
    expect(items()[4]).toHaveAttribute('aria-current', 'step');
    expect(items()[4]).toHaveTextContent('Aguardando sua aprovação');
  });

  it('em andamento, a execução mostra a tentativa', () => {
    renderFlow('running', [{ id: 'e1', missionId: 'm1', attempt: 1, status: 'running' }]);

    expect(items()[2]).toHaveTextContent('Tentativa 1 · Em andamento');
  });

  it('a etapa muda quando a situação da missão muda', () => {
    const flow = renderFlow('running');
    expect(items()[2]).toHaveAttribute('aria-current', 'step');

    flow.rerender('review');

    expect(items()[4]).toHaveAttribute('aria-current', 'step');
  });
});
