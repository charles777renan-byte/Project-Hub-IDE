import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { MissionDto, MissionStepDto } from '@project-hub/contracts';
import { describe, expect, it, vi } from 'vitest';
import { ProgressSummary } from '../../src/renderer/components/progress/ProgressSummary';
import type { ProgressGroup, ProgressMission } from '../../src/renderer/progress-data';

/** Resumo da aba Progresso: quatro botões que filtram a lista, com o número e a frase de cada grupo. */

function task(
  id: string,
  status: MissionStepDto['status'],
  extra: Partial<MissionStepDto> = {},
): MissionStepDto {
  return { id, position: 1, title: id, status, agent: 'claude-code', role: 'general', ...extra };
}

function item(id: string, group: ProgressGroup, tasks: MissionStepDto[] = []): ProgressMission {
  const mission = { id, title: id, status: 'running' } as unknown as MissionDto;
  return {
    mission,
    group,
    tasks,
    done: tasks.filter((entry) => entry.status === 'succeeded').length,
    total: tasks.length,
    current: undefined,
  };
}

function renderSummary(items: ProgressMission[], active: ProgressGroup | undefined = undefined) {
  const onChange = vi.fn();
  render(<ProgressSummary items={items} active={active} onChange={onChange} />);
  return { onChange };
}

const NAMES = ['Em andamento', 'Precisa de você', 'Falharam', 'Concluídas hoje'];

describe('ProgressSummary', () => {
  it('traz quatro botões, na ordem dos grupos, com o número de cada um', () => {
    renderSummary([
      item('a', 'running'),
      item('b', 'running'),
      item('c', 'attention'),
      item('d', 'done'),
    ]);

    const buttons = screen.getAllByRole('button');
    expect(buttons).toHaveLength(4);
    NAMES.forEach((name, index) => expect(buttons[index]).toHaveTextContent(name));
    expect(screen.getByRole('button', { name: /Em andamento/ })).toHaveTextContent('2');
    expect(screen.getByRole('button', { name: /Precisa de você/ })).toHaveTextContent('1');
    expect(screen.getByRole('button', { name: /Falharam/ })).toHaveTextContent('0');
    expect(screen.getByRole('button', { name: /Concluídas hoje/ })).toHaveTextContent('1');
  });

  it('a frase de apoio de Em andamento conta as tarefas rodando, no plural e no singular', () => {
    const { unmount } = render(
      <ProgressSummary
        items={[
          item('a', 'running', [task('t1', 'running'), task('t2', 'running')]),
          item('b', 'running', [task('t3', 'succeeded')]),
        ]}
        active={undefined}
        onChange={vi.fn()}
      />,
    );
    expect(screen.getByText('2 tarefas rodando agora')).toBeInTheDocument();
    unmount();

    render(
      <ProgressSummary
        items={[item('a', 'running', [task('t1', 'running')])]}
        active={undefined}
        onChange={vi.fn()}
      />,
    );
    expect(screen.getByText('1 tarefa rodando agora')).toBeInTheDocument();
  });

  it('a frase de Concluídas hoje traz as tarefas e o tempo somado', () => {
    renderSummary([
      item('d', 'done', [
        task('t1', 'succeeded', {
          startedAt: '2026-10-28T10:00:00.000Z',
          finishedAt: '2026-10-28T11:00:00.000Z',
        }),
        task('t2', 'succeeded', {
          startedAt: '2026-10-28T11:00:00.000Z',
          finishedAt: '2026-10-28T11:52:00.000Z',
        }),
      ]),
    ]);
    expect(screen.getByText('2 tarefas, 1 h 52 min')).toBeInTheDocument();
  });

  it('Concluídas hoje sem tempo registrado traz só as tarefas, no singular quando é uma', () => {
    renderSummary([item('d', 'done', [task('t1', 'succeeded')])]);
    expect(screen.getByText('1 tarefa')).toBeInTheDocument();
  });

  it('aria-pressed só no grupo ativo', () => {
    renderSummary([item('a', 'running')], 'failed');
    expect(screen.getByRole('button', { name: /Falharam/ })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    for (const name of [/Em andamento/, /Precisa de você/, /Concluídas hoje/]) {
      expect(screen.getByRole('button', { name })).toHaveAttribute('aria-pressed', 'false');
    }
  });

  it('clicar num grupo o escolhe; clicar no ativo limpa o filtro', async () => {
    const user = userEvent.setup();
    const first = renderSummary([item('a', 'running')], 'running');
    await user.click(screen.getByRole('button', { name: /Falharam/ }));
    expect(first.onChange).toHaveBeenLastCalledWith('failed');
    await user.click(screen.getByRole('button', { name: /Em andamento/ }));
    expect(first.onChange).toHaveBeenLastCalledWith(undefined);
  });
});
