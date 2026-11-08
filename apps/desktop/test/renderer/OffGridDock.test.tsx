import { act, fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { OffGridDock, type OffGridItem } from '../../src/renderer/workspace/OffGridDock';
import { show, tabEl, useFakeIntersectionObserver } from './fake-intersection-observer';

useFakeIntersectionObserver();

const item = (
  id: string,
  label: string,
  mark: OffGridItem['mark'] = 'waiting',
  provider: OffGridItem['provider'] = 'claude',
): OffGridItem => ({ id, label, provider, mark });

const TWO = [item('a', 'Claude Code 5', 'waiting'), item('b', 'Claude Code 6', 'active')];
const FOUR = [
  item('a', 'Claude Code 1'),
  item('b', 'Claude Code 2', 'active'),
  item('c', 'Claude Code 3', 'active'),
  item('d', 'PowerShell', 'disconnected', 'shell'),
];

describe('OffGridDock', () => {
  it('sem itens, não desenha nada', () => {
    const { container } = render(<OffGridDock items={[]} onBring={vi.fn()} />);

    expect(container).toBeEmptyDOMElement();
  });

  it('é um grupo nomeado, com o rótulo e a contagem', () => {
    render(<OffGridDock items={TWO} onBring={vi.fn()} />);

    const group = screen.getByRole('group', { name: 'Terminais fora da grade' });
    expect(within(group).getByText('Fora da grade')).toBeInTheDocument();
    expect(within(group).getByText('2')).toBeInTheDocument();
  });

  it('cada item é um botão com o nome, a marca escondida, o rótulo do estado e a dica', () => {
    render(<OffGridDock items={TWO} onBring={vi.fn()} />);

    const chip = screen.getByRole('button', { name: /Claude Code 5/ });
    expect(chip).toHaveAccessibleName('Claude Code 5 Aguardando');
    expect(within(chip).getByText('Claude Code 5')).toBeVisible();
    const glyph = within(chip).getByText('◐');
    expect(glyph).toHaveAttribute('aria-hidden', 'true');
    expect(within(chip).getByText('Aguardando')).toBeInTheDocument();
    expect(chip).toHaveAttribute('title', 'Aguardando · traz para a grade');
    expect(screen.getByRole('button', { name: /Claude Code 6/ })).toHaveAttribute(
      'title',
      'Ativo · traz para a grade',
    );
  });

  it('a ficha leva a classe do tom do estado', () => {
    render(
      <OffGridDock
        items={[
          item('a', 'Espera', 'waiting'),
          item('b', 'Falha', 'error'),
          item('c', 'Roda', 'active'),
        ]}
        onBring={vi.fn()}
      />,
    );

    expect(screen.getByRole('button', { name: /Espera/ })).toHaveClass('off-grid__chip--waiting');
    expect(screen.getByRole('button', { name: /Falha/ })).toHaveClass('off-grid__chip--error');
    const active = screen.getByRole('button', { name: /Roda/ });
    expect(active).not.toHaveClass('off-grid__chip--waiting');
    expect(active).not.toHaveClass('off-grid__chip--error');
  });

  it('clicar na ficha chama onBring com o id', async () => {
    const user = userEvent.setup();
    const onBring = vi.fn();
    render(<OffGridDock items={TWO} onBring={onBring} />);

    await user.click(screen.getByRole('button', { name: /Claude Code 6/ }));

    expect(onBring).toHaveBeenCalledExactlyOnceWith('b');
  });

  it('com todas as fichas à vista, não há gatilho de excesso', () => {
    render(<OffGridDock items={FOUR} onBring={vi.fn()} />);
    show('a', 'b', 'c', 'd');

    expect(screen.queryByRole('button', { name: /^Mais \d+ fora da grade$/ })).toBeNull();
  });

  it('as fichas fora de vista vão para o gatilho "+N", e escolher uma no menu traz o painel', async () => {
    const user = userEvent.setup();
    const onBring = vi.fn();
    render(<OffGridDock items={FOUR} onBring={onBring} />);
    show('a', 'b');

    const trigger = screen.getByRole('button', { name: 'Mais 2 fora da grade' });
    expect(trigger).toHaveTextContent('+2');
    await user.click(trigger);
    const entries = screen.getAllByRole('menuitem');
    expect(entries).toHaveLength(2);
    expect(entries[0]).toHaveTextContent('Claude Code 3');
    expect(entries[1]).toHaveTextContent('PowerShell');

    await user.click(entries[1] as HTMLElement);

    expect(onBring).toHaveBeenCalledExactlyOnceWith('d');
  });

  it('trazer um painel pelo "+N" deixa o foco onde o onBring o pôs, e não o devolve ao gatilho', async () => {
    const user = userEvent.setup();
    render(
      <>
        <textarea aria-label="Terminal" />
        <OffGridDock
          items={FOUR}
          // O foco do painel trazido chega depois da renderização (como em `activateWithFocus`), não na hora.
          onBring={() => setTimeout(() => screen.getByLabelText('Terminal').focus(), 0)}
        />
      </>,
    );
    show('a', 'b');

    const trigger = screen.getByRole('button', { name: 'Mais 2 fora da grade' });
    await user.click(trigger);
    await user.click(screen.getAllByRole('menuitem')[0] as HTMLElement);
    // O Radix devolve o foco ao gatilho num instante depois de fechar: espera esse instante passar.
    await act(() => new Promise((resolve) => setTimeout(resolve, 20)));

    expect(screen.getByLabelText('Terminal')).toHaveFocus();
    expect(trigger).not.toHaveFocus();
  });

  it('a ficha cortada pela faixa sai da ordem do Tab e dos leitores de tela; as à vista não', () => {
    render(<OffGridDock items={FOUR} onBring={vi.fn()} />);
    show('a', 'b');

    for (const id of ['c', 'd']) {
      expect(tabEl(id)).toHaveAttribute('tabindex', '-1');
      expect(tabEl(id)).toHaveAttribute('aria-hidden', 'true');
    }
    for (const id of ['a', 'b']) {
      expect(tabEl(id)).not.toHaveAttribute('tabindex');
      expect(tabEl(id)).not.toHaveAttribute('aria-hidden');
    }
  });

  it('a ficha que acabou de chegar ganha data-arriving, que sai no animationend', () => {
    const { rerender } = render(<OffGridDock items={TWO} onBring={vi.fn()} />);
    // A primeira renderização não anima nada: as fichas já estavam lá.
    expect(screen.getByRole('button', { name: /Claude Code 5/ })).not.toHaveAttribute(
      'data-arriving',
    );

    rerender(
      <OffGridDock items={[...TWO, item('c', 'Refatorar rotas', 'active')]} onBring={vi.fn()} />,
    );

    const arrived = screen.getByRole('button', { name: /Refatorar rotas/ });
    expect(arrived).toHaveAttribute('data-arriving', 'true');
    expect(screen.getByRole('button', { name: /Claude Code 5/ })).not.toHaveAttribute(
      'data-arriving',
    );

    // O jsdom não tem AnimationEvent: sem ele o React escuta o nome com prefixo (como em WorkspacePage.test).
    fireEvent(arrived, new Event('webkitAnimationEnd', { bubbles: true }));

    expect(arrived).not.toHaveAttribute('data-arriving');
  });
});
