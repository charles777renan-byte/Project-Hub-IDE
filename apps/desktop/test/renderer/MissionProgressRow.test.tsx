import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import type { MissionDto, MissionStepDto } from '@project-hub/contracts';
import { describe, expect, it, vi } from 'vitest';
import { MissionProgressRow } from '../../src/renderer/components/progress/MissionProgressRow';
import { formatTime } from '../../src/renderer/mission-text';
import type { ProgressGroup, ProgressMission } from '../../src/renderer/progress-data';

/** Linha da missão na aba Progresso: título, frase do estado, segmentos, "N de M", link e linha do tempo. */

const NOW = new Date('2026-10-28T10:40:00.000Z');

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

const TASKS: MissionStepDto[] = [
  task(1, 'succeeded', {
    startedAt: '2026-10-28T10:00:00.000Z',
    finishedAt: '2026-10-28T10:10:00.000Z',
  }),
  task(2, 'succeeded', {
    startedAt: '2026-10-28T10:10:00.000Z',
    finishedAt: '2026-10-28T10:25:00.000Z',
  }),
  task(3, 'running', { role: 'frontend', startedAt: '2026-10-28T10:25:00.000Z' }),
  task(4, 'pending'),
  task(5, 'pending'),
];

function item(
  status: MissionDto['status'],
  group: ProgressGroup,
  tasks: MissionStepDto[] = TASKS,
  extra: Partial<MissionDto> = {},
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
      createdAt: '2026-10-28T09:00:00.000Z',
      updatedAt: '2026-10-28T10:30:00.000Z',
      ...extra,
    },
    group,
    tasks,
    done: tasks.filter((t) => t.status === 'succeeded').length,
    total: tasks.length,
    current: tasks.find((t) => t.status === 'running') ?? tasks.find((t) => t.status === 'failed'),
  };
}

function renderRow(mission: ProgressMission, expanded = false) {
  const onToggle = vi.fn();
  const view = render(
    <MemoryRouter>
      <MissionProgressRow
        item={mission}
        projectId="p1"
        expanded={expanded}
        onToggle={onToggle}
        now={NOW}
      />
    </MemoryRouter>,
  );
  return { ...view, onToggle };
}

describe('MissionProgressRow', () => {
  it('o botão de expandir reflete aria-expanded, aponta para a linha do tempo e chama onToggle', async () => {
    const user = userEvent.setup();
    const { onToggle, container } = renderRow(item('running', 'running'));

    const toggle = screen.getByRole('button', { name: /Pagamentos/ });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(toggle.getAttribute('aria-controls')).toBeTruthy();
    expect(screen.queryByRole('table')).toBeNull();
    await user.click(toggle);
    expect(onToggle).toHaveBeenCalledTimes(1);
    expect(container.querySelectorAll('[style]')).toHaveLength(0);
  });

  it('expandida mostra a linha do tempo no id de aria-controls', () => {
    const { container } = renderRow(item('running', 'running'), true);
    const toggle = screen.getByRole('button', { name: /Pagamentos/ });
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    const controlled = container.querySelector(`[id="${toggle.getAttribute('aria-controls')}"]`);
    expect(controlled).not.toBeNull();
    expect(
      within(controlled as HTMLElement).getByRole('table', { name: 'Tarefas de Pagamentos' }),
    ).toBeInTheDocument();
  });

  it('a barra de segmentos é uma imagem com o nome e um segmento por tarefa', () => {
    renderRow(item('running', 'running'));
    const bar = screen.getByRole('img', {
      name: '2 de 5 tarefas concluídas, a próxima em execução',
    });
    const segments = [...bar.querySelectorAll('.progress-seg')];
    expect(segments.map((segment) => segment.className)).toEqual([
      'progress-seg progress-seg--succeeded',
      'progress-seg progress-seg--succeeded',
      'progress-seg progress-seg--running',
      'progress-seg progress-seg--pending',
      'progress-seg progress-seg--pending',
    ]);
    expect(screen.getByText('2 de 5')).toBeInTheDocument();
  });

  it('sem tarefa em execução o nome da barra não fala da próxima', () => {
    renderRow(item('queued', 'running', [task(1, 'succeeded'), task(2, 'pending')]));
    expect(screen.getByRole('img', { name: '1 de 2 tarefas concluídas' })).toBeInTheDocument();
  });

  it('segmento de tarefa que falhou leva a classe failed', () => {
    renderRow(item('failed', 'failed', [task(1, 'succeeded'), task(2, 'failed')]));
    const bar = screen.getByRole('img', { name: /tarefas concluídas/ });
    expect(bar.querySelectorAll('.progress-seg--failed')).toHaveLength(1);
  });

  it('em andamento: a frase diz o papel e o programa da tarefa que roda; o link abre a missão', () => {
    renderRow(item('running', 'running'));
    expect(screen.getByText('Executando: Frontend · Claude')).toBeInTheDocument();
    const link = screen.getByRole('link', { name: 'Abrir missão: Pagamentos' });
    expect(link).toHaveAttribute('href', '/workspaces/p1/missoes/m1');
    expect(link).toHaveTextContent('Abrir missão');
  });

  it('pausada com etapa ainda running: a frase diz Pausada e a barra não fala de execução', () => {
    renderRow(item('paused', 'running'));
    expect(screen.getByText('Pausada', { selector: '.progress-row__state' })).toBeInTheDocument();
    expect(screen.queryByText(/Executando/)).toBeNull();
    expect(screen.getByRole('img', { name: '2 de 5 tarefas concluídas' })).toBeInTheDocument();
  });

  it('falhou: a frase diz a posição e o título da tarefa; o link abre a missão', () => {
    const tasks = [task(1, 'succeeded'), task(2, 'failed', { title: 'Migrar tabelas' })];
    renderRow(item('failed', 'failed', tasks));
    expect(screen.getByText('Falhou na tarefa 2: Migrar tabelas')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Abrir missão: Pagamentos' })).toBeInTheDocument();
  });

  it('precisa de você: a frase e o link levam a ação que a missão espera', () => {
    renderRow(item('planned', 'attention', [task(1, 'pending')]));
    expect(
      screen.getByText('Aprovar plano', { selector: '.progress-row__state' }),
    ).toBeInTheDocument();
    const link = screen.getByRole('link', { name: 'Aprovar plano: Pagamentos' });
    expect(link).toHaveAttribute('href', '/workspaces/p1/missoes/m1');
    expect(link).toHaveTextContent('Aprovar plano');
  });

  it('concluída: a frase traz o horário em que terminou', () => {
    const finishedAt = '2026-10-28T10:35:00.000Z';
    const tasks = [task(1, 'succeeded'), task(2, 'succeeded')];
    renderRow(item('succeeded', 'done', tasks, { finishedAt }));
    expect(screen.getByText(`Concluída ${formatTime(finishedAt)}`)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Abrir missão: Pagamentos' })).toBeInTheDocument();
  });

  it('sem tarefas lidas: botão desabilitado, sem segmentos nem "N de M", só o estado da missão', () => {
    renderRow(item('running', 'running', []), true);
    expect(screen.getByRole('button', { name: /Pagamentos/ })).toBeDisabled();
    expect(screen.queryByRole('img')).toBeNull();
    expect(screen.queryByText(/ de /)).toBeNull();
    expect(screen.queryByRole('table')).toBeNull();
    expect(screen.getByText('Em andamento')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Abrir missão: Pagamentos' })).toBeInTheDocument();
  });

  it('a borda do cartão acompanha o grupo', () => {
    const { container } = renderRow(item('review', 'attention', [task(1, 'pending')]));
    expect(container.querySelector('.progress-row')).toHaveClass('progress-row--attention');
  });
});
