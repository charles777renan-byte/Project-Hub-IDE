import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ProviderInfo, TerminalSummary } from '@project-hub/contracts';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setAskBeforeClosing } from '../../src/renderer/close-confirm';
import { PaneTabs } from '../../src/renderer/workspace/PaneTabs';
import { show, useFakeIntersectionObserver } from './fake-intersection-observer';

useFakeIntersectionObserver();

const leaf = (
  id: string,
  provider: 'claude' | 'codex' | 'shell',
  terminalId: string | null = null,
) => ({ type: 'leaf', id, provider, terminalId }) as const;

const providers: ProviderInfo[] = [
  { id: 'claude', label: 'Claude Code', available: true },
  { id: 'codex', label: 'Codex', available: false, reason: 'Codex não está instalado.' },
  { id: 'shell', label: 'PowerShell', available: true },
];

const terminal = (id: string, provider: 'claude' | 'codex' | 'shell'): TerminalSummary => ({
  id,
  kind: provider === 'shell' ? 'shell' : 'agent',
  title: provider,
  projectId: 'p1',
  projectName: 'app',
  state: 'running',
  provider,
  origin: 'new',
});

function setup(
  leaves: Parameters<typeof PaneTabs>[0]['leaves'],
  terminals: readonly TerminalSummary[] = [],
  auto = false,
) {
  const onSelect = vi.fn();
  const { unmount } = render(
    <PaneTabs
      leaves={leaves}
      activeId={leaves[0]?.id ?? ''}
      terminals={terminals}
      providers={providers}
      onSelect={onSelect}
      auto={auto}
    />,
  );
  return { onSelect, unmount };
}

/** Os rótulos de cada aba, na ordem da faixa (sem o número de posição). */
function rotulos(): (string | null)[] {
  return screen
    .getAllByRole('tab')
    .map((tab) => tab.querySelector('.pane-tabs__label')?.textContent ?? null);
}

/** Os números de posição de cada aba, na ordem da faixa. */
function numeros(): (string | null)[] {
  return screen
    .getAllByRole('tab')
    .map((tab) => tab.querySelector('.pane-tabs__number')?.textContent ?? null);
}

describe('PaneTabs: rótulos repetidos', () => {
  it('dois painéis Claude e um shell: os Claude ganham número de ordem, o shell fica como está', () => {
    setup([leaf('a', 'claude'), leaf('b', 'shell'), leaf('c', 'claude')]);

    expect(rotulos()).toEqual(['Claude Code 1', 'PowerShell', 'Claude Code 2']);
    expect(numeros()).toEqual(['1', '2', '3']);
    expect(screen.getByRole('tab', { name: /Claude Code 2/ })).toBeInTheDocument();
  });

  it('o nome acessível da aba é só o rótulo, sem o número de posição', () => {
    setup([leaf('a', 'claude'), leaf('b', 'shell'), leaf('c', 'claude')]);

    expect(screen.getByRole('tab', { name: 'Claude Code 1' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'PowerShell' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Claude Code 2' })).toBeInTheDocument();
  });

  it('com um só painel de um programa, o rótulo fica como está', () => {
    setup([leaf('a', 'claude'), leaf('b', 'codex'), leaf('c', 'shell')]);

    expect(rotulos()).toEqual(['Claude Code', 'Codex', 'PowerShell']);
    expect(numeros()).toEqual(['1', '2', '3']);
  });

  it('a ordem segue a faixa, não o programa: o primeiro da faixa é o 1', () => {
    setup([leaf('a', 'shell'), leaf('b', 'claude'), leaf('c', 'codex'), leaf('d', 'claude')]);

    expect(rotulos()).toEqual(['PowerShell', 'Claude Code 1', 'Codex', 'Claude Code 2']);
  });

  it('agrupa pelo rótulo mostrado: o programa do terminal ligado conta, como no nome da aba', () => {
    setup([leaf('a', 'claude'), leaf('b', 'shell', 't2')], [terminal('t2', 'claude')]);

    expect(rotulos()).toEqual(['Claude Code 1', 'Claude Code 2']);
  });

  it('os números de ordem aparecem em três ou mais painéis do mesmo programa', () => {
    setup([leaf('a', 'codex'), leaf('b', 'codex'), leaf('c', 'codex')]);

    expect(rotulos()).toEqual(['Codex 1', 'Codex 2', 'Codex 3']);
  });

  it('clicar numa aba com número de ordem seleciona o painel dela', async () => {
    const { onSelect } = setup([leaf('a', 'claude'), leaf('b', 'shell'), leaf('c', 'claude')]);

    await userEvent.click(screen.getByRole('tab', { name: /Claude Code 2/ }));

    expect(onSelect).toHaveBeenCalledWith('c');
  });

  it('os rótulos numerados ficam dentro do tablist', () => {
    setup([leaf('a', 'claude'), leaf('b', 'claude')]);

    const tabs = within(screen.getByRole('tablist', { name: 'Painéis abertos' })).getAllByRole(
      'tab',
    );
    expect(tabs).toHaveLength(2);
    expect(tabs[0]).toHaveTextContent('Claude Code 1');
    expect(tabs[1]).toHaveTextContent('Claude Code 2');
  });
});

describe('PaneTabs: marca da sessão', () => {
  it('a sessão viva e parada mostra Ocioso (◦); a que está produzindo segue Ativo (●)', () => {
    render(
      <PaneTabs
        leaves={[leaf('a', 'claude', 't1'), leaf('b', 'shell', 't2')]}
        activeId="a"
        terminals={[terminal('t1', 'claude'), terminal('t2', 'shell')]}
        idleIds={new Set(['t1'])}
        providers={providers}
        onSelect={vi.fn()}
      />,
    );
    const [first, second] = screen.getAllByRole('tab');
    expect(first?.querySelector('.state-mark')).toHaveClass('state-mark--idle');
    expect(first).toHaveTextContent('◦');
    expect(second?.querySelector('.state-mark')).toHaveClass('state-mark--active');
  });
});

describe('PaneTabs: abas que rolam (esmaecimento e "⌄")', () => {
  const quatro = [leaf('a', 'claude'), leaf('b', 'codex'), leaf('c', 'shell'), leaf('d', 'claude')];
  const trigger = () => screen.queryByRole('button', { name: /Abas fora de vista/ });

  it('cada aba leva o id do painel em data-tab-id', () => {
    setup(quatro);

    const ids = screen.getAllByRole('tab').map((tab) => tab.getAttribute('data-tab-id'));
    expect(ids).toEqual(['a', 'b', 'c', 'd']);
  });

  it('a lista continua sendo o tablist e esmaece o fim quando a última aba sai de vista', () => {
    setup(quatro);
    show('a', 'b', 'c');

    const list = screen.getByRole('tablist', { name: 'Painéis abertos' });
    expect(list).toHaveAttribute('data-fade-end', 'true');
    expect(list).not.toHaveAttribute('data-fade-start');
  });

  it('com todas as abas à vista, não há esmaecimento nem "⌄"', () => {
    setup(quatro);
    show('a', 'b', 'c', 'd');

    const list = screen.getByRole('tablist', { name: 'Painéis abertos' });
    expect(list).not.toHaveAttribute('data-fade-end');
    expect(list).not.toHaveAttribute('data-fade-start');
    expect(trigger()).toBeNull();
  });

  it('o "⌄" lista só as abas escondidas, com o rótulo numerado, e escolher uma chama onSelect', async () => {
    const { onSelect } = setup(quatro);
    show('a', 'b');

    await userEvent.click(screen.getByRole('button', { name: 'Abas fora de vista' }));
    expect(screen.getAllByRole('menuitem').map((item) => item.textContent)).toEqual([
      'PowerShell',
      'Claude Code 2',
    ]);
    await userEvent.click(screen.getByRole('menuitem', { name: 'Claude Code 2' }));

    expect(onSelect).toHaveBeenCalledWith('d');
  });

  it('com uma aba escondida aguardando você, o "⌄" pede atenção; sem espera, não', () => {
    const ligados = [
      leaf('a', 'claude', 't1'),
      leaf('b', 'codex', 't2'),
      leaf('c', 'shell', 't3'),
      leaf('d', 'claude', 't4'),
    ];
    const sessoes = [
      terminal('t1', 'claude'),
      terminal('t2', 'codex'),
      terminal('t3', 'shell'),
      { ...terminal('t4', 'claude'), state: 'waiting' as const },
    ];
    const { unmount } = setup(ligados, sessoes);
    show('a', 'b');
    expect(
      screen.getByRole('button', { name: 'Abas fora de vista, uma aguarda você' }),
    ).toBeInTheDocument();
    unmount();

    // A que aguarda está à vista: o "⌄" lista só abas calmas e não pede atenção.
    setup(ligados, sessoes);
    show('a', 'd');
    expect(screen.getByRole('button', { name: 'Abas fora de vista' })).toBeInTheDocument();
  });
});

describe('PaneTabs: janela estreita (modo ligado pela largura)', () => {
  const dois = [leaf('a', 'claude'), leaf('b', 'shell')];

  it('sem auto, a faixa não tem botão "Grade" (é do seletor de layout, no cabeçalho) nem o aviso', () => {
    setup(dois);

    expect(screen.queryByRole('button', { name: 'Grade' })).toBeNull();
    expect(screen.queryByText('Janela pequena')).toBeNull();
  });

  it('com auto, não há botão "Grade": há o aviso "Janela pequena" com a dica, que não é botão', () => {
    setup(dois, [], true);

    expect(screen.queryByRole('button', { name: 'Grade' })).toBeNull();
    const note = screen.getByText('Janela pequena');
    expect(note.closest('[title]')).toHaveAttribute(
      'title',
      'Volta para a grade quando o layout couber na janela',
    );
    expect(note.closest('button')).toBeNull();
  });
});

describe('PaneTabs: nome pelo modelo', () => {
  const comModelo = (id: string, model: string): TerminalSummary => ({
    ...terminal(id, 'claude'),
    kind: 'shell',
    model,
  });

  it('o Claude com modelo conhecido leva a família do modelo no nome; sem modelo, o nome do programa', () => {
    setup(
      [leaf('a', 'claude', 't1'), leaf('b', 'claude', 't2'), leaf('c', 'codex', 't3')],
      [comModelo('t1', 'claude-haiku-5-5'), terminal('t2', 'claude'), terminal('t3', 'codex')],
    );

    expect(rotulos()).toEqual(['Haiku', 'Claude Code', 'Codex']);
  });

  it('dois terminais no mesmo modelo ganham número de ordem; modelos diferentes, não', () => {
    setup(
      [leaf('a', 'claude', 't1'), leaf('b', 'claude', 't2'), leaf('c', 'claude', 't3')],
      [
        comModelo('t1', 'claude-haiku-5-5'),
        comModelo('t2', 'claude-fable-5-2'),
        comModelo('t3', 'claude-haiku-5-5'),
      ],
    );

    expect(rotulos()).toEqual(['Haiku 1', 'Fable', 'Haiku 2']);
  });

  it('modelo que a tabela não reconhece cai no nome do programa', () => {
    setup([leaf('a', 'claude', 't1')], [comModelo('t1', 'modelo-desconhecido')]);

    expect(rotulos()).toEqual(['Claude Code']);
  });

  it('a dica da aba diz o programa, o título da sessão e o contexto', () => {
    setup(
      [leaf('a', 'claude', 't1')],
      [
        {
          ...comModelo('t1', 'claude-haiku-5-5'),
          title: 'Corrigir login',
          context: { usedTokens: 76_000, windowTokens: 200_000 },
        },
      ],
    );

    expect(screen.getByRole('tab')).toHaveAttribute(
      'title',
      'Claude Code · Corrigir login · Contexto: 76.000 de 200.000 tokens (38%)',
    );
  });
});

describe('PaneTabs: estado por extenso', () => {
  it('quem aguarda mostra "Aguardando" em texto e marca a aba; ativo mostra "Ativo"; ocioso, só o ponto', () => {
    render(
      <PaneTabs
        leaves={[leaf('a', 'claude', 't1'), leaf('b', 'claude', 't2'), leaf('c', 'claude', 't3')]}
        activeId="a"
        terminals={[
          { ...terminal('t1', 'claude'), state: 'waiting' },
          terminal('t2', 'claude'),
          terminal('t3', 'claude'),
        ]}
        idleIds={new Set(['t3'])}
        providers={providers}
        onSelect={vi.fn()}
      />,
    );
    const [waiting, active, idle] = screen.getAllByRole('tab');

    expect(waiting).toHaveAttribute('data-waiting', 'true');
    expect(within(waiting!).getByText('Aguardando')).toHaveClass('state-mark__label');
    expect(active).not.toHaveAttribute('data-waiting');
    expect(within(active!).getByText('Ativo')).toHaveClass('state-mark__label');
    expect(within(idle!).getByText('Ocioso')).toHaveClass('state-mark__sr');
  });
});

describe('PaneTabs: contexto', () => {
  it('a aba não desenha barra de contexto: o número fica só na dica', () => {
    setup(
      [leaf('a', 'claude', 't1')],
      [{ ...terminal('t1', 'claude'), context: { usedTokens: 170_000, windowTokens: 200_000 } }],
    );
    const tab = screen.getByRole('tab');

    expect(tab.querySelector('.pane-tabs__context')).toBeNull();
    expect(tab.getAttribute('title')).toContain('Contexto: 170.000 de 200.000 tokens (85%)');
  });
});

describe('PaneTabs: X de fechar na aba', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });
  afterEach(() => {
    window.localStorage.clear();
  });

  const avulso = (id: string, provider: 'claude' | 'shell'): TerminalSummary => ({
    ...terminal(id, provider),
    kind: 'shell',
  });

  function comFechar(terminals: readonly TerminalSummary[], busy = false) {
    const onClose = vi.fn();
    const onSelect = vi.fn();
    render(
      <PaneTabs
        leaves={[leaf('a', 'shell', 't1'), leaf('b', 'claude', 't2')]}
        activeId="a"
        terminals={terminals}
        providers={providers}
        onSelect={onSelect}
        onClose={onClose}
        busy={busy}
      />,
    );
    return { onClose, onSelect };
  }
  const todos = [avulso('t1', 'shell'), avulso('t2', 'claude')];

  it('sem onClose a faixa não tem X', () => {
    setup([leaf('a', 'shell', 't1')], [avulso('t1', 'shell')]);
    expect(screen.queryByRole('button', { name: /^Fechar/ })).not.toBeInTheDocument();
  });

  it('cada aba tem um X com o nome dela, fora do botão da aba e fora da ordem do Tab', () => {
    comFechar(todos);
    const x = screen.getByRole('button', { name: 'Fechar PowerShell' });
    expect(x.closest('[role="tab"]')).toBeNull();
    expect(x).toHaveAttribute('tabindex', '-1');
    expect(screen.getByRole('button', { name: 'Fechar Claude Code' })).toBeInTheDocument();
    // O nome da aba continua sendo só o rótulo.
    expect(screen.getByRole('tab', { name: /^PowerShell/ })).toBeInTheDocument();
  });

  it('shell comum: o X fecha direto e não troca de aba', async () => {
    const { onClose, onSelect } = comFechar(todos);
    await userEvent.click(screen.getByRole('button', { name: 'Fechar PowerShell' }));
    expect(onClose).toHaveBeenCalledExactlyOnceWith('a');
    expect(onSelect).not.toHaveBeenCalled();
  });

  it('agente avulso vivo: o X pergunta antes, e só confirmar fecha', async () => {
    const { onClose } = comFechar(todos);
    await userEvent.click(screen.getByRole('button', { name: 'Fechar Claude Code' }));
    expect(onClose).not.toHaveBeenCalled();
    expect(
      screen.getByRole('group', {
        name: 'Encerrar o Claude Code e fechar o painel? O processo para.',
      }),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Voltar' })).toHaveFocus();

    await userEvent.click(screen.getByRole('button', { name: 'Fechar e encerrar' }));
    expect(onClose).toHaveBeenCalledExactlyOnceWith('b');
    expect(screen.queryByRole('group')).not.toBeInTheDocument();
  });

  it('"Voltar" some a pergunta, não fecha e devolve o foco à aba', async () => {
    const { onClose } = comFechar(todos);
    await userEvent.click(screen.getByRole('button', { name: 'Fechar Claude Code' }));
    await userEvent.click(screen.getByRole('button', { name: 'Voltar' }));
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.queryByRole('group')).not.toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /^Claude Code/ })).toHaveFocus();
  });

  it('com a pergunta desligada, o X do agente fecha direto', async () => {
    setAskBeforeClosing(false);
    const { onClose } = comFechar(todos);
    await userEvent.click(screen.getByRole('button', { name: 'Fechar Claude Code' }));
    expect(onClose).toHaveBeenCalledExactlyOnceWith('b');
  });

  it('a pergunta some se a sessão terminar enquanto está aberta', async () => {
    const onClose = vi.fn();
    const props = {
      leaves: [leaf('b', 'claude', 't2')],
      activeId: 'b',
      providers,
      onSelect: vi.fn(),
      onClose,
    };
    const view = render(<PaneTabs {...props} terminals={[avulso('t2', 'claude')]} />);
    await userEvent.click(screen.getByRole('button', { name: 'Fechar Claude Code' }));
    expect(screen.getByRole('group')).toBeInTheDocument();

    view.rerender(
      <PaneTabs {...props} terminals={[{ ...avulso('t2', 'claude'), state: 'exited' }]} />,
    );
    expect(screen.queryByRole('group')).not.toBeInTheDocument();
  });

  it('ocupado, os X ficam desligados', () => {
    comFechar(todos, true);
    expect(screen.getByRole('button', { name: 'Fechar PowerShell' })).toBeDisabled();
  });
});
