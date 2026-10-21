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

  it('outras teclas não trocam de aba', async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(<Harness onChange={onChange} />);
    screen.getByRole('tab', { name: 'Primeira' }).focus();

    await user.keyboard('x{ArrowDown}');

    expect(onChange).not.toHaveBeenCalled();
  });
});
