import { act, render, renderHook, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { LayoutLeaf, ProviderInfo, TerminalSummary } from '@project-hub/contracts';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PROJECT_UNAVAILABLE_NOTICE_ID } from '../../src/renderer/components/project/ProjectHeader';
import {
  resetTerminalFocusForTests,
  setTerminalFocus,
  useTerminalFocus,
} from '../../src/renderer/terminal-focus';
import { askBeforeClosing, setAskBeforeClosing } from '../../src/renderer/close-confirm';
import {
  needsCloseConfirmation,
  PaneView,
  type PaneViewProps,
} from '../../src/renderer/workspace/PaneView';

// O xterm precisa de um navegador de verdade. Aqui o terminal é trocado por um marcador.
vi.mock('../../src/renderer/components/terminals/TerminalView', () => ({
  TerminalView: ({ terminalId, active }: { terminalId: string; active?: boolean }) => (
    <div className="terminal-view" data-testid="terminal-view" data-active={String(active)}>
      {terminalId}
      <textarea aria-label="Entrada do terminal" />
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

  it('sessão em andamento mostra o símbolo do programa, a luz de estado, o terminal e as ações', () => {
    const { container } = setup({
      terminal: { ...session, origin: 'recovered' },
      active: true,
      focusTerminal: true,
    });
    const provider = container.querySelector('.pane__provider') as HTMLElement;
    expect(provider.querySelector('svg')).toHaveAttribute('aria-hidden', 'true');
    // O título da sessão é texto visível, e o nome do projeto e o programa vão na dica dele.
    const title = screen.getByText('Corrigir login');
    expect(title).toHaveClass('pane__title');
    expect(title).not.toHaveClass('state-mark__sr');
    expect(title).toHaveAttribute('title', 'app · Claude Code');
    // O selo tem a forma à vista; o rótulo é para o leitor de tela e a dica, junto com a origem da sessão.
    const seal = container.querySelector('.pane__state') as HTMLElement;
    expect(seal).toHaveClass('state-mark--active');
    expect(seal).toHaveAttribute('title', 'Ativo · sessão recuperada');
    expect(seal.querySelector('[aria-hidden="true"]')).toHaveTextContent('●');
    expect(screen.getByText('Ativo')).toHaveClass('state-mark__sr');
    expect(screen.queryByText('recuperada')).not.toBeInTheDocument();
    expect(container.querySelector('.pane__light')).toBeNull();
    // Fechar e tirar do painel moraram em botões soltos; agora são itens do menu ⋯.
    expect(screen.getByRole('button', { name: 'Mais ações do painel' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Fechar painel' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Tirar do painel' })).not.toBeInTheDocument();
    const terminal = screen.getByTestId('terminal-view');
    expect(terminal).toHaveTextContent('t1');
    expect(terminal).toHaveAttribute('data-active', 'true');
  });

  it('sessão nova não leva etiqueta de origem', () => {
    const { container } = setup();
    expect(screen.queryByText('nova')).not.toBeInTheDocument();
    expect(container.querySelector('.pane__state')).toHaveAttribute('title', 'Ativo');
  });

  it('sessão viva e parada mostra Ocioso, com o ponto vazado ◦ e sem pulsar', () => {
    const { container } = setup({ idle: true });
    expect(screen.getByText('Ocioso')).toBeInTheDocument();
    expect(container.querySelector('.pane__state')).toHaveClass('state-mark--idle');
    expect(container.querySelector('.pane__state')).toHaveTextContent('◦');
  });

  it('sessão aguardando mostra Aguardando, com a forma ◐', () => {
    const { container } = setup({ terminal: { ...session, state: 'waiting' } });
    expect(screen.getByText('Aguardando')).toBeInTheDocument();
    expect(container.querySelector('.pane__state')).toHaveClass('state-mark--waiting');
    expect(container.querySelector('.pane__state')).toHaveTextContent('◐');
  });

  it('sessão de missão não tem Encerrar, pode sair do painel e fecha sem confirmar o processo', async () => {
    const { props } = setup({ terminal: { ...session, missionId: 'm1' } });
    expect(screen.queryByRole('button', { name: 'Encerrar' })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Mais ações do painel' }));
    await userEvent.click(screen.getByRole('menuitem', { name: 'Tirar do painel' }));
    expect(props.onDetach).toHaveBeenCalledTimes(1);
    await userEvent.click(screen.getByRole('button', { name: 'Mais ações do painel' }));
    await userEvent.click(
      screen.getByRole('menuitem', { name: 'Fechar painel (a missão continua)' }),
    );
    expect(screen.queryByRole('group')).not.toBeInTheDocument();
    expect(props.onClose).toHaveBeenCalledTimes(1);
  });

  it('fechar com a sessão rodando chama onClose na hora, sem pedir confirmação', async () => {
    const { props } = setup();
    expect(screen.queryByRole('button', { name: 'Encerrar' })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Mais ações do painel' }));
    await userEvent.click(screen.getByRole('menuitem', { name: 'Fechar painel' }));
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

  it('painel ativo sem gesto do usuário não pede o foco do terminal', () => {
    setup({ active: true });
    expect(screen.getByTestId('terminal-view')).toHaveAttribute('data-active', 'false');
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

  it('ocupado desabilita iniciar e fechar', async () => {
    const first = setup({ leaf: emptyLeaf, terminal: undefined, busy: true });
    expect(screen.getByRole('button', { name: 'Iniciar Claude Code' })).toBeDisabled();
    first.unmount();
    const second = setup({ busy: true });
    await userEvent.click(screen.getByRole('button', { name: 'Mais ações do painel' }));
    // Ocupado: o menu abre, mas o item de fechar não age (o pedido em curso ainda não terminou).
    expect(screen.getByRole('menuitem', { name: 'Fechar painel' })).toHaveAttribute(
      'aria-disabled',
      'true',
    );
    await userEvent.keyboard('{Escape}');
    second.unmount();
    setup({ terminal: undefined, busy: true });
    expect(screen.getByRole('button', { name: 'Iniciar de novo' })).toBeDisabled();
  });

  it('título com marcação aparece como texto', () => {
    setup({ terminal: { ...session, title: '<b>x</b>' } });
    const title = screen.getByText('<b>x</b>');
    expect(title).toHaveClass('pane__title');
    expect(title.querySelector('b')).toBeNull();
  });

  it('não há rodapé nem a dica de saída do terminal dentro do painel', () => {
    const { container } = setup({ terminal: { ...session, worktreeName: 'feat-x' }, active: true });
    expect(container.querySelector('.pane__foot')).toBeNull();
    expect(screen.queryByText(/Ctrl\+Shift\+Tab sai do terminal/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Claude Code · app/)).not.toBeInTheDocument();
  });

  describe('cabeçalho de uma linha da sessão viva', () => {
    it('leva ícone, título, selo e ações, na altura do lançador, sem segunda linha', () => {
      const { container } = setup({
        terminal: { ...session, title: 'Claude · app', model: 'claude-opus-4-8' },
        onMaximize: vi.fn(),
      });
      const head = container.querySelector('.pane__head') as HTMLElement;
      expect(head).toHaveClass('pane__head--live');
      expect([...head.children].map((child) => child.className.split(' ')[0])).toEqual([
        'pane__provider',
        'pane__title',
        'pane__state',
        'pane__actions',
      ]);
      expect(container.querySelector('.pane__line1, .pane__line2, .pane__lines')).toBeNull();
      expect(within(head).getByRole('button', { name: 'Maximizar painel' })).toBeInTheDocument();
      expect(
        within(head).getByRole('button', { name: 'Mais ações do painel' }),
      ).toBeInTheDocument();
      // O modelo e a worktree não ocupam o cabeçalho.
      expect(within(head).queryByText('Opus')).not.toBeInTheDocument();
    });

    it('a dica do título junta projeto, modelo, worktree e contexto', () => {
      setup({
        terminal: {
          ...session,
          title: 'Claude · app',
          projectName: 'meu-projeto',
          model: 'claude-opus-4-8',
          worktreeName: 'feat/clima',
          context: { usedTokens: 76_000, windowTokens: 200_000 },
        },
      });
      expect(screen.getByText('Claude · app')).toHaveAttribute(
        'title',
        'meu-projeto · Opus · feat/clima · Contexto: 76.000 de 200.000 tokens (38%)',
      );
    });

    it('sem modelo ou com modelo desconhecido, a dica usa o nome do programa', () => {
      setup({ terminal: { ...session, model: 'modelo-estranho' } });
      expect(screen.getByText(session.title)).toHaveAttribute('title', 'app · Claude Code');
    });

    it('sem worktree e sem contexto, a dica é só projeto e modelo', () => {
      setup({ terminal: { ...session, model: 'claude-sonnet-4-6' } });
      expect(screen.getByText(session.title)).toHaveAttribute('title', 'app · Sonnet');
    });

    it('terminal de missão não recebe o fio de contexto', () => {
      const { container } = setup({ terminal: { ...session, missionId: 'm1' } });
      expect(container.querySelector('.pane__context')).toBeNull();
      expect(screen.getByRole('button', { name: 'Mais ações do painel' })).toBeInTheDocument();
    });

    it('com contexto, o fio é o último filho do cabeçalho, depois das ações', () => {
      const { container } = setup({
        terminal: {
          ...session,
          usage: { inputTokens: 1, outputTokens: 1_000 },
          context: { usedTokens: 76_000, windowTokens: 200_000 },
        },
      });
      const head = container.querySelector('.pane__head') as HTMLElement;
      expect([...head.children].map((child) => child.className.split(' ')[0])).toEqual([
        'pane__provider',
        'pane__title',
        'pane__state',
        'pane__usage',
        'pane__actions',
        'pane__context',
      ]);
      expect(container.querySelector('.pane__context-fill')).toHaveStyle({ width: '38%' });
    });

    it('sem contexto não há fio, e sem usage não há pílula', () => {
      const { container } = setup();
      expect(container.querySelector('.pane__context')).toBeNull();
      expect(container.querySelector('.pane__usage')).toBeNull();
      expect(screen.queryByText('0%')).not.toBeInTheDocument();
    });
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

    it('mostra a saída no formato curto, no cabeçalho, com o detalhe na dica', () => {
      const { container } = setup({ terminal: { ...session, usage } });
      const head = container.querySelector('.pane__head') as HTMLElement;
      const element = indicator(container);
      expect(element).not.toBeNull();
      expect(element).toHaveAttribute('title', detail);
      expect(within(element as HTMLElement).getByText('12,3k tokens')).toBeInTheDocument();
      // A ordem do cabeçalho: símbolo do programa, título, selo, a pílula e as ações.
      expect([...head.children].map((child) => child.className.split(' ')[0])).toEqual([
        'pane__provider',
        'pane__title',
        'pane__state',
        'pane__usage',
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
      expect(screen.getByText('12,3k tokens')).toHaveAttribute('aria-hidden', 'true');
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
      expect(screen.getByText('1,2M tokens')).toBeInTheDocument();
      expect(screen.queryByText('999 tokens')).not.toBeInTheDocument();
      // O mesmo terminal continua montado: só o número mudou.
      expect(screen.getByTestId('terminal-view')).toBe(terminalView);
      rerender(<PaneView {...props} terminal={session} />);
      expect(indicator(container)).toBeNull();
    });

    it('a pílula muda de nível com o gasto: cada faixa de tokens de saída é um nível', () => {
      const { rerender, props } = setup({
        terminal: { ...session, usage: { inputTokens: 1, outputTokens: 872 } },
      });
      const level = () => screen.getByText(/tokens?$/).getAttribute('data-level');
      expect(level()).toBe('0');
      for (const [outputTokens, expected] of [
        [1_000, '1'],
        [20_000, '3'],
        [200_000, '5'],
      ] as const) {
        rerender(
          <PaneView
            {...props}
            terminal={{ ...session, usage: { inputTokens: 1, outputTokens } }}
          />,
        );
        expect(level()).toBe(expected);
      }
    });

    it('outro terminal no mesmo painel mostra o gasto dele direto, sem subir do número do anterior', () => {
      // Com movimento ligado (o jsdom não tem relógio de quadros), uma contagem aproveitada do terminal
      // anterior ficaria parada no número velho, em vez de mostrar o do terminal novo.
      vi.stubGlobal('matchMedia', (query: string) => ({ matches: false, media: query }));
      vi.stubGlobal('requestAnimationFrame', () => 1);
      vi.stubGlobal('cancelAnimationFrame', () => undefined);
      try {
        const { rerender, props } = setup({
          terminal: { ...session, usage: { inputTokens: 1, outputTokens: 1_000 } },
        });
        expect(screen.getByText('1k tokens')).toBeInTheDocument();
        rerender(
          <PaneView
            {...props}
            terminal={{ ...session, id: 't2', usage: { inputTokens: 1, outputTokens: 50_000 } }}
          />,
        );
        expect(screen.getByText('50k tokens')).toHaveAttribute('data-level', '3');
        expect(screen.getByText('50k tokens')).not.toHaveAttribute('data-counting');
      } finally {
        vi.unstubAllGlobals();
      }
    });

    it('o painel de um terminal de missão (agent) mostra o mesmo indicador', () => {
      setup({ terminal: { ...session, kind: 'agent', missionId: 'm1', usage } });
      expect(screen.getByText('12,3k tokens')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Mais ações do painel' })).toBeInTheDocument();
    });

    it('a sessão encerrada não mostra o indicador (o cabeçalho é o aviso)', () => {
      const { container } = setup({ terminal: { ...session, state: 'exited', usage } });
      expect(indicator(container)).toBeNull();
    });

    it('clicar e dar duplo clique no gasto ativa e maximiza como o resto do cabeçalho', async () => {
      const onMaximize = vi.fn();
      const { props } = setup({ terminal: { ...session, usage }, onMaximize });
      const value = screen.getByText('12,3k tokens');
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

describe('needsCloseConfirmation', () => {
  const base: TerminalSummary = { ...session, kind: 'shell', provider: 'claude', state: 'running' };
  it.each([
    ['agente avulso (claude) rodando', { ...base }, true],
    ['agente avulso (codex) rodando', { ...base, provider: 'codex' as const }, true],
    ['agente avulso (opencode) rodando', { ...base, provider: 'opencode' as const }, true],
    ['shell comum rodando', { ...base, provider: 'shell' as const }, false],
    ['agente avulso que terminou', { ...base, state: 'exited' as const }, false],
    ['terminal de missão (agent)', { ...base, kind: 'agent' as const, missionId: 'm1' }, false],
    ['sessão agent sem missão', { ...base, kind: 'agent' as const }, false],
    ['agente avulso aguardando', { ...base, state: 'waiting' as const }, false],
  ])('%s', (_nome, terminal, esperado) => {
    expect(needsCloseConfirmation(terminal)).toBe(esperado);
  });
});

describe('menu ⋯ do painel e confirmação ao fechar', () => {
  // A preferência de perguntar é do app inteiro e vive no localStorage: cada teste parte do padrão (perguntar).
  beforeEach(() => {
    window.localStorage.clear();
  });
  afterEach(() => {
    window.localStorage.clear();
  });

  const avulsoClaude: TerminalSummary = {
    ...session,
    kind: 'shell',
    provider: 'claude',
    state: 'running',
  };
  const abrirMenu = () =>
    userEvent.click(screen.getByRole('button', { name: 'Mais ações do painel' }));

  it('o cabeçalho vivo tem só o menu ⋯ e o maximizar soltos: nem Fechar nem Tirar do painel', () => {
    const { container } = setup({ terminal: avulsoClaude, onMaximize: vi.fn() });
    const actions = container.querySelector('.pane__actions') as HTMLElement;
    expect(within(actions).getByRole('button', { name: 'Maximizar painel' })).toBeInTheDocument();
    const menu = within(actions).getByRole('button', { name: 'Mais ações do painel' });
    // Só ícone: o rótulo é o nome acessível, e o botão não traz texto.
    expect(menu).toHaveTextContent('');
    expect(menu.querySelector('svg')).toHaveAttribute('aria-hidden', 'true');
    expect(within(actions).getAllByRole('button')).toHaveLength(2);
    expect(screen.queryByRole('button', { name: 'Fechar painel' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Tirar do painel' })).not.toBeInTheDocument();
  });

  it('agente avulso vivo: o item pergunta antes; "Voltar" some a pergunta e não fecha', async () => {
    const { props } = setup({ terminal: avulsoClaude });
    await abrirMenu();
    expect(screen.queryByRole('menuitem', { name: 'Fechar painel' })).not.toBeInTheDocument();
    const item = screen.getByRole('menuitem', { name: 'Fechar painel e encerrar…' });
    expect(item).toHaveClass('menu-acoes__item--perigo');
    await userEvent.click(item);
    // Escolher não fecha nada: só mostra a pergunta, numa faixa abaixo do cabeçalho.
    expect(props.onClose).not.toHaveBeenCalled();
    const question = screen.getByRole('group', {
      name: 'Encerrar o Claude Code e fechar o painel? O processo para.',
    });
    expect(question.closest('.pane__confirm')).not.toBeNull();
    expect(screen.getByRole('button', { name: 'Fechar e encerrar' })).toBeInTheDocument();
    // A escolha segura recebe o foco, já que o item do menu sumiu.
    expect(screen.getByRole('button', { name: 'Voltar' })).toHaveFocus();

    await userEvent.click(screen.getByRole('button', { name: 'Voltar' }));
    expect(screen.queryByRole('group')).not.toBeInTheDocument();
    expect(props.onClose).not.toHaveBeenCalled();
    // O foco volta ao menu ⋯.
    expect(screen.getByRole('button', { name: 'Mais ações do painel' })).toHaveFocus();
  });

  it('agente avulso vivo: confirmar chama onClose uma vez e some a pergunta', async () => {
    const { props } = setup({ terminal: avulsoClaude });
    await abrirMenu();
    await userEvent.click(screen.getByRole('menuitem', { name: 'Fechar painel e encerrar…' }));
    await userEvent.click(screen.getByRole('button', { name: 'Fechar e encerrar' }));
    expect(props.onClose).toHaveBeenCalledTimes(1);
    expect(props.onDetach).not.toHaveBeenCalled();
    expect(screen.queryByRole('group')).not.toBeInTheDocument();
  });

  it('a pergunta cai sozinha se o agente terminar enquanto ela está aberta', async () => {
    const { props, rerender } = setup({ terminal: avulsoClaude });
    await abrirMenu();
    await userEvent.click(screen.getByRole('menuitem', { name: 'Fechar painel e encerrar…' }));
    expect(screen.getByRole('group')).toBeInTheDocument();
    rerender(<PaneView {...props} terminal={{ ...avulsoClaude, state: 'exited' }} />);
    expect(screen.queryByRole('group')).not.toBeInTheDocument();
  });

  it('a pergunta traz a caixa "Não perguntar de novo", desmarcada, entre a pergunta e os botões', async () => {
    setup({ terminal: avulsoClaude });
    await abrirMenu();
    await userEvent.click(screen.getByRole('menuitem', { name: 'Fechar painel e encerrar…' }));
    const box = screen.getByRole('checkbox', { name: 'Não perguntar de novo' });
    expect(box).not.toBeChecked();
    const group = screen.getByRole('group', {
      name: 'Encerrar o Claude Code e fechar o painel? O processo para.',
    });
    expect(group).toContainElement(box);
    // Ordem no DOM: pergunta, caixa, "Fechar e encerrar", "Voltar".
    const order = [
      group.firstElementChild as Element,
      box.closest('label') as Element,
      screen.getByRole('button', { name: 'Fechar e encerrar' }),
      screen.getByRole('button', { name: 'Voltar' }),
    ];
    for (let i = 1; i < order.length; i += 1) {
      expect(
        (order[i - 1] as Element).compareDocumentPosition(order[i] as Element) &
          Node.DOCUMENT_POSITION_FOLLOWING,
      ).toBeTruthy();
    }
  });

  it('o menu ⋯ já fechou quando a pergunta aparece', async () => {
    setup({ terminal: avulsoClaude });
    await abrirMenu();
    expect(screen.getByRole('menu')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('menuitem', { name: 'Fechar painel e encerrar…' }));
    expect(screen.getByRole('group')).toBeInTheDocument();
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    expect(screen.queryByRole('menuitem')).not.toBeInTheDocument();
  });

  it('marcar a caixa e confirmar fecha e desliga a pergunta para os próximos', async () => {
    const { props } = setup({ terminal: avulsoClaude });
    await abrirMenu();
    await userEvent.click(screen.getByRole('menuitem', { name: 'Fechar painel e encerrar…' }));
    await userEvent.click(screen.getByRole('checkbox', { name: 'Não perguntar de novo' }));
    expect(askBeforeClosing()).toBe(true);
    await userEvent.click(screen.getByRole('button', { name: 'Fechar e encerrar' }));
    expect(props.onClose).toHaveBeenCalledTimes(1);
    expect(askBeforeClosing()).toBe(false);
  });

  it('confirmar com a caixa desmarcada não guarda nada', async () => {
    const { props } = setup({ terminal: avulsoClaude });
    await abrirMenu();
    await userEvent.click(screen.getByRole('menuitem', { name: 'Fechar painel e encerrar…' }));
    await userEvent.click(screen.getByRole('button', { name: 'Fechar e encerrar' }));
    expect(props.onClose).toHaveBeenCalledTimes(1);
    expect(askBeforeClosing()).toBe(true);
  });

  it('marcar a caixa e voltar não fecha e não guarda a preferência', async () => {
    const { props } = setup({ terminal: avulsoClaude });
    await abrirMenu();
    await userEvent.click(screen.getByRole('menuitem', { name: 'Fechar painel e encerrar…' }));
    await userEvent.click(screen.getByRole('checkbox', { name: 'Não perguntar de novo' }));
    await userEvent.click(screen.getByRole('button', { name: 'Voltar' }));
    expect(props.onClose).not.toHaveBeenCalled();
    expect(askBeforeClosing()).toBe(true);
    // Perguntar de novo: a caixa volta desmarcada.
    await abrirMenu();
    await userEvent.click(screen.getByRole('menuitem', { name: 'Fechar painel e encerrar…' }));
    expect(screen.getByRole('checkbox', { name: 'Não perguntar de novo' })).not.toBeChecked();
  });

  it('com a pergunta desligada, o item é "Fechar painel e encerrar" e fecha direto', async () => {
    setAskBeforeClosing(false);
    const { props } = setup({ terminal: avulsoClaude });
    await abrirMenu();
    expect(
      screen.queryByRole('menuitem', { name: 'Fechar painel e encerrar…' }),
    ).not.toBeInTheDocument();
    const item = screen.getByRole('menuitem', { name: 'Fechar painel e encerrar' });
    expect(item).toHaveClass('menu-acoes__item--perigo');
    await userEvent.click(item);
    expect(props.onClose).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('group')).not.toBeInTheDocument();
  });

  it('desligar a preferência de fora com a pergunta aberta deixa a pessoa decidir', async () => {
    const { props } = setup({ terminal: avulsoClaude });
    await abrirMenu();
    await userEvent.click(screen.getByRole('menuitem', { name: 'Fechar painel e encerrar…' }));
    expect(screen.getByRole('group')).toBeInTheDocument();
    act(() => setAskBeforeClosing(false));
    await userEvent.click(screen.getByRole('button', { name: 'Fechar e encerrar' }));
    expect(props.onClose).toHaveBeenCalledTimes(1);
  });

  it('shell comum e terminal de missão não mudam com a pergunta desligada', async () => {
    setAskBeforeClosing(false);
    const first = setup({ terminal: { ...avulsoClaude, provider: 'shell' } });
    await abrirMenu();
    expect(screen.getAllByRole('menuitem').map((item) => item.textContent)).toEqual([
      'Fechar painel',
    ]);
    first.unmount();
    setup({ terminal: { ...session, missionId: 'm1' } });
    await abrirMenu();
    expect(screen.getAllByRole('menuitem').map((item) => item.textContent)).toEqual([
      'Tirar do painel',
      'Fechar painel (a missão continua)',
    ]);
  });

  it('shell comum: o item é Fechar painel e fecha direto, sem pergunta', async () => {
    const { props } = setup({ terminal: { ...avulsoClaude, provider: 'shell' } });
    await abrirMenu();
    expect(screen.queryByRole('menuitem', { name: /encerrar/ })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('menuitem', { name: 'Fechar painel' }));
    expect(props.onClose).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('group')).not.toBeInTheDocument();
  });

  it('terminal de missão: Tirar do painel e Fechar painel (a missão continua), sem pergunta', async () => {
    const { props } = setup({ terminal: { ...session, missionId: 'm1' } });
    await abrirMenu();
    expect(screen.getAllByRole('menuitem').map((item) => item.textContent)).toEqual([
      'Tirar do painel',
      'Fechar painel (a missão continua)',
    ]);
    await userEvent.click(screen.getByRole('menuitem', { name: 'Tirar do painel' }));
    expect(props.onDetach).toHaveBeenCalledTimes(1);
    await abrirMenu();
    await userEvent.click(
      screen.getByRole('menuitem', { name: 'Fechar painel (a missão continua)' }),
    );
    expect(props.onClose).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('group')).not.toBeInTheDocument();
  });

  it('escolher um item do menu não conta como clique no painel (o foco não vai ao terminal)', async () => {
    // O menu é um portal, mas os eventos do React sobem por ele até o painel. Se o pointerdown de um item
    // pedisse o foco do terminal, o xterm o tomaria e o menu fecharia antes de o clique escolher o item.
    const onPointerActivate = vi.fn();
    setup({ terminal: avulsoClaude, onPointerActivate });
    await abrirMenu();
    expect(onPointerActivate).toHaveBeenCalledTimes(1);
    onPointerActivate.mockClear();
    await userEvent.click(screen.getByRole('menuitem', { name: 'Fechar painel e encerrar…' }));
    expect(onPointerActivate).not.toHaveBeenCalled();
  });

  it('o lançador e a sessão terminada mantêm o botão Fechar painel, sem o menu ⋯', () => {
    const first = setup({ leaf: emptyLeaf, terminal: undefined });
    expect(screen.getByRole('button', { name: 'Fechar painel' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Mais ações do painel' })).not.toBeInTheDocument();
    first.unmount();
    setup({ terminal: { ...avulsoClaude, state: 'exited' } });
    expect(screen.getByRole('button', { name: 'Fechar painel' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Mais ações do painel' })).not.toBeInTheDocument();
  });
});

describe('foco do teclado publicado para a barra de status', () => {
  // O foco vive no store do renderer; `renderHook` o lê de outra raiz, como a barra de status faria.
  const reader = () => renderHook(() => useTerminalFocus());
  const menuButton = () => screen.getByRole('button', { name: 'Mais ações do painel' });
  const focusOn = (element: HTMLElement) => act(() => element.focus());
  const avulsoClaude: TerminalSummary = { ...session, kind: 'shell', provider: 'claude' };
  let outside: HTMLButtonElement;

  beforeEach(() => {
    resetTerminalFocusForTests();
    outside = document.createElement('button');
    outside.textContent = 'fora do painel';
    document.body.append(outside);
  });

  afterEach(() => {
    outside.remove();
    resetTerminalFocusForTests();
  });

  it('focar um elemento do painel de sessão viva publica a chave da folha e o título do terminal', () => {
    const focus = reader();
    setup();
    expect(focus.result.current).toBeNull();
    focusOn(menuButton());
    expect(focus.result.current).toEqual({ key: 'a', title: 'Corrigir login', inTerminal: false });
  });

  it('foco no terminal publica inTerminal: true; no próprio cartão ou num botão do cabeçalho, false', () => {
    const focus = reader();
    const view = setup({ onMaximize: vi.fn() });
    const card = screen.getByRole('region', { name: 'Painel Claude Code' });
    // Ctrl+Shift+Tab leva o foco ao próprio cartão: o painel segue com o teclado, mas o terminal não.
    focusOn(card);
    expect(focus.result.current).toEqual({ key: 'a', title: 'Corrigir login', inTerminal: false });
    focusOn(screen.getByLabelText('Entrada do terminal'));
    expect(focus.result.current).toEqual({ key: 'a', title: 'Corrigir login', inTerminal: true });
    // De volta ao cartão (a saída do terminal) e a um botão do cabeçalho (Tab): sem a dica de sair.
    focusOn(card);
    expect(focus.result.current).toEqual({ key: 'a', title: 'Corrigir login', inTerminal: false });
    focusOn(screen.getByLabelText('Entrada do terminal'));
    focusOn(screen.getByRole('button', { name: 'Maximizar painel' }));
    expect(focus.result.current).toEqual({ key: 'a', title: 'Corrigir login', inTerminal: false });
    view.unmount();
  });

  it('tirar o foco para fora do painel limpa', () => {
    const focus = reader();
    setup();
    focusOn(menuButton());
    focusOn(outside);
    expect(focus.result.current).toBeNull();
  });

  it('mover o foco entre elementos do mesmo painel não limpa', () => {
    const focus = reader();
    setup({ onMaximize: vi.fn() });
    focusOn(screen.getByRole('button', { name: 'Maximizar painel' }));
    expect(focus.result.current).not.toBeNull();
    focusOn(menuButton());
    expect(focus.result.current).toEqual({ key: 'a', title: 'Corrigir login', inTerminal: false });
  });

  it('desmontar o painel com o foco limpa', () => {
    const focus = reader();
    const view = setup();
    focusOn(menuButton());
    expect(focus.result.current).not.toBeNull();
    view.unmount();
    expect(focus.result.current).toBeNull();
  });

  it('desmontar um painel sem o foco não apaga o foco de outro painel', () => {
    const focus = reader();
    const view = setup();
    act(() => setTerminalFocus({ key: 'outro', title: 'Codex', inTerminal: true }));
    view.unmount();
    expect(focus.result.current).toEqual({ key: 'outro', title: 'Codex', inTerminal: true });
  });

  it('o lançador nunca define foco', () => {
    const focus = reader();
    setup({ leaf: emptyLeaf, terminal: undefined });
    focusOn(screen.getByRole('button', { name: 'Fechar painel' }));
    expect(focus.result.current).toBeNull();
    focusOn(screen.getByRole('region', { name: 'Painel Claude Code' }));
    expect(focus.result.current).toBeNull();
  });

  it('a sessão terminada nunca define foco', () => {
    const focus = reader();
    setup({ terminal: { ...session, state: 'exited' } });
    focusOn(screen.getByRole('button', { name: 'Fechar painel' }));
    expect(focus.result.current).toBeNull();
  });

  it('a sessão que termina com o painel focado limpa o foco, e uma sessão viva depois não o refaz sozinha', () => {
    const focus = reader();
    const view = setup();
    focusOn(menuButton());
    expect(focus.result.current).not.toBeNull();
    view.rerender(<PaneView {...view.props} terminal={{ ...session, state: 'exited' }} />);
    expect(focus.result.current).toBeNull();
    // Voltando a ter sessão viva sem um foco novo, o painel não reaparece como focado.
    view.rerender(<PaneView {...view.props} />);
    expect(focus.result.current).toBeNull();
  });

  it('o título que muda com o foco no terminal atualiza o publicado e mantém inTerminal', () => {
    const focus = reader();
    const view = setup();
    focusOn(screen.getByLabelText('Entrada do terminal'));
    view.rerender(<PaneView {...view.props} terminal={{ ...session, title: 'Outro título' }} />);
    expect(focus.result.current).toEqual({ key: 'a', title: 'Outro título', inTerminal: true });
  });

  it('o título que muda com o painel focado atualiza o publicado', () => {
    const focus = reader();
    const view = setup();
    focusOn(menuButton());
    view.rerender(<PaneView {...view.props} terminal={{ ...session, title: 'Outro título' }} />);
    expect(focus.result.current).toEqual({ key: 'a', title: 'Outro título', inTerminal: false });
  });

  it('o elemento focado que some sem blur (troca de aba) não deixa o painel novo como focado', () => {
    const focus = reader();
    const view = setup({ onMaximize: vi.fn() });
    focusOn(screen.getByRole('button', { name: 'Maximizar painel' }));
    expect(focus.result.current).toEqual({ key: 'a', title: 'Corrigir login', inTerminal: false });
    // Modo "um painel por vez": a mesma instância recebe outra folha, e o botão focado sai do DOM sem blur.
    const other: LayoutLeaf = { ...leaf, id: 'b', terminalId: 't2' };
    const { onMaximize: _removed, ...rest } = view.props;
    view.rerender(
      <PaneView {...rest} leaf={other} terminal={{ ...session, id: 't2', title: 'Segundo' }} />,
    );
    expect(document.activeElement).toBe(document.body);
    expect(focus.result.current).toBeNull();
  });

  it('dois painéis: o foco que passa de um ao outro mostra sempre o painel certo', () => {
    const focus = reader();
    const second: LayoutLeaf = { ...leaf, id: 'b', terminalId: 't2' };
    render(
      <>
        <PaneView
          leaf={leaf}
          terminal={session}
          provider={provider}
          active
          busy={false}
          onActivate={vi.fn()}
          onStart={vi.fn()}
          onDetach={vi.fn()}
          onClose={vi.fn()}
        />
        <PaneView
          leaf={second}
          terminal={{ ...session, id: 't2', title: 'Segundo' }}
          provider={provider}
          active={false}
          busy={false}
          onActivate={vi.fn()}
          onStart={vi.fn()}
          onDetach={vi.fn()}
          onClose={vi.fn()}
        />
      </>,
    );
    const [first, other] = screen.getAllByRole('button', { name: 'Mais ações do painel' });
    focusOn(first as HTMLElement);
    expect(focus.result.current).toEqual({ key: 'a', title: 'Corrigir login', inTerminal: false });
    focusOn(other as HTMLElement);
    expect(focus.result.current).toEqual({ key: 'b', title: 'Segundo', inTerminal: false });
    focusOn(outside);
    expect(focus.result.current).toBeNull();
  });

  it('o foco que entra no menu ⋯ (um portal) não conta como o terminal com o teclado', async () => {
    // O menu é um portal, mas o `onFocus` e o `onBlur` do React sobem por ele até o painel.
    const focus = reader();
    setup({ terminal: avulsoClaude });
    focusOn(menuButton());
    expect(focus.result.current).not.toBeNull();
    await userEvent.keyboard('{Enter}');
    const item = await screen.findByRole('menuitem', { name: 'Fechar painel e encerrar…' });
    expect(item.closest('.pane')).toBeNull();
    expect(item.ownerDocument.activeElement).not.toBe(menuButton());
    // O foco saiu do painel para o portal: a barra de status não diz mais "Foco".
    expect(focus.result.current).toBeNull();
    // Passear pelos itens do menu também não publica nada.
    await userEvent.keyboard('{ArrowDown}');
    expect(focus.result.current).toBeNull();
    // Fechar o menu devolve o foco ao botão ⋯, que está dentro do painel: o teclado voltou.
    await userEvent.keyboard('{Escape}');
    expect(menuButton()).toHaveFocus();
    expect(focus.result.current).toEqual({ key: 'a', title: 'Corrigir login', inTerminal: false });
  });
});
