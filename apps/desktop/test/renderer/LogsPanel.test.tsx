import { render, screen, within } from '@testing-library/react';
import type { MissionEventDto } from '@project-hub/contracts';
import { describe, expect, it } from 'vitest';
import { LogsPanel } from '../../src/renderer/components/workspace/LogsPanel';
import { formatTime } from '../../src/renderer/mission-text';

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

describe('LogsPanel', () => {
  it('lista cada evento com frase, hora e fonte, o mais recente primeiro', () => {
    render(
      <LogsPanel
        events={[
          event({
            id: 'a',
            eventType: 'plan.generated',
            createdAt: '2026-10-20T09:00:00.000Z',
            payload: { steps: [{}, {}] },
          }),
          event({
            id: 'b',
            eventType: 'approval.requested',
            createdAt: '2026-10-20T09:05:00.000Z',
            payload: { request: { title: 'Gravar arquivo' } },
          }),
          event({ id: 'c', eventType: 'usage.updated', payload: { usage: {} } }),
        ]}
      />,
    );

    const list = screen.getByRole('list', { name: 'Eventos do sistema' });
    const rows = within(list).getAllByRole('listitem');
    expect(rows).toHaveLength(2);
    expect(rows[0]).toHaveTextContent('Aprovação pedida: Gravar arquivo');
    expect(within(rows[0] as HTMLElement).getByText('Aprovação')).toBeInTheDocument();
    expect(rows[0]?.querySelector('time')).toHaveAttribute('dateTime', '2026-10-20T09:05:00.000Z');
    expect(rows[0]?.querySelector('time')).toHaveTextContent(
      formatTime('2026-10-20T09:05:00.000Z'),
    );
    expect(rows[1]).toHaveTextContent('Plano gerado com 2 etapas.');
    expect(within(rows[1] as HTMLElement).getByText('Plano')).toBeInTheDocument();
  });

  it('mostra a fonte de cada tipo de evento: git, execução e agente', () => {
    render(
      <LogsPanel
        events={[
          event({
            id: 'a',
            eventType: 'worktree.created',
            payload: { path: 'C:\\w' },
            createdAt: '2026-10-20T09:00:00.000Z',
          }),
          event({
            id: 'b',
            eventType: 'execution.paused',
            createdAt: '2026-10-20T09:01:00.000Z',
          }),
          event({
            id: 'c',
            eventType: 'session.completed',
            createdAt: '2026-10-20T09:02:00.000Z',
          }),
        ]}
      />,
    );

    const rows = within(screen.getByRole('list', { name: 'Eventos do sistema' })).getAllByRole(
      'listitem',
    );
    expect(within(rows[0] as HTMLElement).getByText('Agente')).toBeInTheDocument();
    expect(within(rows[1] as HTMLElement).getByText('Execução')).toBeInTheDocument();
    expect(within(rows[2] as HTMLElement).getByText('Git')).toBeInTheDocument();
  });

  it('com a mesma hora, o evento de sequência maior fica primeiro', () => {
    render(
      <LogsPanel
        events={[
          event({
            id: 'depois',
            eventType: 'approval.requested',
            sequence: 2,
            createdAt: '2026-10-20T09:00:00.000Z',
            payload: { request: { title: 'Gravar arquivo' } },
          }),
          event({
            id: 'antes',
            eventType: 'plan.generated',
            sequence: 1,
            createdAt: '2026-10-20T09:00:00.000Z',
            payload: { steps: [{}] },
          }),
        ]}
      />,
    );

    const rows = within(screen.getByRole('list', { name: 'Eventos do sistema' })).getAllByRole(
      'listitem',
    );
    expect(rows[0]).toHaveTextContent('Aprovação pedida: Gravar arquivo');
    expect(rows[1]).toHaveTextContent('Plano gerado com 1 etapa.');
  });

  it('mostra como texto o que parece HTML e não cria elemento img', () => {
    const { container } = render(
      <LogsPanel
        events={[event({ id: 'x', payload: { content: '<img src=x onerror=alert(1)>' } })]}
      />,
    );

    expect(screen.getByText('<img src=x onerror=alert(1)>')).toBeInTheDocument();
    expect(container.querySelector('img')).toBeNull();
  });

  it('com 300 eventos, mostra as 300 linhas numa só lista, a mais recente em cima', () => {
    const events = Array.from({ length: 300 }, (_, index) =>
      event({
        id: `e${index}`,
        sequence: index + 1,
        createdAt: new Date(Date.UTC(2026, 9, 20, 9, 0, index)).toISOString(),
        payload: { content: `linha ${index}` },
      }),
    );
    render(<LogsPanel events={events} />);

    const list = screen.getByRole('list', { name: 'Eventos do sistema' });
    const rows = within(list).getAllByRole('listitem');
    expect(rows).toHaveLength(300);
    expect(rows[0]).toHaveTextContent('linha 299');
    expect(rows[299]).toHaveTextContent('linha 0');
  });

  it('sem evento com frase, diz que ainda não há nenhum', () => {
    render(<LogsPanel events={[event({ eventType: 'usage.updated', payload: {} })]} />);

    expect(screen.getByText('Nenhum evento ainda.')).toBeInTheDocument();
    expect(screen.queryByRole('list')).toBeNull();
  });
});
