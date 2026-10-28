import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ActivityFeed } from '../../src/renderer/components/progress/ActivityFeed';
import type { FeedItem } from '../../src/renderer/progress-data';

/** Atividade recente da aba Progresso: uma lista de frases com a hora, ou a frase de vazio. */

const FEED: FeedItem[] = [
  {
    id: 'a',
    at: '2026-10-28T10:30:00.000Z',
    kind: 'succeeded',
    missionTitle: 'Pagamentos',
    taskTitle: 'Criar rota',
  },
  {
    id: 'b',
    at: '2026-10-28T10:20:00.000Z',
    kind: 'started',
    missionTitle: 'Pagamentos',
    taskTitle: 'Escrever testes',
  },
  {
    id: 'c',
    at: '2026-10-28T10:10:00.000Z',
    kind: 'failed',
    missionTitle: 'Login',
    taskTitle: 'Migrar banco',
  },
  { id: 'd', at: '2026-10-28T10:00:00.000Z', kind: 'plan', missionTitle: 'Login' },
];

describe('ActivityFeed', () => {
  it('é um aside nomeado com uma lista, um item por evento, na ordem recebida', () => {
    render(<ActivityFeed feed={FEED} />);

    const aside = screen.getByRole('complementary', { name: 'Atividade recente' });
    const list = within(aside).getByRole('list');
    expect(list.tagName).toBe('OL');
    const items = within(list).getAllByRole('listitem');
    expect(items).toHaveLength(4);
    expect(items[0]).toHaveTextContent('Criar rota terminou em Pagamentos');
    expect(items[1]).toHaveTextContent('Escrever testes começou em Pagamentos');
    expect(items[2]).toHaveTextContent('Migrar banco falhou em Login');
    expect(items[3]).toHaveTextContent('Plano pronto em Login');
  });

  it('cada item traz o horário num <time> com o instante completo', () => {
    const { container } = render(<ActivityFeed feed={FEED} />);
    const times = container.querySelectorAll('time');
    expect(times).toHaveLength(4);
    expect(times[0]).toHaveAttribute('datetime', '2026-10-28T10:30:00.000Z');
    expect(times[0]?.textContent).not.toBe('');
  });

  it('o item que falhou ganha o modificador de falha', () => {
    const { container } = render(<ActivityFeed feed={FEED} />);
    const failed = container.querySelectorAll('.progress-feed__item--failed');
    expect(failed).toHaveLength(1);
    expect(failed[0]).toHaveTextContent('Migrar banco falhou');
  });

  it('feed vazio mostra a frase e nenhuma lista', () => {
    render(<ActivityFeed feed={[]} />);
    const aside = screen.getByRole('complementary', { name: 'Atividade recente' });
    expect(within(aside).getByText('Nada aconteceu ainda.')).toBeInTheDocument();
    expect(within(aside).queryByRole('list')).toBeNull();
  });

  it('título de missão e de tarefa entram como texto, nunca como HTML', () => {
    const { container } = render(
      <ActivityFeed
        feed={[
          {
            id: 'x',
            at: '2026-10-28T10:30:00.000Z',
            kind: 'started',
            missionTitle: '<img src=x onerror=alert(1)>',
            taskTitle: '<b>negrito</b>',
          },
        ]}
      />,
    );
    expect(container.querySelector('img')).toBeNull();
    expect(container.querySelector('b')).toBeNull();
    expect(screen.getByRole('listitem')).toHaveTextContent(
      '<b>negrito</b> começou em <img src=x onerror=alert(1)>',
    );
  });

  it('não usa o atributo style (CSP)', () => {
    const { container } = render(<ActivityFeed feed={FEED} />);
    expect(container.querySelectorAll('[style]')).toHaveLength(0);
  });
});
