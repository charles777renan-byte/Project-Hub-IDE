import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { MissionViewDto } from '@project-hub/contracts';
import { describe, expect, it, vi } from 'vitest';
import { DecisionBlock } from '../../src/renderer/components/mission/DecisionBlock';

function viewOf(
  status: MissionViewDto['mission']['status'],
  rest: Partial<MissionViewDto> = {},
): MissionViewDto {
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
    events: [],
    ...rest,
  };
}

function setup(
  status: MissionViewDto['mission']['status'],
  props: { busy?: boolean; planning?: boolean; controlBusy?: boolean } = {},
  rest: Partial<MissionViewDto> = {},
) {
  const handlers = {
    onGeneratePlan: vi.fn(),
    onApprovePlan: vi.fn(),
    onStart: vi.fn(),
    onResume: vi.fn(),
    onRetry: vi.fn(),
    onOpenDecision: vi.fn(),
  };
  render(
    <DecisionBlock
      view={viewOf(status, rest)}
      busy={props.busy ?? false}
      planning={props.planning ?? false}
      controlBusy={props.controlBusy ?? false}
      {...handlers}
    />,
  );
  return handlers;
}

const PRIMARY = [
  ['draft', 'Orquestrar', 'onGeneratePlan'],
  ['planned', 'Aprovar plano', 'onApprovePlan'],
  ['queued', 'Iniciar missão', 'onStart'],
  ['paused', 'Retomar', 'onResume'],
  ['failed', 'Tentar de novo', 'onRetry'],
  ['cancelled', 'Tentar de novo', 'onRetry'],
] as const;

const NO_PRIMARY = ['running', 'waiting_approval', 'waiting_input', 'review', 'succeeded'] as const;

describe('DecisionBlock', () => {
  it('é a região "Sua decisão"', () => {
    setup('draft');

    expect(screen.getByRole('region', { name: 'Sua decisão' })).toBeInTheDocument();
  });

  it.each(PRIMARY)(
    'com a missão %s, a ação principal é "%s" e chama o comportamento',
    async (status, label, handler) => {
      const user = userEvent.setup();
      const handlers = setup(status);

      await user.click(screen.getByRole('button', { name: label }));

      expect(handlers[handler]).toHaveBeenCalledTimes(1);
      expect(screen.getAllByRole('button')).toHaveLength(1);
    },
  );

  it.each(NO_PRIMARY)('com a missão %s não há ação principal', (status) => {
    setup(status);

    expect(
      screen.queryByRole('button', {
        name: /Orquestrar|Aprovar plano|Iniciar|Retomar|Tentar de novo/,
      }),
    ).toBeNull();
  });

  it('Aprovar plano leva a aparência de decisão', () => {
    setup('planned');

    expect(screen.getByRole('button', { name: 'Aprovar plano' })).toHaveClass('btn-decision');
  });

  it('Orquestrar mostra o aviso da cota, que descreve o botão', () => {
    setup('draft');

    expect(screen.getByRole('button', { name: 'Orquestrar' })).toHaveAccessibleDescription(
      'Planejar usa a cota do seu Claude.',
    );
  });

  it('o aviso da cota não aparece onde não há planejamento', () => {
    setup('planned');

    expect(screen.queryByText('Planejar usa a cota do seu Claude.')).toBeNull();
  });

  it('enquanto planeja, o Orquestrar mostra "Planejando…" e fica desabilitado', () => {
    setup('draft', { busy: true, planning: true });

    expect(screen.getByRole('button', { name: 'Planejando…' })).toBeDisabled();
  });

  it.each([
    ['planned', 'Aprovar plano'],
    ['queued', 'Iniciar missão'],
    ['failed', 'Tentar de novo'],
  ] as const)('com uma chamada longa em curso, a missão %s desabilita "%s"', (status, label) => {
    setup(status, { busy: true });

    expect(screen.getByRole('button', { name: label })).toBeDisabled();
  });

  it('Retomar segue o bloqueio dos controles, não o das chamadas longas', () => {
    setup('paused', { busy: true });

    expect(screen.getByRole('button', { name: 'Retomar' })).toBeEnabled();
  });

  it('Retomar fica desabilitado com um controle em curso', () => {
    setup('paused', { controlBusy: true });

    expect(screen.getByRole('button', { name: 'Retomar' })).toBeDisabled();
  });

  it('a região de aviso já existe, vazia, sem decisão pendente', () => {
    setup('running');

    const region = document.querySelector('[role="status"].decision-status');
    expect(region).not.toBeNull();
    expect(region).toHaveAttribute('aria-live', 'polite');
    expect(region).toBeEmptyDOMElement();
  });

  it('com decisão pendente, o aviso "Aguardando você" leva à decisão', async () => {
    const user = userEvent.setup();
    const handlers = setup('waiting_input');

    expect(screen.getByText('Aguardando você')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Ver a decisão' }));
    expect(handlers.onOpenDecision).toHaveBeenCalledTimes(1);
  });

  // Chegam na Tarefa 7 da reestruturação, quando o bloco passa a abrigar as decisões.
  it.todo('Planejar de novo com instrução opcional, ao lado de Aprovar plano');
  it.todo('os cartões de aprovação e de pergunta do agente moram no bloco');
});
