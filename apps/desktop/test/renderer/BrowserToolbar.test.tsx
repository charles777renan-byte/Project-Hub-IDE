import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { BrowserTabDto } from '@project-hub/contracts';
import { describe, expect, it, vi } from 'vitest';
import { BrowserToolbar } from '../../src/renderer/components/right-panel/BrowserToolbar';
import { browserTab } from './browser-fixtures';

function setup(
  tab: BrowserTabDto = browserTab(),
  extra: { notice?: string; expanded?: boolean } = {},
) {
  const handlers = {
    onNavigate: vi.fn(),
    onBack: vi.fn(),
    onForward: vi.fn(),
    onReload: vi.fn(),
    onStop: vi.fn(),
    onToggleExpand: vi.fn(),
    onOpenExternal: vi.fn(),
    onOpenDevtools: vi.fn(),
    onClearData: vi.fn(),
    onMenuOpenChange: vi.fn(),
  };
  const view = render(
    <BrowserToolbar
      tab={tab}
      notice={extra.notice ?? null}
      expanded={extra.expanded ?? false}
      {...handlers}
    />,
  );
  return { handlers, user: userEvent.setup(), ...view };
}

const address = () => screen.getByRole('textbox', { name: 'Endereço' });

describe('BrowserToolbar', () => {
  it('o campo de endereço mostra o endereço da aba e tem a ajuda "Digite uma URL"', () => {
    setup();
    expect(address()).toHaveValue('https://exemplo.com/a');
    expect(address()).toHaveAttribute('placeholder', 'Digite uma URL');
  });

  it('Enter manda o texto digitado', async () => {
    const { user, handlers } = setup(browserTab({ url: '' }));
    await user.type(address(), 'localhost:3000{Enter}');
    expect(handlers.onNavigate).toHaveBeenCalledExactlyOnceWith('localhost:3000');
  });

  it('Esc volta ao endereço da aba', async () => {
    const { user, handlers } = setup();
    await user.clear(address());
    await user.type(address(), 'outra coisa');
    await user.keyboard('{Escape}');
    expect(address()).toHaveValue('https://exemplo.com/a');
    expect(handlers.onNavigate).not.toHaveBeenCalled();
  });

  it('quando a aba muda de endereço, o campo acompanha', () => {
    const { rerender, handlers } = setup();
    rerender(
      <BrowserToolbar
        tab={browserTab({ url: 'https://exemplo.com/b' })}
        notice={null}
        expanded={false}
        {...handlers}
      />,
    );
    expect(address()).toHaveValue('https://exemplo.com/b');
  });

  it('Voltar e Avançar sem histórico ficam aria-disabled e não chamam nada', async () => {
    const { user, handlers } = setup();
    const back = screen.getByRole('button', { name: 'Voltar' });
    const forward = screen.getByRole('button', { name: 'Avançar' });
    expect(back).toHaveAttribute('aria-disabled', 'true');
    expect(forward).toHaveAttribute('aria-disabled', 'true');
    await user.click(back);
    await user.click(forward);
    expect(handlers.onBack).not.toHaveBeenCalled();
    expect(handlers.onForward).not.toHaveBeenCalled();
  });

  it('Voltar e Avançar com histórico chamam as funções', async () => {
    const { user, handlers } = setup(browserTab({ canGoBack: true, canGoForward: true }));
    await user.click(screen.getByRole('button', { name: 'Voltar' }));
    await user.click(screen.getByRole('button', { name: 'Avançar' }));
    expect(screen.getByRole('button', { name: 'Voltar' })).not.toHaveAttribute('aria-disabled');
    expect(handlers.onBack).toHaveBeenCalledTimes(1);
    expect(handlers.onForward).toHaveBeenCalledTimes(1);
  });

  it('Recarregar chama reload', async () => {
    const { user, handlers } = setup();
    await user.click(screen.getByRole('button', { name: 'Recarregar' }));
    expect(handlers.onReload).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('button', { name: 'Parar' })).not.toBeInTheDocument();
  });

  it('carregando, o botão se chama Parar e chama stop', async () => {
    const { user, handlers } = setup(browserTab({ loading: true }));
    await user.click(screen.getByRole('button', { name: 'Parar' }));
    expect(handlers.onStop).toHaveBeenCalledTimes(1);
    expect(handlers.onReload).not.toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: 'Recarregar' })).not.toBeInTheDocument();
  });

  it('Expandir vira Restaurar tamanho', async () => {
    const { user, handlers, rerender } = setup();
    await user.click(screen.getByRole('button', { name: 'Expandir' }));
    expect(handlers.onToggleExpand).toHaveBeenCalledTimes(1);
    rerender(<BrowserToolbar tab={browserTab()} notice={null} expanded {...handlers} />);
    expect(screen.getByRole('button', { name: 'Restaurar tamanho' })).toBeInTheDocument();
  });

  it('o aviso aparece num elemento de status', () => {
    setup(browserTab(), { notice: 'Este tipo de endereço não abre aqui.' });
    expect(screen.getByRole('status')).toHaveTextContent('Este tipo de endereço não abre aqui.');
  });

  it('sem aviso, o elemento de status fica vazio', () => {
    setup();
    expect(screen.getByRole('status')).toBeEmptyDOMElement();
  });

  it.each([
    ['Abrir no navegador do sistema', 'onOpenExternal'],
    ['Inspecionar', 'onOpenDevtools'],
    ['Limpar dados de navegação deste projeto…', 'onClearData'],
  ] as const)('o item "%s" do menu chama a função certa e fecha o menu', async (label, handler) => {
    const { user, handlers } = setup();
    const trigger = screen.getByRole('button', { name: 'Mais ações' });
    await user.click(trigger);
    await user.click(screen.getByRole('menuitem', { name: label }));
    expect(handlers[handler]).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
  });

  it('o menu abre com o foco no primeiro item, anda com as setas e fecha com Esc', async () => {
    const { user } = setup();
    const trigger = screen.getByRole('button', { name: 'Mais ações' });
    await user.click(trigger);
    expect(trigger).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByRole('menuitem', { name: 'Abrir no navegador do sistema' })).toHaveFocus();
    await user.keyboard('{ArrowDown}');
    expect(screen.getByRole('menuitem', { name: 'Inspecionar' })).toHaveFocus();
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
  });

  it('avisa quando o menu abre e quando fecha', async () => {
    const { user, handlers } = setup();
    await user.click(screen.getByRole('button', { name: 'Mais ações' }));
    expect(handlers.onMenuOpenChange).toHaveBeenLastCalledWith(true);
    await user.keyboard('{Escape}');
    expect(handlers.onMenuOpenChange).toHaveBeenLastCalledWith(false);
  });

  it('as dicas da barra abrem para cima, para a página não ficar por cima delas', async () => {
    const { user } = setup();
    await user.tab();
    expect(screen.getByRole('button', { name: 'Voltar' })).toHaveFocus();
    const tip = await screen.findByRole('tooltip');
    expect(tip.closest('[data-side]')).toHaveAttribute('data-side', 'top');
  });

  it('aba sem endereço https não oferece abrir no navegador do sistema', async () => {
    const { user, handlers } = setup(browserTab({ url: 'http://localhost:3000/' }));
    await user.click(screen.getByRole('button', { name: 'Mais ações' }));
    const item = screen.getByRole('menuitem', { name: 'Abrir no navegador do sistema' });
    expect(item).toHaveAttribute('aria-disabled', 'true');
    await user.click(item);
    expect(handlers.onOpenExternal).not.toHaveBeenCalled();
  });
});
