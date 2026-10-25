import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { Tabs, type TabItem } from '../../src/renderer/components/Tabs';

type Id = 'a' | 'b' | 'c';
const TABS: readonly TabItem<Id>[] = [
  { id: 'a', label: 'Primeira' },
  { id: 'b', label: 'Segunda' },
  { id: 'c', label: 'Terceira' },
];

function Harness({ onChange = () => undefined }: { onChange?: (id: Id) => void }) {
  const [active, setActive] = useState<Id>('a');
  return (
    <Tabs
      label="Exemplo"
      tabs={TABS}
      active={active}
      onChange={(id) => {
        setActive(id);
        onChange(id);
      }}
    />
  );
}

describe('Tabs', () => {
  it('cada aba é um botão com aria-selected, e o clique troca a ativa', async () => {
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);

    expect(screen.getByRole('tablist', { name: 'Exemplo' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Primeira' })).toHaveAttribute('aria-selected', 'true');

    await userEvent.click(screen.getByRole('tab', { name: 'Segunda' }));

    expect(onChange).toHaveBeenCalledWith('b');
    expect(screen.getByRole('tab', { name: 'Segunda' })).toHaveAttribute('aria-selected', 'true');
  });

  it('sem panelId, as abas controlam o painel "tab-panel"', () => {
    render(<Harness />);

    for (const tab of screen.getAllByRole('tab')) {
      expect(tab).toHaveAttribute('aria-controls', 'tab-panel');
    }
  });

  it('com panelId, cada aba controla o próprio painel', () => {
    render(
      <Tabs
        label="Exemplo"
        tabs={TABS}
        active="a"
        onChange={() => undefined}
        panelId={(id) => `painel-${id}`}
      />,
    );

    expect(screen.getByRole('tab', { name: 'Terceira' })).toHaveAttribute(
      'aria-controls',
      'painel-c',
    );
  });

  it('as setas andam entre as abas, dão a volta nas pontas, e Home e End vão às extremidades', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    screen.getByRole('tab', { name: 'Primeira' }).focus();

    await user.keyboard('{ArrowRight}');
    expect(screen.getByRole('tab', { name: 'Segunda' })).toHaveFocus();
    expect(screen.getByRole('tab', { name: 'Segunda' })).toHaveAttribute('aria-selected', 'true');

    await user.keyboard('{ArrowLeft}{ArrowLeft}');
    expect(screen.getByRole('tab', { name: 'Terceira' })).toHaveFocus();

    await user.keyboard('{ArrowRight}');
    expect(screen.getByRole('tab', { name: 'Primeira' })).toHaveFocus();

    await user.keyboard('{End}');
    expect(screen.getByRole('tab', { name: 'Terceira' })).toHaveFocus();
    await user.keyboard('{Home}');
    expect(screen.getByRole('tab', { name: 'Primeira' })).toHaveFocus();
  });

  it('a contagem aparece depois do nome, escondida do leitor de tela, que lê a frase como descrição', () => {
    render(
      <Tabs
        label="Exemplo"
        tabs={[
          { id: 'a', label: 'Primeira', count: { value: '3', label: '3 etapas' } },
          { id: 'b', label: 'Segunda' },
        ]}
        active="a"
        onChange={() => undefined}
      />,
    );

    const first = screen.getByRole('tab', { name: 'Primeira' });
    const count = first.querySelector('.tab__count');
    expect(count).toHaveTextContent('3');
    expect(count).toHaveAttribute('aria-hidden', 'true');
    expect(first).toHaveAccessibleDescription('3 etapas');
    expect(first).toHaveAttribute('aria-describedby', 'tab-a-count');

    const second = screen.getByRole('tab', { name: 'Segunda' });
    expect(second.querySelector('.tab__count')).toBeNull();
    expect(second).not.toHaveAttribute('aria-describedby');
  });

  it('só a aba ativa entra na ordem de tabulação, nos dois sentidos', async () => {
    const user = userEvent.setup();
    render(
      <>
        <button type="button">Antes</button>
        <Tabs label="Exemplo" tabs={TABS} active="b" onChange={() => undefined} />
        <button type="button">Depois</button>
      </>,
    );

    await user.tab();
    expect(screen.getByRole('button', { name: 'Antes' })).toHaveFocus();
    await user.tab();
    expect(screen.getByRole('tab', { name: 'Segunda' })).toHaveFocus();
    await user.tab();
    expect(screen.getByRole('button', { name: 'Depois' })).toHaveFocus();
    await user.tab({ shift: true });
    expect(screen.getByRole('tab', { name: 'Segunda' })).toHaveFocus();
    await user.tab({ shift: true });
    expect(screen.getByRole('button', { name: 'Antes' })).toHaveFocus();
  });

  it('as setas partem da aba focada, não da ativa', async () => {
    const user = userEvent.setup();
    // A ativa fica parada em "a" (o onChange não faz nada): só o foco anda.
    render(<Tabs label="Exemplo" tabs={TABS} active="a" onChange={() => undefined} />);
    screen.getByRole('tab', { name: 'Segunda' }).focus();

    await user.keyboard('{ArrowRight}');

    expect(screen.getByRole('tab', { name: 'Terceira' })).toHaveFocus();
  });

  it('depois do clique ou da seta, o foco fica na aba e o Tab sai da barra para o conteúdo', async () => {
    const user = userEvent.setup();
    render(
      <>
        <Harness />
        <button type="button">Conteúdo da aba</button>
      </>,
    );

    await user.click(screen.getByRole('tab', { name: 'Segunda' }));
    expect(screen.getByRole('tab', { name: 'Segunda' })).toHaveFocus();
    await user.tab();
    expect(screen.getByRole('button', { name: 'Conteúdo da aba' })).toHaveFocus();

    screen.getByRole('tab', { name: 'Segunda' }).focus();
    await user.keyboard('{ArrowRight}');
    expect(screen.getByRole('tab', { name: 'Terceira' })).toHaveFocus();
    await user.tab();
    expect(screen.getByRole('button', { name: 'Conteúdo da aba' })).toHaveFocus();
  });

  it('o ponteiro do aria-controls da aba ativa leva ao painel que a página monta', () => {
    // O Tabs não monta painéis: quem o usa monta o painel com o mesmo id que `panelId` devolve.
    render(
      <>
        <Tabs
          label="Exemplo"
          tabs={TABS}
          active="a"
          onChange={() => undefined}
          panelId={(id) => `painel-${id}`}
        />
        <div role="tabpanel" id="painel-a" aria-labelledby="tab-a" />
      </>,
    );

    const tab = screen.getByRole('tab', { name: 'Primeira' });
    const panel = document.getElementById(tab.getAttribute('aria-controls') ?? '');
    expect(panel).not.toBeNull();
    expect(panel).toBe(screen.getByRole('tabpanel', { name: 'Primeira' }));
  });

  it('a barra de abas é filha direta do contêiner da página, sem invólucro extra', () => {
    render(
      <div data-testid="contêiner">
        <Tabs label="Exemplo" tabs={TABS} active="a" onChange={() => undefined} />
      </div>,
    );

    const list = screen.getByRole('tablist', { name: 'Exemplo' });
    expect(list.parentElement).toBe(screen.getByTestId('contêiner'));
    expect(list).toHaveClass('tabs');
  });

  it('outras teclas não trocam de aba', async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(<Harness onChange={onChange} />);
    screen.getByRole('tab', { name: 'Primeira' }).focus();

    await user.keyboard('x{ArrowDown}');

    expect(onChange).not.toHaveBeenCalled();
  });
});
