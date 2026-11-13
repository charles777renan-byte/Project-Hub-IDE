import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { BrowserTabDto } from '@project-hub/contracts';
import { describe, expect, it, vi } from 'vitest';
import { BrowserPageTabs } from '../../src/renderer/components/right-panel/BrowserPageTabs';
import { browserTab } from './browser-fixtures';

const TABS = [
  browserTab({ id: 't1', title: 'Exemplo' }),
  browserTab({ id: 't2', title: 'Docs', url: 'https://docs.exemplo.com/' }),
];

function setup(tabs: BrowserTabDto[] = TABS, activeTabId = 't1') {
  const handlers = { onSelect: vi.fn(), onClose: vi.fn(), onNew: vi.fn() };
  render(<BrowserPageTabs tabs={tabs} activeTabId={activeTabId} {...handlers} />);
  return { handlers, user: userEvent.setup() };
}

const list = () => screen.getByRole('tablist', { name: 'Abas do navegador' });

describe('BrowserPageTabs', () => {
  it('é um tablist com uma aba por página, e a ativa tem aria-selected', () => {
    setup();
    const tabs = within(list()).getAllByRole('tab');
    expect(tabs).toHaveLength(2);
    expect(tabs[0]).toHaveAttribute('aria-selected', 'true');
    expect(tabs[1]).toHaveAttribute('aria-selected', 'false');
    expect(tabs[0]).toHaveTextContent('Exemplo');
    expect(tabs[1]).toHaveTextContent('Docs');
  });

  it('clicar numa aba a seleciona', async () => {
    const { user, handlers } = setup();
    await user.click(screen.getByRole('tab', { name: 'Docs' }));
    expect(handlers.onSelect).toHaveBeenCalledExactlyOnceWith('t2');
  });

  it('as setas andam entre as abas', async () => {
    const { user, handlers } = setup();
    screen.getByRole('tab', { name: 'Exemplo' }).focus();
    await user.keyboard('{ArrowRight}');
    expect(handlers.onSelect).toHaveBeenLastCalledWith('t2');
    expect(screen.getByRole('tab', { name: 'Docs' })).toHaveFocus();
    await user.keyboard('{ArrowLeft}');
    expect(handlers.onSelect).toHaveBeenLastCalledWith('t1');
  });

  it('só a aba ativa entra na ordem do Tab', () => {
    setup();
    expect(screen.getByRole('tab', { name: 'Exemplo' })).toHaveAttribute('tabindex', '0');
    expect(screen.getByRole('tab', { name: 'Docs' })).toHaveAttribute('tabindex', '-1');
  });

  it('Fechar aba fecha e não seleciona', async () => {
    const { user, handlers } = setup();
    const buttons = screen.getAllByRole('button', { name: /^Fechar aba/ });
    expect(buttons).toHaveLength(2);
    await user.click(buttons[1] as HTMLElement);
    expect(handlers.onClose).toHaveBeenCalledExactlyOnceWith('t2');
    expect(handlers.onSelect).not.toHaveBeenCalled();
  });

  it('o botão de fechar diz qual aba fecha', () => {
    setup();
    expect(screen.getByRole('button', { name: 'Fechar aba Docs' })).toBeInTheDocument();
  });

  it('Nova aba abre uma aba', async () => {
    const { user, handlers } = setup();
    await user.click(screen.getByRole('button', { name: 'Nova aba' }));
    expect(handlers.onNew).toHaveBeenCalledTimes(1);
  });

  it('aba carregando tem o texto "carregando" para leitor de tela', () => {
    setup([browserTab({ id: 't1', title: 'Exemplo', loading: true })]);
    expect(screen.getByRole('tab')).toHaveTextContent('carregando');
  });

  it('aba que não está carregando não diz "carregando"', () => {
    setup([browserTab({ id: 't1', title: 'Exemplo' })]);
    expect(screen.getByRole('tab')).not.toHaveTextContent('carregando');
  });

  it('aba sem título nem endereço se chama "Nova aba"', () => {
    setup([browserTab({ id: 't1', title: '', url: '' })]);
    expect(screen.getByRole('tab')).toHaveTextContent('Nova aba');
  });

  it('aba sem título mostra o endereço sem o esquema', () => {
    setup([
      browserTab({ id: 't1', title: '', url: 'http://localhost:3000/painel', loading: true }),
    ]);
    expect(screen.getByRole('tab')).toHaveTextContent('localhost:3000/painel');
    expect(screen.getByRole('tab')).not.toHaveTextContent('http://');
  });
});
