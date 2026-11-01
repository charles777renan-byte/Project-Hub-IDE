import { render, screen, within } from '@testing-library/react';
import type { MissionDto, MissionStepDto } from '@project-hub/contracts';
import { describe, expect, it } from 'vitest';
import { TaskTimeline } from '../../src/renderer/components/progress/TaskTimeline';
import { buildTimeline, type ProgressMission } from '../../src/renderer/progress-data';

/** Linha do tempo das tarefas: tabela com estado, papel, barra no tempo (SVG sem style) e duração. */

const NOW = new Date('2026-10-28T10:40:00.000Z');
const FALLBACK_END = '2026-10-28T10:30:00.000Z';

function task(
  position: number,
  status: MissionStepDto['status'],
  extra: Partial<MissionStepDto> = {},
): MissionStepDto {
  return {
    id: `t${position}`,
    position,
    title: `Tarefa ${position}`,
    status,
    role: 'backend',
    agent: 'claude-code',
    ...extra,
  };
}

function progress(
  tasks: MissionStepDto[],
  status: MissionDto['status'] = 'running',
): ProgressMission {
  return {
    mission: {
      id: 'm1',
      projectId: 'p1',
      title: 'Pagamentos',
      objective: 'Objetivo',
      status,
      altersCode: true,
      acceptanceCriteria: [],
      startedAt: '2026-10-28T10:00:00.000Z',
      createdAt: '2026-10-28T09:00:00.000Z',
      updatedAt: FALLBACK_END,
    },
    group: 'running',
    tasks,
    done: tasks.filter((t) => t.status === 'succeeded').length,
    total: tasks.length,
    current: tasks.find((t) => t.status === 'running'),
  };
}

const FIVE: MissionStepDto[] = [
  task(1, 'succeeded', {
    role: 'database',
    startedAt: '2026-10-28T10:00:00.000Z',
    finishedAt: '2026-10-28T10:10:00.000Z',
  }),
  task(2, 'succeeded', {
    role: 'backend',
    dependsOn: ['t1'],
    startedAt: '2026-10-28T10:10:00.000Z',
    finishedAt: '2026-10-28T10:25:00.000Z',
  }),
  task(3, 'running', { role: 'frontend', startedAt: '2026-10-28T10:25:00.000Z' }),
  task(4, 'pending', { role: 'qa', dependsOn: ['t3'] }),
  task(5, 'pending', { role: 'docs', dependsOn: ['t1', 't2'] }),
];

/** O mesmo arredondamento do componente: até 2 casas, em porcentagem. */
function percent(value: number): string {
  return `${Number(value.toFixed(2))}%`;
}

function bodyRows(): HTMLElement[] {
  return within(screen.getByRole('table')).getAllByRole('row').slice(1);
}

describe('TaskTimeline', () => {
  it('é uma tabela "Tarefas de {título}" com uma linha por tarefa e as três colunas', () => {
    render(<TaskTimeline item={progress(FIVE)} now={NOW} />);

    const table = screen.getByRole('table', { name: 'Tarefas de Pagamentos' });
    const headers = within(table)
      .getAllByRole('columnheader')
      .map((header) => header.textContent);
    expect(headers[0]).toBe('Tarefa');
    expect(headers[1]).toBe('Papel · programa');
    expect(headers[2]).toMatch(/^Tempo/);
    // Cabeçalho + cinco tarefas.
    expect(within(table).getAllByRole('row')).toHaveLength(6);
  });

  it('cada linha mostra título, papel · programa, dependência, estado como imagem e duração', () => {
    render(<TaskTimeline item={progress(FIVE)} now={NOW} />);
    const rows = bodyRows();

    const first = rows[0] as HTMLElement;
    expect(within(first).queryByText(/depois de/)).toBeNull();
    expect(within(first).getByText('Banco de dados · Claude')).toBeInTheDocument();

    const second = rows[1] as HTMLElement;
    expect(within(second).getByText('Tarefa 2')).toBeInTheDocument();
    expect(within(second).getByText('Backend · Claude')).toBeInTheDocument();
    expect(within(second).getByText('depois de 1')).toBeInTheDocument();
    expect(within(second).getByRole('img', { name: 'Concluída' })).toBeInTheDocument();
    expect(within(second).getByText('15 min')).toBeInTheDocument();

    const third = rows[2] as HTMLElement;
    expect(within(third).getByRole('img', { name: 'Em execução' })).toBeInTheDocument();
    expect(within(third).getByText('Frontend · Claude')).toBeInTheDocument();
    expect(within(third).getByText('15 min…')).toBeInTheDocument();

    const fifth = rows[4] as HTMLElement;
    expect(within(fifth).getByRole('img', { name: 'Pendente' })).toBeInTheDocument();
    expect(within(fifth).getByText('depois de 1 e 2')).toBeInTheDocument();
  });

  it('tarefa pendente mostra "na fila" e não tem barra; as outras têm <rect> com x e width em porcentagem', () => {
    const { container } = render(<TaskTimeline item={progress(FIVE)} now={NOW} />);
    const rows = bodyRows();

    for (const index of [3, 4]) {
      const row = rows[index] as HTMLElement;
      expect(within(row).getByText('na fila')).toBeInTheDocument();
      expect(row.querySelector('rect')).toBeNull();
    }
    expect(container.querySelectorAll('rect')).toHaveLength(3);

    const timeline = buildTimeline(FIVE, {
      now: NOW,
      missionRunning: true,
      fallbackEnd: FALLBACK_END,
    });
    const bar = timeline.bars['t2'];
    if (bar === undefined) throw new Error('barra da tarefa 2 ausente');
    const rect = (rows[1] as HTMLElement).querySelector('rect');
    expect(rect).toHaveAttribute('x', percent(bar.left));
    expect(rect).toHaveAttribute('width', percent(bar.width));
    expect(rect).toHaveAttribute('class', 'progress-bar progress-bar--succeeded');
    expect((rows[2] as HTMLElement).querySelector('rect')).toHaveClass('progress-bar--running');
  });

  it('nenhum elemento leva o atributo style (CSP)', () => {
    const { container } = render(<TaskTimeline item={progress(FIVE)} now={NOW} />);
    expect(container.querySelectorAll('[style]')).toHaveLength(0);
  });

  it('com a missão em execução desenha a linha do "agora" na posição calculada', () => {
    const { container } = render(<TaskTimeline item={progress(FIVE)} now={NOW} />);
    const timeline = buildTimeline(FIVE, {
      now: NOW,
      missionRunning: true,
      fallbackEnd: FALLBACK_END,
    });
    const lines = container.querySelectorAll('line');
    expect(lines.length).toBeGreaterThan(0);
    for (const line of lines) {
      expect(line).toHaveClass('progress-now');
      expect(line).toHaveAttribute('x1', percent(timeline.nowLeft ?? Number.NaN));
      expect(line).toHaveAttribute('x2', percent(timeline.nowLeft ?? Number.NaN));
    }
  });

  it('sem a missão em execução não há linha do "agora"', () => {
    const { container } = render(
      <TaskTimeline item={progress(FIVE.slice(0, 2), 'succeeded')} now={NOW} />,
    );
    expect(container.querySelectorAll('line')).toHaveLength(0);
    expect(container.querySelectorAll('rect')).toHaveLength(2);
  });

  it('desenha o eixo com os rótulos do tempo, sem style', () => {
    const { container } = render(<TaskTimeline item={progress(FIVE)} now={NOW} />);
    const texts = [...container.querySelectorAll('thead svg text')];
    expect(texts.length).toBeGreaterThan(1);
    expect(texts[0]).toHaveTextContent('0');
    expect(texts[0]).toHaveAttribute('x', '0%');
    expect(texts[1]?.getAttribute('x')).toMatch(/^\d+(\.\d+)?%$/);
  });

  it('sem tarefas iniciadas não há barra, linha nem eixo, e nada lança', () => {
    const pending = [task(1, 'pending'), task(2, 'pending', { dependsOn: ['t1'] })];
    const { container } = render(<TaskTimeline item={progress(pending)} now={NOW} />);
    expect(container.querySelectorAll('rect')).toHaveLength(0);
    expect(container.querySelectorAll('line')).toHaveLength(0);
    // Os únicos SVG são os ícones de estado; o eixo e as barras (largura 100%) não existem.
    expect(container.querySelectorAll('svg[width="100%"]')).toHaveLength(0);
    expect(screen.getAllByText('na fila')).toHaveLength(2);
  });

  it('tarefa que falhou sem início legível não mostra "na fila"', () => {
    const failed = [task(1, 'failed', { startedAt: 'não é data' })];
    const { container } = render(<TaskTimeline item={progress(failed, 'failed')} now={NOW} />);
    expect(screen.queryByText('na fila')).toBeNull();
    expect(container.querySelectorAll('rect')).toHaveLength(0);
    expect(screen.getByRole('img', { name: 'Falhou' })).toBeInTheDocument();
  });
});
