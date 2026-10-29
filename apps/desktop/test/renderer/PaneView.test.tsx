import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { LayoutLeaf, ProviderInfo, TerminalSummary } from '@project-hub/contracts';
import { describe, expect, it, vi } from 'vitest';
import { PROJECT_UNAVAILABLE_NOTICE_ID } from '../../src/renderer/components/project/ProjectHeader';
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

  it('com a pasta indisponível, o Iniciar do lançador fica desabilitado e aponta para o aviso da página', () => {
    setup({ leaf: emptyLeaf, terminal: undefined, unavailable: true });
    const start = screen.getByRole('button', { name: 'Iniciar Claude Code' });
    expect(start).toBeDisabled();
    expect(start).toHaveAttribute('aria-describedby', PROJECT_UNAVAILABLE_NOTICE_ID);
  });

  it('com a pasta indisponível, os botões de reiniciar ficam desabilitados e apontam para o aviso', () => {
    const first = setup({ terminal: { ...session, state: 'exited' }, unavailable: true });
    const agent = screen.getByRole('button', { name: 'Iniciar nova conversa' });
    expect(agent).toBeDisabled();
    expect(agent).toHaveAttribute('aria-describedby', PROJECT_UNAVAILABLE_NOTICE_ID);
    first.unmount();
    setup({ terminal: undefined, unavailable: true });
    const shell = screen.getByRole('button', { name: 'Iniciar de novo' });
    expect(shell).toBeDisabled();
    expect(shell).toHaveAttribute('aria-describedby', PROJECT_UNAVAILABLE_NOTICE_ID);
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

  it('fechar com a sessão rodando chama onClose na hora, sem pedir confirmação', async () => {
    const { props } = setup();
    expect(screen.queryByRole('button', { name: 'Encerrar' })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Fechar painel' }));
    expect(props.onClose).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('group')).not.toBeInTheDocument();
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
    await userEvent.click(screen.getByRole('button', { name: 'Iniciar nova conversa' }));
    expect(props.onStart).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('button', { name: 'Limpar painel' })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Fechar painel' }));
    expect(props.onClose).toHaveBeenCalledTimes(1);
    expect(props.onDetach).not.toHaveBeenCalled();
  });

  it('sessão encerrada de missão não oferece Iniciar de novo', () => {
    setup({ terminal: { ...session, state: 'exited', missionId: 'm1' } });
    expect(screen.queryByRole('button', { name: 'Iniciar nova conversa' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Iniciar de novo' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Fechar painel' })).toBeInTheDocument();
  });

  it('sessão de agente encerrada oferece Iniciar nova conversa, com a dica do contexto', async () => {
    const user = userEvent.setup();
    setup({ terminal: { ...session, state: 'exited' } });
    const start = screen.getByRole('button', { name: 'Iniciar nova conversa' });
    expect(screen.queryByRole('button', { name: 'Iniciar de novo' })).not.toBeInTheDocument();
    await user.hover(start);
    expect(await screen.findByRole('tooltip', {}, { timeout: 2000 })).toHaveTextContent(
      'O contexto da conversa anterior não volta',
    );
    // A dica descreve o botão; o nome acessível continua sendo o rótulo.
    expect(start).toHaveAccessibleName('Iniciar nova conversa');
    expect(start).toHaveAccessibleDescription('O contexto da conversa anterior não volta');
  });

  it('sessão de shell encerrada mantém Iniciar de novo, sem a dica de conversa', () => {
    setup({ terminal: { ...session, kind: 'shell', state: 'exited' } });
    const start = screen.getByRole('button', { name: 'Iniciar de novo' });
    expect(screen.queryByRole('button', { name: 'Iniciar nova conversa' })).not.toBeInTheDocument();
    expect(start).not.toHaveAttribute('aria-describedby');
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

  describe('gasto de tokens no cabeçalho', () => {
    const usage = {
      inputTokens: 1_234,
      outputTokens: 12_345,
      cacheReadInputTokens: 456_789,
      cacheWrite5mInputTokens: 1_000,
      cacheWrite1hInputTokens: 234,
      estimatedCostUsd: 1.5,
    };
    const detail =
      'Saída: 12.345 tokens · Entrada nova: 1.234 · Cache: 456.789 lidos, 1.234 escritos · ' +
      `Custo estimado a preço de lista da API: USD${String.fromCharCode(0xa0)}1,50 (não é fatura)`;
    const indicator = (container: HTMLElement) => container.querySelector('.pane__usage');

    it('mostra a saída no formato curto, entre o título e a marca de estado, com o detalhe na dica', () => {
      const { container } = setup({ terminal: { ...session, usage } });
      const head = container.querySelector('.pane__head') as HTMLElement;
      const element = indicator(container);
      expect(element).not.toBeNull();
      expect(element).toHaveAttribute('title', detail);
      expect(within(element as HTMLElement).getByText('12.345 tokens')).toBeInTheDocument();
      // A ordem do cabeçalho: título, gasto, marca de estado, etiqueta e ações.
      expect([...head.children].map((child) => child.className)).toEqual([
        'pane__title',
        'pane__usage',
        'state-mark state-mark--active',
        'pane__tag',
        'pane__actions',
      ]);
    });

    it('o leitor de tela lê o nome e o detalhe inteiro, não o número curto', () => {
      const { container } = setup({ terminal: { ...session, usage } });
      // O texto fica fora da vista, mas no fluxo de leitura (a classe o esconde só visualmente).
      const spoken = container.querySelector('.pane__usage-sr');
      expect(spoken?.textContent).toBe(`Tokens deste terminal. ${detail}`);
      expect(spoken).not.toHaveAttribute('aria-hidden');
      expect(spoken?.closest('[aria-hidden="true"]')).toBeNull();
      expect(screen.getByText('12.345 tokens')).toHaveAttribute('aria-hidden', 'true');
      // Sem região viva: a lista é relida a cada 2 s.
      expect(indicator(container)?.closest('[aria-live], [role="status"]')).toBeNull();
    });

    it('sem custo, a dica diz que a estimativa está indisponível', () => {
      const { container } = setup({
        terminal: { ...session, usage: { inputTokens: 10, outputTokens: 872 } },
      });
      expect(screen.getByText('872 tokens')).toBeInTheDocument();
      expect(indicator(container)).toHaveAttribute(
        'title',
        'Saída: 872 tokens · Entrada nova: 10 · Cache: 0 lidos, 0 escritos · Custo estimado indisponível',
      );
    });

    it('sem usage não há indicador (nem zero), e o resto do cabeçalho não muda', () => {
      const { container } = setup();
      expect(indicator(container)).toBeNull();
      expect(screen.queryByText(/tokens/)).not.toBeInTheDocument();
      expect(container.querySelector('.pane__head')?.children).toHaveLength(4);
    });

    it('provedor que não informa o gasto (Codex, shell) fica como hoje', () => {
      const { container } = setup({
        terminal: { ...session, provider: 'codex', kind: 'shell' },
        provider: { id: 'codex', label: 'Codex', available: true },
      });
      expect(indicator(container)).toBeNull();
    });

    it('atualiza quando o usage muda no mesmo painel, e some quando ele deixa de vir', () => {
      const { container, rerender, props } = setup({
        terminal: { ...session, usage: { inputTokens: 1, outputTokens: 999 } },
      });
      const terminalView = screen.getByTestId('terminal-view');
      expect(screen.getByText('999 tokens')).toBeInTheDocument();
      rerender(
        <PaneView
          {...props}
          terminal={{ ...session, usage: { inputTokens: 1, outputTokens: 1_234_567 } }}
        />,
      );
      expect(screen.getByText('1,2 mi tokens')).toBeInTheDocument();
      expect(screen.queryByText('999 tokens')).not.toBeInTheDocument();
      // O mesmo terminal continua montado: só o número mudou.
      expect(screen.getByTestId('terminal-view')).toBe(terminalView);
      rerender(<PaneView {...props} terminal={session} />);
      expect(indicator(container)).toBeNull();
    });

    it('o painel de um terminal de missão (agent) mostra o mesmo indicador', () => {
      setup({ terminal: { ...session, kind: 'agent', missionId: 'm1', usage } });
      expect(screen.getByText('12.345 tokens')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Tirar do painel' })).toBeInTheDocument();
    });

    it('a sessão encerrada não mostra o indicador (o cabeçalho é o aviso)', () => {
      const { container } = setup({ terminal: { ...session, state: 'exited', usage } });
      expect(indicator(container)).toBeNull();
    });

    it('clicar e dar duplo clique no gasto ativa e maximiza como o resto do cabeçalho', async () => {
      const onMaximize = vi.fn();
      const { props } = setup({ terminal: { ...session, usage }, onMaximize });
      const value = screen.getByText('12.345 tokens');
      await userEvent.click(value);
      expect(props.onActivate).toHaveBeenCalled();
      await userEvent.dblClick(value);
      expect(onMaximize).toHaveBeenCalled();
    });
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
