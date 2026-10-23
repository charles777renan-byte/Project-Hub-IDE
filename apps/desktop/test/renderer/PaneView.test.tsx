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
    onEnd: vi.fn(),
    onDetach: vi.fn(),
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

  it('provedor indisponível desabilita o botão e mostra o motivo', () => {
    setup({
      leaf: emptyLeaf,
      terminal: undefined,
      provider: { ...provider, available: false, reason: 'Comando não encontrado' },
    });
    expect(screen.getByRole('button', { name: 'Iniciar Claude Code' })).toBeDisabled();
    expect(screen.getByRole('status')).toHaveTextContent('Comando não encontrado');
  });

  it('mostra a falha em um alerta', () => {
    setup({ leaf: emptyLeaf, terminal: undefined, error: 'Não abriu' });
    expect(screen.getByRole('alert')).toHaveTextContent('Não abriu');
  });

  it('sessão em andamento mostra título, estado, etiqueta, terminal e ações', () => {
    setup({ terminal: { ...session, origin: 'recovered' }, active: true });
    expect(screen.getByText('Corrigir login')).toBeInTheDocument();
    expect(screen.getByText('Ativo')).toBeInTheDocument();
    expect(screen.getByText('recuperada')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Encerrar' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Tirar do painel' })).toBeInTheDocument();
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

  it('sessão de missão não tem Encerrar, mas pode sair do painel', async () => {
    const { props } = setup({ terminal: { ...session, missionId: 'm1' } });
    expect(screen.queryByRole('button', { name: 'Encerrar' })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Tirar do painel' }));
    expect(props.onDetach).toHaveBeenCalledTimes(1);
  });

  it('encerrar pede confirmação antes de chamar onEnd', async () => {
    const { props } = setup();
    await userEvent.click(screen.getByRole('button', { name: 'Encerrar' }));
    expect(props.onEnd).not.toHaveBeenCalled();
    const group = screen.getByRole('group', {
      name: 'Encerrar a sessão? O processo será finalizado.',
    });
    await userEvent.click(within(group).getByRole('button', { name: 'Encerrar' }));
    expect(props.onEnd).toHaveBeenCalledTimes(1);
  });

  it('sessão encerrada mostra o aviso, as ações e a última saída', async () => {
    const { props } = setup({ terminal: { ...session, state: 'exited' } });
    expect(screen.getByRole('status')).toHaveTextContent('A sessão terminou.');
    expect(screen.getByTestId('terminal-view')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Iniciar de novo' }));
    expect(props.onStart).toHaveBeenCalledTimes(1);
    await userEvent.click(screen.getByRole('button', { name: 'Limpar painel' }));
    expect(props.onDetach).toHaveBeenCalledTimes(1);
  });

  it('sessão encerrada de missão não oferece Iniciar de novo', () => {
    setup({ terminal: { ...session, state: 'exited', missionId: 'm1' } });
    expect(screen.queryByRole('button', { name: 'Iniciar de novo' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Limpar painel' })).toBeInTheDocument();
  });

  it('terminalId fora da lista mostra o aviso, sem terminal', () => {
    setup({ terminal: undefined });
    expect(screen.getByRole('status')).toHaveTextContent('A sessão terminou.');
    expect(screen.queryByTestId('terminal-view')).not.toBeInTheDocument();
    // Sem registro não há como saber se era de missão: oferecer reiniciar é o caso comum.
    expect(screen.getByRole('button', { name: 'Iniciar de novo' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Limpar painel' })).toBeInTheDocument();
  });

  it('clicar no painel chama onActivate', async () => {
    const { props } = setup();
    await userEvent.click(screen.getByRole('region', { name: 'Painel Claude Code' }));
    expect(props.onActivate).toHaveBeenCalled();
  });

  it('marca o painel ativo com data-active', () => {
    const { rerender, props } = setup({ active: true });
    const pane = screen.getByRole('region', { name: 'Painel Claude Code' });
    expect(pane).toHaveAttribute('data-active', 'true');
    rerender(<PaneView {...props} active={false} />);
    expect(pane).toHaveAttribute('data-active', 'false');
  });

  it('ocupado desabilita iniciar e encerrar', () => {
    const first = setup({ leaf: emptyLeaf, terminal: undefined, busy: true });
    expect(screen.getByRole('button', { name: 'Iniciar Claude Code' })).toBeDisabled();
    first.unmount();
    const second = setup({ busy: true });
    expect(screen.getByRole('button', { name: 'Encerrar' })).toBeDisabled();
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
});
