import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { NavigatorTab } from '../../src/renderer/components/right-panel/NavigatorTab';
import {
  TOGGLE_RIGHT_EXPANDED_EVENT,
  TOGGLE_RIGHT_PANEL_EVENT,
} from '../../src/renderer/right-panel-events';
import { browserState, browserTab, installBrowserApi } from './browser-fixtures';

afterEach(() => {
  vi.restoreAllMocks();
});

const address = () => screen.findByRole('textbox', { name: 'Endereço' });

describe('NavigatorTab', () => {
  it('lê o estado do projeto e mostra as abas e o endereço da ativa', async () => {
    const { api } = installBrowserApi();
    render(<NavigatorTab projectId="p1" />);
    expect(await address()).toHaveValue('https://exemplo.com/a');
    expect(api.state).toHaveBeenCalledExactlyOnceWith('p1');
    expect(screen.getByRole('tab', { name: 'Exemplo' })).toHaveAttribute('aria-selected', 'true');
  });

  it('troca o estado quando chega um evento do mesmo projeto', async () => {
    const { emit } = installBrowserApi();
    render(<NavigatorTab projectId="p1" />);
    await address();
    act(() => emit(browserState([browserTab({ title: 'Outro', url: 'https://outro.com/' })])));
    expect(screen.getByRole('tab', { name: 'Outro' })).toBeInTheDocument();
    expect(await address()).toHaveValue('https://outro.com/');
  });

  it('ignora o evento de outro projeto', async () => {
    const { emit } = installBrowserApi();
    render(<NavigatorTab projectId="p1" />);
    await address();
    act(() => emit(browserState([browserTab({ title: 'Alheio' })], 't1', 'p2')));
    expect(screen.queryByRole('tab', { name: 'Alheio' })).not.toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Exemplo' })).toBeInTheDocument();
  });

  it('cancela as assinaturas ao desmontar', async () => {
    const { listeners } = installBrowserApi();
    const { unmount } = render(<NavigatorTab projectId="p1" />);
    await address();
    expect(listeners()).toBe(2);
    unmount();
    expect(listeners()).toBe(0);
  });

  it('o atalho focus-address foca o campo de endereço', async () => {
    const { shortcut } = installBrowserApi();
    render(<NavigatorTab projectId="p1" />);
    const field = await address();
    act(() => shortcut({ projectId: 'p1', action: 'focus-address' }));
    expect(field).toHaveFocus();
  });

  it('o atalho focus-toolbar foca o primeiro botão da barra', async () => {
    const { shortcut } = installBrowserApi();
    render(<NavigatorTab projectId="p1" />);
    await address();
    act(() => shortcut({ projectId: 'p1', action: 'focus-toolbar' }));
    expect(screen.getByRole('button', { name: 'Voltar' })).toHaveFocus();
  });

  it('o atalho de outro projeto não mexe no foco', async () => {
    const { shortcut } = installBrowserApi();
    render(<NavigatorTab projectId="p1" />);
    const field = await address();
    act(() => shortcut({ projectId: 'p2', action: 'focus-address' }));
    expect(field).not.toHaveFocus();
  });

  it('o atalho toggle-right-panel dispara o evento do painel direito', async () => {
    const { shortcut } = installBrowserApi();
    const heard = vi.fn();
    window.addEventListener(TOGGLE_RIGHT_PANEL_EVENT, heard);
    render(<NavigatorTab projectId="p1" />);
    await address();
    act(() => shortcut({ projectId: 'p1', action: 'toggle-right-panel' }));
    window.removeEventListener(TOGGLE_RIGHT_PANEL_EVENT, heard);
    expect(heard).toHaveBeenCalledTimes(1);
  });

  it('Enter no endereço navega na aba ativa e mostra o estado que voltou', async () => {
    const { api } = installBrowserApi();
    api.navigate.mockResolvedValueOnce({
      ok: true,
      data: browserState([browserTab({ title: '', url: 'https://novo.com/', loading: true })]),
    });
    const user = userEvent.setup();
    render(<NavigatorTab projectId="p1" />);
    const field = await address();
    await user.clear(field);
    await user.type(field, 'novo.com{Enter}');
    expect(api.navigate).toHaveBeenCalledExactlyOnceWith('p1', 't1', 'novo.com');
    await waitFor(() => expect(field).toHaveValue('https://novo.com/'));
  });

  it('pedido recusado vira aviso junto da barra, e o próximo que dá certo o tira', async () => {
    const { api } = installBrowserApi();
    api.navigate.mockResolvedValueOnce({
      ok: false,
      error: {
        code: 'VALIDATION_FAILED',
        message: 'Este tipo de endereço não abre aqui.',
        retryable: false,
      },
    } as never);
    const user = userEvent.setup();
    render(<NavigatorTab projectId="p1" />);
    const field = await address();
    await user.clear(field);
    await user.type(field, 'file:///c:/x{Enter}');
    expect(await screen.findByText('Este tipo de endereço não abre aqui.')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Nova aba' }));
    await waitFor(() => expect(screen.getByRole('status')).toBeEmptyDOMElement());
  });

  it('os botões agem na aba ativa do projeto', async () => {
    const { api } = installBrowserApi(
      browserState([browserTab({ canGoBack: true, canGoForward: true })]),
    );
    const user = userEvent.setup();
    render(<NavigatorTab projectId="p1" />);
    await address();
    await user.click(screen.getByRole('button', { name: 'Voltar' }));
    await user.click(screen.getByRole('button', { name: 'Avançar' }));
    await user.click(screen.getByRole('button', { name: 'Recarregar' }));
    await user.click(screen.getByRole('button', { name: 'Nova aba' }));
    await user.click(screen.getByRole('button', { name: 'Fechar aba Exemplo' }));
    expect(api.back).toHaveBeenCalledWith('p1', 't1');
    expect(api.forward).toHaveBeenCalledWith('p1', 't1');
    expect(api.reload).toHaveBeenCalledWith('p1', 't1');
    expect(api.openTab).toHaveBeenCalledWith('p1');
    expect(api.closeTab).toHaveBeenCalledWith('p1', 't1');
  });

  it('o menu chama os canais da aba ativa', async () => {
    const { api } = installBrowserApi();
    const user = userEvent.setup();
    render(<NavigatorTab projectId="p1" />);
    await address();
    for (const label of [
      'Abrir no navegador do sistema',
      'Inspecionar',
      'Limpar dados de navegação deste projeto…',
    ]) {
      await user.click(screen.getByRole('button', { name: 'Mais ações' }));
      await user.click(within(screen.getByRole('menu')).getByRole('menuitem', { name: label }));
    }
    expect(api.openExternal).toHaveBeenCalledWith('p1', 't1');
    expect(api.openDevtools).toHaveBeenCalledWith('p1', 't1');
    expect(api.clearData).toHaveBeenCalledWith('p1');
  });

  it('Expandir dispara o evento de expandir o painel, e o nome do botão segue a propriedade', async () => {
    installBrowserApi();
    const heard = vi.fn();
    window.addEventListener(TOGGLE_RIGHT_EXPANDED_EVENT, heard);
    const user = userEvent.setup();
    const { rerender } = render(<NavigatorTab projectId="p1" />);
    await address();
    await user.click(screen.getByRole('button', { name: 'Expandir' }));
    expect(heard).toHaveBeenCalledTimes(1);
    rerender(<NavigatorTab projectId="p1" expanded />);
    await user.click(screen.getByRole('button', { name: 'Restaurar tamanho' }));
    window.removeEventListener(TOGGLE_RIGHT_EXPANDED_EVENT, heard);
    expect(heard).toHaveBeenCalledTimes(2);
  });

  it('sair da aba com o painel expandido restaura o tamanho', async () => {
    installBrowserApi();
    const heard = vi.fn();
    window.addEventListener(TOGGLE_RIGHT_EXPANDED_EVENT, heard);
    const { unmount } = render(<NavigatorTab projectId="p1" expanded />);
    await address();
    unmount();
    window.removeEventListener(TOGGLE_RIGHT_EXPANDED_EVENT, heard);
    expect(heard).toHaveBeenCalledTimes(1);
  });

  it('sair da aba sem o painel expandido não dispara nada', async () => {
    installBrowserApi();
    const heard = vi.fn();
    window.addEventListener(TOGGLE_RIGHT_EXPANDED_EVENT, heard);
    const { unmount } = render(<NavigatorTab projectId="p1" />);
    await address();
    unmount();
    window.removeEventListener(TOGGLE_RIGHT_EXPANDED_EVENT, heard);
    expect(heard).not.toHaveBeenCalled();
  });

  it('com o menu Mais ações aberto, a página dá lugar à imagem parada', async () => {
    const { api } = installBrowserApi();
    const user = userEvent.setup();
    render(<NavigatorTab projectId="p1" />);
    await address();
    await user.click(screen.getByRole('button', { name: 'Mais ações' }));
    await waitFor(() => expect(api.snapshot).toHaveBeenCalledWith('p1'));
  });

  it('enquanto o estado não chega, diz que está carregando', () => {
    const { api } = installBrowserApi();
    api.state.mockReturnValueOnce(new Promise(() => undefined) as never);
    render(<NavigatorTab projectId="p1" />);
    expect(screen.getByText('Carregando…')).toBeInTheDocument();
  });

  it('se o estado não pôde ser lido, mostra o erro', async () => {
    const { api } = installBrowserApi();
    api.state.mockResolvedValueOnce({
      ok: false,
      error: { code: 'VALIDATION_FAILED', message: 'O projeto não existe.', retryable: false },
    } as never);
    render(<NavigatorTab projectId="p1" />);
    expect(await screen.findByRole('alert')).toHaveTextContent('O projeto não existe.');
  });
});
