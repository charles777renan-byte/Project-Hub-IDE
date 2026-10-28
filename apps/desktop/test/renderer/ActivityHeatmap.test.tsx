import { render, screen } from '@testing-library/react';
import type { ActivityDay, AppResult, ProjectHubApi } from '@project-hub/contracts';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  ActivityHeatmap,
  currentStreak,
  leadingBlanks,
  levelsFor,
} from '../../src/renderer/components/home/ActivityHeatmap';

/** Atividade do Início: níveis por dia e o bloco com banco vazio, com dados e com a consulta em falha. */

const TODAY = new Date(2026, 9, 24, 15, 0);

function installActivity(result: AppResult<ActivityDay[]> | 'reject') {
  const daily = vi.fn(() =>
    result === 'reject' ? Promise.reject(new Error('fora do ar')) : Promise.resolve(result),
  );
  window.projectHub = { activity: { daily } } as unknown as ProjectHubApi;
  return daily;
}

afterEach(() => {
  Reflect.deleteProperty(window, 'projectHub');
});

describe('levelsFor', () => {
  it('com banco vazio, devolve os dias todos no nível 0', () => {
    const levels = levelsFor([], 90, TODAY);

    expect(levels).toHaveLength(90);
    expect(levels.every((level) => level === 0)).toBe(true);
  });

  it('o dia de pico é o nível 4, e o mais novo da janela é hoje', () => {
    const levels = levelsFor(
      [
        { date: '2026-10-24', count: 40 },
        { date: '2026-10-23', count: 10 },
        { date: '2026-10-22', count: 1 },
      ],
      90,
      TODAY,
    );

    expect(levels[89]).toBe(4);
    expect(levels[88]).toBe(1);
    expect(levels[87]).toBe(1);
    expect(levels[86]).toBe(0);
  });

  it('as faixas seguem a fração do maior dia', () => {
    const counts = [
      { date: '2026-10-24', count: 100 },
      { date: '2026-10-23', count: 75 },
      { date: '2026-10-22', count: 50 },
      { date: '2026-10-21', count: 26 },
      { date: '2026-10-20', count: 25 },
    ];

    expect(levelsFor(counts, 5, TODAY)).toEqual([1, 2, 2, 3, 4]);
  });

  it('ignora o que cai fora da janela', () => {
    const levels = levelsFor([{ date: '2026-01-01', count: 500 }], 90, TODAY);

    expect(levels.every((level) => level === 0)).toBe(true);
  });

  it('atravessa a virada de horário de verão sem pular nem repetir dia', () => {
    const levels = levelsFor([{ date: '2026-03-08', count: 3 }], 30, new Date(2026, 2, 20, 23, 30));

    expect(levels).toHaveLength(30);
    expect(levels.filter((level) => level > 0)).toHaveLength(1);
  });
});

describe('currentStreak', () => {
  it('conta os dias seguidos com evento até hoje', () => {
    const counts = [
      { date: '2026-10-24', count: 1 },
      { date: '2026-10-23', count: 5 },
      { date: '2026-10-22', count: 2 },
      { date: '2026-10-20', count: 9 },
    ];

    expect(currentStreak(counts, TODAY)).toBe(3);
  });

  it('é 0 quando hoje não tem evento, mesmo com ontem cheio', () => {
    expect(currentStreak([{ date: '2026-10-23', count: 4 }], TODAY)).toBe(0);
  });

  it('com banco vazio ou dia de contagem zero, é 0', () => {
    expect(currentStreak([], TODAY)).toBe(0);
    expect(currentStreak([{ date: '2026-10-24', count: 0 }], TODAY)).toBe(0);
  });

  it('atravessa a virada de mês', () => {
    const counts = [
      { date: '2026-11-02', count: 1 },
      { date: '2026-11-01', count: 1 },
      { date: '2026-10-31', count: 1 },
    ];

    expect(currentStreak(counts, new Date(2026, 10, 2, 8, 0))).toBe(3);
  });

  it('nunca passa do tamanho da janela', () => {
    const counts = Array.from({ length: 120 }, (_, index) => {
      const day = new Date(2026, 9, 24 - index);
      const month = String(day.getMonth() + 1).padStart(2, '0');
      return {
        date: `${day.getFullYear()}-${month}-${String(day.getDate()).padStart(2, '0')}`,
        count: 1,
      };
    });

    expect(currentStreak(counts, TODAY)).toBe(90);
  });
});

describe('leadingBlanks', () => {
  it('é o dia da semana do primeiro dia da janela (domingo é 0)', () => {
    // 24/10/2026 é sábado; 90 dias terminam nele e começam em 27/07/2026, uma segunda-feira.
    expect(leadingBlanks(90, TODAY)).toBe(1);
    // Terminando numa quinta (22/10), a janela começa num sábado (25/07): seis espaços antes.
    expect(leadingBlanks(90, new Date(2026, 9, 22, 9, 0))).toBe(6);
    // Terminando num domingo (25/10), a janela começa numa terça (28/07).
    expect(leadingBlanks(90, new Date(2026, 9, 25, 9, 0))).toBe(2);
  });
});

describe('ActivityHeatmap', () => {
  it('a primeira semana começa no dia da semana certo, com os rótulos seg, qua e sex', async () => {
    installActivity({ ok: true, data: [{ date: '2026-10-22', count: 1 }] });

    const { container } = render(<ActivityHeatmap today={new Date(2026, 9, 22, 9, 0)} />);

    await screen.findByRole('img');
    const grid = container.querySelector('.activity-grid') as HTMLElement;
    const items = [...grid.children];
    // 7 rótulos, depois 6 vazios (a janela começa num sábado) e então o primeiro dia.
    expect(items.slice(0, 7).map((item) => item.textContent)).toEqual([
      '',
      'seg',
      '',
      'qua',
      '',
      'sex',
      '',
    ]);
    const cells = items.slice(7);
    expect(cells.slice(0, 6).every((cell) => cell.classList.contains('activity-cell--blank'))).toBe(
      true,
    );
    expect(cells[6]).toHaveClass('activity-level--0');
    expect(cells[6]).not.toHaveClass('activity-cell--blank');
    // 89 dias sem evento e o de hoje, no nível 4.
    expect(grid.querySelectorAll('.activity-level--0')).toHaveLength(89);
    expect(grid.querySelectorAll('.activity-level--4')).toHaveLength(1);
  });

  it('mostra o total, o período, a sequência e a legenda numa faixa compacta', async () => {
    installActivity({
      ok: true,
      data: [
        { date: '2026-10-24', count: 8 },
        { date: '2026-10-23', count: 2 },
      ],
    });

    const { container } = render(<ActivityHeatmap today={TODAY} />);

    expect(await screen.findByText('eventos de missão')).toBeInTheDocument();
    expect(container.querySelector('.activity__number')).toHaveTextContent('10');
    expect(screen.getByText('nos últimos 90 dias')).toBeInTheDocument();
    expect(container.querySelector('.home-badge')).toBeNull();
    expect(screen.getByText('sequência atual: 2 dias')).toBeInTheDocument();
    const legend = container.querySelector('.activity-legend') as HTMLElement;
    expect(legend).toHaveTextContent('menos');
    expect(legend).toHaveTextContent('mais');
    expect(legend.querySelectorAll('.activity-cell')).toHaveLength(5);
  });

  it('sem evento hoje, a sequência é 0 dias', async () => {
    installActivity({ ok: true, data: [{ date: '2026-10-23', count: 3 }] });

    render(<ActivityHeatmap today={TODAY} />);

    expect(await screen.findByText('sequência atual: 0 dias')).toBeInTheDocument();
  });

  it('com banco vazio, é uma linha só: sem mapa, sem legenda e sem erro', async () => {
    installActivity({ ok: true, data: [] });

    const { container } = render(<ActivityHeatmap today={TODAY} />);

    expect(await screen.findByText('Nenhuma atividade nos últimos 90 dias.')).toBeInTheDocument();
    expect(container.querySelector('.activity-grid')).toBeNull();
    expect(container.querySelector('.activity-cell')).toBeNull();
    expect(container.querySelector('.activity-legend')).toBeNull();
    expect(screen.queryByRole('img')).toBeNull();
    expect(screen.queryByText(/Não foi possível/)).toBeNull();
  });

  it('com dados, pinta o nível por classe e conta os eventos', async () => {
    installActivity({
      ok: true,
      data: [
        { date: '2026-10-24', count: 8 },
        { date: '2026-10-23', count: 2 },
      ],
    });

    const { container } = render(<ActivityHeatmap today={TODAY} />);

    expect(await screen.findByRole('img')).toHaveAttribute(
      'aria-label',
      '10 eventos de missão nos últimos 90 dias.',
    );
    const cells = container.querySelectorAll('.activity-grid .activity-level--4');
    expect(cells).toHaveLength(1);
    expect(cells[0]).toHaveClass('activity-cell--today');
    expect(container.querySelectorAll('.activity-grid .activity-level--1')).toHaveLength(1);
    expect(container.querySelector('[style]')).toBeNull();
  });

  it('com a consulta em erro, mostra a mensagem do bloco', async () => {
    installActivity({ ok: false, error: { code: 'UNKNOWN', message: 'x', retryable: true } });

    render(<ActivityHeatmap today={TODAY} />);

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Não foi possível carregar a atividade.');
    expect(alert).not.toHaveTextContent('Tente de novo');
  });

  it('enquanto carrega, o aviso é um status', () => {
    installActivity({ ok: true, data: [] });

    render(<ActivityHeatmap today={TODAY} />);

    expect(screen.getByRole('status')).toHaveTextContent('Carregando…');
  });

  it('com a chamada lançando, também mostra a mensagem', async () => {
    installActivity('reject');

    render(<ActivityHeatmap today={TODAY} />);

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Não foi possível carregar a atividade.',
    );
  });
});

describe('ActivityHeatmap: classes', () => {
  it('a seção não usa a classe `activity`, que é do gráfico pequeno da barra lateral (12 px de altura)', async () => {
    installActivity({ ok: true, data: [{ date: '2026-10-24', count: 1 }] });
    const { container } = render(<ActivityHeatmap today={TODAY} />);

    await screen.findByRole('img');
    const section = container.querySelector('section');
    expect(section).not.toHaveClass('activity');
    expect(section).toHaveClass('home-activity');
  });
});
