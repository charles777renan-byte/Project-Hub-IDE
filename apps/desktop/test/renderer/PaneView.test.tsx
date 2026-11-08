import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { LayoutLeaf, ProviderInfo, TerminalSummary } from '@project-hub/contracts';
import { describe, expect, it, vi } from 'vitest';
import { PROJECT_UNAVAILABLE_NOTICE_ID } from '../../src/renderer/components/project/ProjectHeader';
import {
  needsCloseConfirmation,
  PaneView,
  type PaneViewProps,
} from '../../src/renderer/workspace/PaneView';

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
    // O título da sessão é texto visível na linha 1, e o nome do projeto vai na dica dele.
    const title = screen.getByText('Corrigir login');
    expect(title).toHaveClass('pane__title');
    expect(title).not.toHaveClass('state-mark__sr');
    expect(title).toHaveAttribute('title', 'app');
    // O selo tem forma e rótulo visíveis; a origem da sessão só na dica.
    const seal = container.querySelector('.pane__state') as HTMLElement;
    expect(seal).toHaveClass('state-mark--active');
    expect(seal).toHaveAttribute('title', 'Ativo · sessão recuperada');
    expect(seal.querySelector('[aria-hidden="true"]')).toHaveTextContent('●');
    expect(screen.getByText('Ativo')).not.toHaveClass('state-mark__sr');
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

  describe('cabeçalho de duas linhas da sessão viva', () => {
    const line2 = (container: HTMLElement) =>
      container.querySelector('.pane__line2') as HTMLElement;

    it('a linha 1 leva título e selo; a linha 2, modelo e worktree; maximizar e fechar ao lado', () => {
      const { container } = setup({
        terminal: {
          ...session,
          title: 'Claude · app',
          model: 'claude-opus-4-8',
          worktreeName: 'feat/clima',
        },
        onMaximize: vi.fn(),
      });
      const head = container.querySelector('.pane__head') as HTMLElement;
      expect(head).toHaveClass('pane__head--live');
      expect([...head.children].map((child) => child.className)).toEqual([
        'pane__provider',
        'pane__lines',
        'pane__actions',
      ]);
      const line1 = head.querySelector('.pane__line1') as HTMLElement;
      expect([...line1.children].map((child) => child.className.split(' ')[0])).toEqual([
        'pane__title',
        'pane__state',
      ]);
      expect(within(head).getByRole('button', { name: 'Maximizar painel' })).toBeInTheDocument();
      expect(
        within(head).getByRole('button', { name: 'Mais ações do painel' }),
      ).toBeInTheDocument();
      const second = line2(container);
      expect(within(second).getByText('Opus')).toBeInTheDocument();
      expect(within(second).getByText('feat/clima')).toHaveClass('pane__worktree');
    });

    it('o título do bloco leva o nome do projeto na dica', () => {
      setup({ terminal: { ...session, title: 'Claude · app', projectName: 'meu-projeto' } });
      expect(screen.getByText('Claude · app')).toHaveAttribute('title', 'meu-projeto');
    });

    it('sem modelo, a linha 2 mostra o nome do programa', () => {
      const { container } = setup();
      expect(container.querySelector('.pane__model')).toHaveTextContent('Claude Code');
    });

    it('modelo que a tabela não conhece cai no nome do programa', () => {
      const { container } = setup({ terminal: { ...session, model: 'modelo-estranho' } });
      expect(container.querySelector('.pane__model')).toHaveTextContent('Claude Code');
    });

    it('sem worktree, a linha 2 não tem o campo da worktree', () => {
      const { container } = setup({ terminal: { ...session, model: 'claude-sonnet-4-6' } });
      expect(container.querySelector('.pane__worktree')).toBeNull();
      expect(container.querySelector('.pane__model')).toHaveTextContent('Sonnet');
    });

    it('terminal de missão mostra o nome do programa e nunca a barra de contexto', () => {
      const { container } = setup({ terminal: { ...session, missionId: 'm1' } });
      expect(container.querySelector('.pane__model')).toHaveTextContent('Claude Code');
      expect(container.querySelector('.pane__context')).toBeNull();
      expect(screen.getByRole('button', { name: 'Mais ações do painel' })).toBeInTheDocument();
    });

    it('com contexto, a barra fica à direita da linha 2, depois da pílula de tokens', () => {
      const { container } = setup({
        terminal: {
          ...session,
          usage: { inputTokens: 1, outputTokens: 1_000 },
          context: { usedTokens: 76_000, windowTokens: 200_000 },
        },
      });
      expect([...line2(container).children].map((child) => child.className.split(' ')[0])).toEqual([
        'pane__model',
        'pane__usage',
        'pane__context',
      ]);
      expect(screen.getByText('38%')).toBeInTheDocument();
    });

    it('sem contexto não há barra, e sem usage não há pílula', () => {
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

    it('mostra a saída no formato curto, na linha 2 do cabeçalho, com o detalhe na dica', () => {
      const { container } = setup({ terminal: { ...session, usage } });
      const head = container.querySelector('.pane__head') as HTMLElement;
      const element = indicator(container);
      expect(element).not.toBeNull();
      expect(element).toHaveAttribute('title', detail);
      expect(within(element as HTMLElement).getByText('12,3k tokens')).toBeInTheDocument();
      // A ordem do cabeçalho: símbolo do programa, o bloco das duas linhas e as ações.
      expect([...head.children].map((child) => child.className)).toEqual([
        'pane__provider',
        'pane__lines',
        'pane__actions',
      ]);
      expect(element?.closest('.pane__line2')).not.toBeNull();
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
      expect(container.querySelector('.pane__head')?.children).toHaveLength(3);
      expect(container.querySelector('.pane__line2')).not.toBeNull();
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
