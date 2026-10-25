import { render, screen } from '@testing-library/react';
import type { MissionEventDto } from '@project-hub/contracts';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Timeline } from '../../src/renderer/components/Timeline';
import { describeEvent, lastInputPrompt } from '../../src/renderer/mission-text';

function event(overrides: Partial<MissionEventDto>): MissionEventDto {
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

describe('Timeline', () => {
  it('mostra uma linha por evento com frase, e deixa de fora os que não têm frase', () => {
    render(
      <Timeline
        events={[
          event({ id: 'a', payload: { content: 'Vou aplicar o plano.' } }),
          event({ id: 'b', eventType: 'usage.updated', payload: { usage: {} } }),
          event({
            id: 'c',
            eventType: 'approval.requested',
            payload: { request: { title: 'Gravar' } },
          }),
        ]}
      />,
    );

    const list = screen.getByRole('list', { name: 'Eventos da missão' });
    expect(list.querySelectorAll('li')).toHaveLength(2);
    expect(screen.getByText('Vou aplicar o plano.')).toBeInTheDocument();
    expect(screen.getByText('Aprovação pedida: Gravar')).toBeInTheDocument();
  });

  it('sem eventos com frase, mostra o estado vazio', () => {
    render(<Timeline events={[]} />);

    expect(screen.getByText('Nenhum evento ainda.')).toBeInTheDocument();
  });

  it('texto do agente entra como texto, sem interpretar HTML', () => {
    render(<Timeline events={[event({ payload: { content: '<img src=x onerror=alert(1)>' } })]} />);

    expect(screen.getByText('<img src=x onerror=alert(1)>')).toBeInTheDocument();
    expect(document.querySelector('img')).toBeNull();
  });
});

describe('Timeline, horário de cada evento', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-21T15:00:00'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('mostra o horário relativo ou a data, e mantém o valor original no atributo dateTime', () => {
    render(
      <Timeline
        events={[
          event({ id: 'a', createdAt: '2026-10-19T14:02:00', payload: { content: 'Antigo.' } }),
          event({ id: 'b', createdAt: '2026-10-21T14:55:00', payload: { content: 'Recente.' } }),
        ]}
      />,
    );

    const rows = screen.getAllByRole('listitem');
    const antigo = rows.find((row) => row.textContent?.includes('Antigo.'))?.querySelector('time');
    const recente = rows
      .find((row) => row.textContent?.includes('Recente.'))
      ?.querySelector('time');
    expect(antigo).toHaveTextContent('19/10 14:02');
    expect(antigo).toHaveAttribute('dateTime', '2026-10-19T14:02:00');
    expect(recente).toHaveTextContent('há 5 min');
    expect(recente).toHaveAttribute('dateTime', '2026-10-21T14:55:00');
  });
});

describe('describeEvent', () => {
  it('lê o motivo de falha de uma sessão', () => {
    expect(
      describeEvent(
        event({ eventType: 'session.failed', payload: { error: { message: 'Caiu.' } } }),
      ),
    ).toBe('Falha: Caiu.');
  });

  it('escreve o número de etapas do plano no singular e no plural', () => {
    expect(describeEvent(event({ eventType: 'plan.generated', payload: { steps: ['a'] } }))).toBe(
      'Plano gerado com 1 etapa.',
    );
    expect(
      describeEvent(event({ eventType: 'plan.generated', payload: { steps: ['a', 'b'] } })),
    ).toBe('Plano gerado com 2 etapas.');
  });

  it('pega a pergunta do último pedido de entrada', () => {
    const events = [
      event({
        id: '1',
        eventType: 'input.requested',
        payload: { request: { prompt: 'Qual o nome?' } },
      }),
      event({
        id: '2',
        eventType: 'input.requested',
        payload: { request: { prompt: 'Qual a cor?' } },
      }),
    ];

    expect(lastInputPrompt(events)).toBe('Qual a cor?');
    expect(lastInputPrompt([])).toBeUndefined();
  });
});
