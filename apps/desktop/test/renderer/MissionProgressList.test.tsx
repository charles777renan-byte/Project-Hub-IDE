import { render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import type { MissionDto } from '@project-hub/contracts';
import { describe, expect, it } from 'vitest';
import { MissionProgressList } from '../../src/renderer/components/MissionProgressList';
import type { MissionBoardItem } from '../../src/renderer/use-missions-board';

/** Lista de missões com progresso: título, estado, "4/5 tarefas", barra tingida pelo estado e filtro. */

function item(
  id: string,
  status: MissionDto['status'],
  done: number,
  total: number,
): MissionBoardItem {
  return {
    mission: {
      id,
      projectId: 'p1',
      title: `Missão ${id}`,
      objective: 'Objetivo',
      status,
      altersCode: false,
      acceptanceCriteria: [],
      createdAt: '2026-10-20T09:00:00.000Z',
      updatedAt: '2026-10-20T09:00:00.000Z',
    },
    projectId: 'p1',
    projectName: 'Projeto 1',
    done,
    total,
  };
}

function renderList(items: MissionBoardItem[], filter?: 'running' | 'attention' | 'failed') {
  return render(
    <MemoryRouter>
      <MissionProgressList items={items} {...(filter === undefined ? {} : { filter })} />
    </MemoryRouter>,
  );
}

describe('MissionProgressList', () => {
  it('mostra o selo do estado, as tarefas embaixo e a barra com o valor', () => {
    renderList([item('m1', 'running', 4, 5)]);

    const card = screen.getByRole('listitem');
    expect(card.querySelector('.chip')).toHaveTextContent('Em andamento');
    expect(card.querySelector('.mission-progress__foot')).toHaveTextContent('4/5 tarefas');
    expect(within(card).getByRole('link', { name: 'Missão m1' })).toHaveAttribute(
      'href',
      '/workspaces/p1/missoes/m1',
    );
    const bar = within(card).getByRole('progressbar', { name: /Missão m1/ });
    expect(bar).toHaveAttribute('value', '4');
    expect(bar).toHaveAttribute('max', '5');
  });

  it('o título (truncado pela CSS) leva o texto inteiro também no title do link', () => {
    renderList([item('m1', 'running', 1, 2)]);

    expect(screen.getByRole('link', { name: 'Missão m1' })).toHaveAttribute('title', 'Missão m1');
  });

  it('sem tarefas, mostra só o estado e nenhuma barra', () => {
    renderList([item('m1', 'draft', 0, 0)]);

    expect(screen.getByText('Rascunho')).toBeInTheDocument();
    expect(screen.queryByText(/tarefas/)).not.toBeInTheDocument();
    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
  });

  it('usa os rótulos curtos do protótipo e tinge a barra pelo tom do estado', () => {
    renderList([
      item('m1', 'waiting_approval', 3, 3),
      item('m2', 'queued', 0, 5),
      item('m3', 'failed', 1, 2),
      item('m4', 'running', 1, 2),
    ]);

    const chips = [...document.querySelectorAll('.chip')].map((chip) => chip.textContent);
    expect(chips.slice(0, 2)).toEqual(['Aguardando aprovação', 'Aguardando início']);
    expect(document.querySelectorAll('.chip')[0]).toHaveClass('chip--warn');
    expect(screen.getByText('3/3 tarefas')).toBeInTheDocument();
    expect(screen.getByText('0/5 tarefas')).toBeInTheDocument();
    const bars = screen.getAllByRole('progressbar');
    expect(bars[0]).toHaveClass('mission-progress__bar--warn');
    expect(bars[2]).toHaveClass('mission-progress__bar--red');
    expect(bars[3]).toHaveClass('mission-progress__bar--lime');
  });

  it.each([
    ['running', ['m1']],
    ['attention', ['m2', 'm3']],
    ['failed', ['m4']],
  ] as const)('o filtro %s mostra só as missões daquele estado', (filter, shown) => {
    renderList(
      [
        item('m1', 'running', 1, 2),
        item('m2', 'waiting_approval', 1, 2),
        item('m3', 'review', 2, 2),
        item('m4', 'failed', 1, 2),
        item('m5', 'succeeded', 2, 2),
      ],
      filter,
    );

    expect(screen.getAllByRole('link').map((link) => link.textContent)).toEqual(
      shown.map((id) => `Missão ${id}`),
    );
  });

  it('com o projeto, o agente e os tokens: a linha de detalhes e os tokens curtos', () => {
    render(
      <MemoryRouter>
        <MissionProgressList
          items={[{ ...item('m1', 'succeeded', 3, 3), agents: ['claude-code'], tokens: 12_480 }]}
          showProject
        />
      </MemoryRouter>,
    );

    const card = screen.getByRole('listitem');
    expect(card.querySelector('.mission-progress__meta')?.textContent).toMatch(
      /^Projeto 1 · Claude · /,
    );
    const foot = card.querySelector('.mission-progress__foot') as HTMLElement;
    expect(foot.querySelector('[aria-hidden="true"]')).toHaveTextContent('12,4k tokens');
    expect(foot.querySelector('.visually-hidden')).toHaveTextContent('12.480 tokens');
    expect(foot).toHaveTextContent(/^3\/3 tarefas · /);
  });

  it('sem tokens, o rodapé mostra só as tarefas', () => {
    renderList([{ ...item('m1', 'running', 1, 2), tokens: 0 }]);

    expect(document.querySelector('.mission-progress__foot')?.textContent).toBe('1/2 tarefas');
  });

  it('sem nada a mostrar, não desenha lista', () => {
    renderList([item('m1', 'running', 1, 2)], 'failed');

    expect(screen.queryByRole('list')).not.toBeInTheDocument();
  });
});
