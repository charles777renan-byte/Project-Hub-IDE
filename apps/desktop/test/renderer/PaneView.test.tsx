import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { LayoutLeaf, ProviderInfo, TerminalSummary } from '@project-hub/contracts';
import { describe, expect, it, vi } from 'vitest';
import { PaneView, type PaneViewProps } from '../../src/renderer/workspace/PaneView';

// O xterm precisa de um navegador de verdade. Aqui o terminal é trocado por um marcador.
vi.mock('../../src/renderer/components/terminals/TerminalView', () => ({
  TerminalView: ({ terminalId, active }: { terminalId: string; active?: boolean }) => (
    <div data-testid="terminal-view" data-active={String(active)}>
      {terminalId}
    </div>
  ),
}));

const emptyLeaf: LayoutLeaf = { type: 'leaf', id: 'a', provider: 'claude', terminalId: null };
const leaf: LayoutLeaf = { ...emptyLeaf, terminalId: 't1' };
const provider: ProviderInfo = { id: 'claude', label: 'Claude Code', available: true };
const session: TerminalSummary = {
  id: 't1',
  kind: 'agent',
  title: 'Corrigir login',
  projectId: 'p1',
  projectName: 'app',
  state: 'running',
  provider: 'claude',
  origin: 'new',
};

function setup(over: Partial<PaneViewProps> = {}) {
  const props: PaneViewProps = {
    leaf,
    terminal: session,
    provider,
    projectName: 'app',
    active: false,
    busy: false,
    onActivate: vi.fn(),
    onStart: vi.fn(),
    onDetach: vi.fn(),
    onClose: vi.fn(),
    ...over,
  };
  const view = render(<PaneView {...props} />);
  return { props, ...view };
}

describe('PaneView', () => {
  it('sem sessão mostra o lançador com o botão de iniciar', async () => {
    const { props } = setup({ leaf: emptyLeaf, terminal: undefined });
    expect(screen.getByRole('region', { name: 'Painel Claude Code' })).toBeInTheDocument();
    expect(screen.getByText('Nenhuma sessão neste painel')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Iniciar Claude Code' }));
    expect(props.onStart).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId('terminal-view')).not.toBeInTheDocument();
  });

  it('sem sessão, o lançador é um estado vazio: ícone decorativo, título e o botão como ação', () => {
    const { container } = setup({ leaf: emptyLeaf, terminal: undefined });
    const title = screen.getByText('Nenhuma sessão neste painel');
    expect(title).toHaveClass('empty-state__title');
    const empty = title.closest('.empty-state');
    expect(empty).not.toBeNull();
    expect(empty?.querySelector('svg')).toHaveAttribute('aria-hidden', 'true');
    const start = screen.getByRole('button', { name: 'Iniciar Claude Code' });
    expect(start.closest('.empty-state__action')).not.toBeNull();
    // O cartão mantém o cabeçalho com o nome do programa.
    expect(container.querySelector('.pane__head .pane__title')).toHaveTextContent('Claude Code');
  });

  it('provedor indisponível desabilita o botão e mostra o motivo', () => {
    setup({
      leaf: emptyLeaf,
      terminal: undefined,
      provider: { ...provider, available: false, reason: 'Comando não encontrado' },
    });
    expect(screen.getByRole('button', { name: 'Iniciar Claude Code' })).toBeDisabled();
    expect(screen.getByRole('status')).toHaveTextContent('Comando não encontrado');
    // O motivo é a dica do estado vazio, dentro do cartão (a CSS dá o respiro dele).
    expect(screen.getByRole('status').closest('.empty-state')).not.toBeNull();
  });

  it('mostra a falha em um alerta', () => {
    setup({ leaf: emptyLeaf, terminal: undefined, error: 'Não abriu' });
    expect(screen.getByRole('alert')).toHaveTextContent('Não abriu');
  });

  it('sessão em andamento mostra título, estado, etiqueta, terminal e ações', () => {
    setup({ terminal: { ...session, origin: 'recovered' }, active: true, focusTerminal: true });
    expect(screen.getByText('Corrigir login')).toBeInTheDocument();
    expect(screen.getByText('Ativo')).toBeInTheDocument();
    expect(screen.getByText('recuperada')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Fechar painel' })).toBeInTheDocument();
    // Tirar do painel só existe para sessão de missão (o processo dela não se encerra por aqui).
    expect(screen.queryByRole('button', { name: 'Tirar do painel' })).not.toBeInTheDocument();
    const terminal = screen.getByTestId('terminal-view');
    expect(terminal).toHaveTextContent('t1');
    expect(terminal).toHaveAttribute('data-active', 'true');
  });

  it('sessão nova leva a etiqueta nova', () => {
    setup();
    expect(screen.getByText('nova')).toBeInTheDocument();
  });

  it('sessão aguardando mostra Aguardando', () => {
    setup({ terminal: { ...session, state: 'waiting' } });
    expect(screen.getByText('Aguardando')).toBeInTheDocument();
  });

  it('sessão de missão não tem Encerrar, pode sair do painel e fecha sem confirmar o processo', async () => {
    const { props } = setup({ terminal: { ...session, missionId: 'm1' } });
    expect(screen.queryByRole('button', { name: 'Encerrar' })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Tirar do painel' }));
    expect(props.onDetach).toHaveBeenCalledTimes(1);
    await userEvent.click(screen.getByRole('button', { name: 'Fechar painel' }));
    expect(screen.queryByRole('group')).not.toBeInTheDocument();
    expect(props.onClose).toHaveBeenCalledTimes(1);
  });

  it('fechar com a sessão rodando pede confirmação antes de chamar onClose', async () => {
    const { props } = setup();
    expect(screen.queryByRole('button', { name: 'Encerrar' })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Fechar painel' }));
    expect(props.onClose).not.toHaveBeenCalled();
    const group = screen.getByRole('group', {
      name: 'Fechar o painel? O processo será finalizado.',
    });
    await userEvent.click(within(group).getByRole('button', { name: 'Fechar painel' }));
    expect(props.onClose).toHaveBeenCalledTimes(1);
  });

  it('o lançador também tem o botão de fechar painel', async () => {
    const { props } = setup({ leaf: emptyLeaf, terminal: undefined });
    await userEvent.click(screen.getByRole('button', { name: 'Fechar painel' }));
    expect(props.onClose).toHaveBeenCalledTimes(1);
  });

  it('sessão encerrada mostra o aviso, as ações e a última saída', async () => {
    const { props } = setup({ terminal: { ...session, state: 'exited' } });
    expect(screen.getByRole('status')).toHaveTextContent('A sessão terminou.');
    expect(screen.getByTestId('terminal-view')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Iniciar de novo' }));
    expect(props.onStart).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('button', { name: 'Limpar painel' })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Fechar painel' }));
    expect(props.onClose).toHaveBeenCalledTimes(1);
    expect(props.onDetach).not.toHaveBeenCalled();
  });

  it('sessão encerrada de missão não oferece Iniciar de novo', () => {
    setup({ terminal: { ...session, state: 'exited', missionId: 'm1' } });
    expect(screen.queryByRole('button', { name: 'Iniciar de novo' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Fechar painel' })).toBeInTheDocument();
  });

  it('terminalId fora da lista mostra o aviso, sem terminal', () => {
    setup({ terminal: undefined });
    expect(screen.getByRole('status')).toHaveTextContent('A sessão terminou.');
    expect(screen.queryByTestId('terminal-view')).not.toBeInTheDocument();
    // Sem registro não há como saber se era de missão: oferecer reiniciar é o caso comum.
    expect(screen.getByRole('button', { name: 'Iniciar de novo' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Fechar painel' })).toBeInTheDocument();
  });

  it('clicar no painel chama onActivate', async () => {
    const { props } = setup();
    await userEvent.click(screen.getByRole('region', { name: 'Painel Claude Code' }));
    expect(props.onActivate).toHaveBeenCalled();
  });

  it('painel ativo sem gesto do usuário não pede o foco do terminal e mostra a dica de saída', () => {
    setup({ active: true });
    expect(screen.getByTestId('terminal-view')).toHaveAttribute('data-active', 'false');
    expect(screen.getByText(/Ctrl\+Shift\+Tab sai do terminal/)).toBeInTheDocument();
  });

  it('clique usa onPointerActivate quando existe', async () => {
    const onPointerActivate = vi.fn();
    setup({ onPointerActivate });
    await userEvent.click(screen.getByRole('region', { name: 'Painel Claude Code' }));
    expect(onPointerActivate).toHaveBeenCalled();
  });

  it('marca o painel ativo com data-active', () => {
    const { rerender, props } = setup({ active: true });
    const pane = screen.getByRole('region', { name: 'Painel Claude Code' });
    expect(pane).toHaveAttribute('data-active', 'true');
    rerender(<PaneView {...props} active={false} />);
    expect(pane).toHaveAttribute('data-active', 'false');
  });

  it('ocupado desabilita iniciar e fechar', () => {
    const first = setup({ leaf: emptyLeaf, terminal: undefined, busy: true });
    expect(screen.getByRole('button', { name: 'Iniciar Claude Code' })).toBeDisabled();
    first.unmount();
    const second = setup({ busy: true });
    expect(screen.getByRole('button', { name: 'Fechar painel' })).toBeDisabled();
    second.unmount();
    setup({ terminal: undefined, busy: true });
    expect(screen.getByRole('button', { name: 'Iniciar de novo' })).toBeDisabled();
  });

  it('título com marcação aparece como texto', () => {
    setup({ terminal: { ...session, title: '<b>x</b>' } });
    const title = screen.getByText('<b>x</b>');
    expect(title).toHaveAttribute('title', '<b>x</b>');
    expect(title.querySelector('b')).toBeNull();
  });

  it('o rodapé mostra programa e projeto, e a worktree quando há', () => {
    const first = setup();
    expect(screen.getByText('Claude Code · app')).toBeInTheDocument();
    first.unmount();
    setup({ terminal: { ...session, worktreeName: 'feat-x' } });
    expect(screen.getByText(/Claude Code · app/)).toHaveTextContent('feat-x');
  });

  it('o aviso de sessão encerrada anuncia só o texto, não os botões', () => {
    setup({ terminal: { ...session, state: 'exited' } });
    const status = screen.getByRole('status');
    expect(status).toHaveTextContent(/^A sessão terminou\.$/);
    expect(within(status).queryByRole('button')).not.toBeInTheDocument();
  });

  it('com terminal, o rótulo do painel usa o provedor da sessão', () => {
    setup({
      leaf: { ...leaf, provider: 'claude' },
      terminal: { ...session, provider: 'codex' },
      provider: undefined,
    });
    expect(screen.getByRole('region', { name: 'Painel codex' })).toBeInTheDocument();
  });
});
