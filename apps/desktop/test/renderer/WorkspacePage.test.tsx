import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, useLocation, useNavigate } from 'react-router';
import type {
  LayoutNode,
  ProviderInfo,
  TerminalSummary,
  WorkspaceDto,
} from '@project-hub/contracts';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { arrangeLeaves } from '@project-hub/contracts/layout-arrange';
import { Toaster } from '../../src/renderer/components/Toaster';
import { notify } from '../../src/renderer/notify';
import { WorkspacePage } from '../../src/renderer/pages/WorkspacePage';
import { ROUTE_PATHS } from '../../src/renderer/routes';

// O xterm precisa de um navegador de verdade. Aqui o terminal é trocado por um marcador.
vi.mock('../../src/renderer/components/terminals/TerminalView', () => ({
  TerminalView: ({ terminalId }: { terminalId: string }) => (
    <div data-testid="terminal-view">{terminalId}</div>
  ),
}));

const leaf = (
  id: string,
  provider: 'claude' | 'codex' | 'shell',
  terminalId: string | null = null,
) => ({ type: 'leaf', id, provider, terminalId }) as const;

function padrao(shellTerminal: string | null = null): LayoutNode {
  return {
    type: 'split',
    id: 'raiz',
    direction: 'row',
    ratio: 0.5,
    first: leaf('a', 'claude'),
    second: {
      type: 'split',
      id: 'meio',
      direction: 'column',
      ratio: 0.5,
      first: leaf('b', 'codex'),
      second: leaf('c', 'shell', shellTerminal),
    },
  };
}

const dto = (layout: LayoutNode): WorkspaceDto => ({
  id: 'w1',
  projectId: 'p1',
  layout,
  position: 0,
  lastActiveAt: '2026-10-22T10:00:00.000Z',
});

const providers: ProviderInfo[] = [
  { id: 'claude', label: 'Claude Code', available: true },
  { id: 'codex', label: 'Codex', available: false, reason: 'Codex não está instalado.' },
  { id: 'shell', label: 'PowerShell', available: true },
];

const shellTerminal: TerminalSummary = {
  id: 't1',
  kind: 'shell',
  title: 'PowerShell',
  projectId: 'p1',
  projectName: 'app',
  state: 'running',
  provider: 'shell',
  origin: 'new',
};

const api = {
  workspaces: {
    list: vi.fn(),
    open: vi.fn(),
    saveLayout: vi.fn(),
    startSession: vi.fn(),
    endSession: vi.fn(),
    addPane: vi.fn(),
    removePane: vi.fn(),
  },
  providers: { list: vi.fn() },
  terminals: { list: vi.fn() },
  projects: { list: vi.fn() },
  missions: { list: vi.fn() },
};

let current: { pathname: string; state: unknown } = { pathname: '', state: null };
function Probe() {
  const location = useLocation();
  current = { pathname: location.pathname, state: location.state };
  return null;
}

function tree() {
  return (
    <>
      <Probe />
      <Routes>
        <Route path={ROUTE_PATHS.workspace} element={<WorkspacePage />} />
        <Route path="/" element={<p>página inicial</p>} />
      </Routes>
    </>
  );
}

function renderAt(state?: unknown, projectId = 'p1') {
  return render(
    <>
      <MemoryRouter initialEntries={[{ pathname: `/workspaces/${projectId}`, state }]}>
        {tree()}
      </MemoryRouter>
      <Toaster />
    </>,
  );
}

beforeEach(() => {
  vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockReturnValue(1000);
  vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockReturnValue(800);
  vi.stubGlobal(
    'ResizeObserver',
    class {
      constructor(private readonly callback: ResizeObserverCallback) {}
      observe(target: Element) {
        const box = [{ inlineSize: 1000, blockSize: 800 }];
        this.callback(
          [{ target, borderBoxSize: box, contentBoxSize: box } as unknown as ResizeObserverEntry],
          this as unknown as ResizeObserver,
        );
      }
      unobserve() {}
      disconnect() {}
    },
  );
  api.workspaces.list.mockResolvedValue({ ok: true, data: [] });
  api.workspaces.open.mockResolvedValue({ ok: true, data: dto(padrao()) });
  api.workspaces.saveLayout.mockReset().mockResolvedValue({ ok: true, data: undefined });
  api.workspaces.startSession.mockReset();
  api.workspaces.endSession.mockReset();
  api.workspaces.addPane.mockReset();
  api.workspaces.removePane.mockReset();
  api.providers.list.mockResolvedValue({ ok: true, data: providers });
  api.terminals.list.mockResolvedValue({ ok: true, data: [] });
  api.projects.list.mockResolvedValue({
    ok: true,
    data: [{ id: 'p1', name: 'app', path: 'x', repositoryKind: 'git', available: true }],
  });
  api.missions.list.mockResolvedValue({ ok: true, data: [] });
  window.projectHub = api as unknown as typeof window.projectHub;
});

afterEach(() => {
  notify.clear();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

/** Abre o menu "Abrir terminal" e escolhe o programa pelo nome. */
async function abrirPrograma(nome: RegExp) {
  await userEvent.click(await screen.findByRole('button', { name: 'Abrir terminal' }));
  await userEvent.click(screen.getByRole('menuitem', { name: nome }));
}

describe('WorkspacePage', () => {
  it('o layout padrão mostra um lançador por provedor', async () => {
    renderAt();
    expect(await screen.findByRole('button', { name: 'Iniciar Claude Code' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Iniciar Codex' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Iniciar PowerShell' })).toBeEnabled();
    expect(screen.getByText('Codex não está instalado.')).toBeInTheDocument();
  });

  it('iniciar o PowerShell chama startSession do painel e passa a mostrar o terminal', async () => {
    api.workspaces.startSession.mockResolvedValue({ ok: true, data: dto(padrao('t1')) });
    api.terminals.list.mockResolvedValue({ ok: true, data: [shellTerminal] });
    renderAt();
    await userEvent.click(await screen.findByRole('button', { name: 'Iniciar PowerShell' }));
    expect(api.workspaces.startSession).toHaveBeenCalledWith('w1', 'c');
    expect(await screen.findByTestId('terminal-view')).toHaveTextContent('t1');
  });

  it('Fechar painel numa sessão encerrada chama removePane da folha', async () => {
    api.workspaces.open.mockResolvedValue({ ok: true, data: dto(padrao('t1')) });
    api.terminals.list.mockResolvedValue({
      ok: true,
      data: [{ ...shellTerminal, state: 'exited' }],
    });
    api.workspaces.removePane.mockResolvedValue({ ok: true, data: dto(leaf('a', 'claude')) });
    renderAt();
    const pane = await screen.findByRole('region', { name: 'Painel PowerShell' });
    await userEvent.click(within(pane).getByRole('button', { name: 'Fechar painel' }));
    expect(api.workspaces.removePane).toHaveBeenCalledWith('w1', 'c');
  });

  it('fechar uma sessão rodando chama removePane direto, sem pedir confirmação', async () => {
    api.workspaces.open.mockResolvedValue({ ok: true, data: dto(padrao('t1')) });
    api.terminals.list.mockResolvedValue({ ok: true, data: [shellTerminal] });
    api.workspaces.removePane.mockResolvedValue({ ok: true, data: dto(leaf('a', 'claude')) });
    renderAt();
    const pane = await screen.findByRole('region', { name: 'Painel PowerShell' });
    await userEvent.click(within(pane).getByRole('button', { name: 'Fechar painel' }));
    expect(api.workspaces.removePane).toHaveBeenCalledWith('w1', 'c');
  });

  it('o painel some na hora, sem esperar o processo principal responder', async () => {
    api.workspaces.open.mockResolvedValue({
      ok: true,
      data: { ...dto(padrao()), layout: leaf('c', 'shell', 't1') },
    });
    api.terminals.list.mockResolvedValue({ ok: true, data: [shellTerminal] });
    let finish: (value: unknown) => void = () => {};
    api.workspaces.removePane.mockReturnValue(new Promise((resolve) => (finish = resolve)));
    renderAt();
    const pane = await screen.findByRole('region', { name: 'Painel PowerShell' });
    await userEvent.click(within(pane).getByRole('button', { name: 'Fechar painel' }));
    expect(screen.queryByRole('region', { name: 'Painel PowerShell' })).not.toBeInTheDocument();
    expect(screen.getByText('Nenhum terminal aberto')).toBeInTheDocument();
    await act(async () => finish({ ok: true, data: { ...dto(padrao()), layout: null } }));
    expect(screen.getByText('Nenhum terminal aberto')).toBeInTheDocument();
  });

  it('se o processo principal recusar, o painel volta com o erro', async () => {
    api.workspaces.open.mockResolvedValue({ ok: true, data: dto(padrao('t1')) });
    api.terminals.list.mockResolvedValue({ ok: true, data: [shellTerminal] });
    api.workspaces.removePane.mockResolvedValue({
      ok: false,
      error: { code: 'x', message: 'Não foi possível fechar o painel' },
    });
    renderAt();
    const pane = await screen.findByRole('region', { name: 'Painel PowerShell' });
    await userEvent.click(within(pane).getByRole('button', { name: 'Fechar painel' }));
    const back = await screen.findByRole('region', { name: 'Painel PowerShell' });
    expect(await within(back).findByRole('alert')).toHaveTextContent(
      'Não foi possível fechar o painel',
    );
  });

  describe('sem painéis', () => {
    beforeEach(() => {
      api.workspaces.open.mockResolvedValue({ ok: true, data: { ...dto(padrao()), layout: null } });
    });

    it('mostra o estado vazio e a barra de escolha', async () => {
      renderAt();
      expect(await screen.findByText('Nenhum terminal aberto')).toBeInTheDocument();
      expect(
        screen.getByText('Escolha um programa na barra acima para abrir um terminal.'),
      ).toBeInTheDocument();
      await userEvent.click(screen.getByRole('button', { name: 'Abrir terminal' }));
      expect(screen.getByRole('menuitem', { name: /Claude Code/ })).not.toHaveAttribute(
        'aria-disabled',
        'true',
      );
      expect(screen.getByRole('menuitem', { name: /Codex/ })).toHaveAttribute(
        'aria-disabled',
        'true',
      );
    });

    it('clicar em Claude Code chama addPane e mostra o painel novo', async () => {
      api.workspaces.addPane.mockResolvedValue({ ok: true, data: dto(leaf('n', 'claude')) });
      renderAt();
      await abrirPrograma(/Claude Code/);
      expect(api.workspaces.addPane).toHaveBeenCalledWith('w1', 'claude');
      expect(await screen.findByRole('button', { name: 'Iniciar Claude Code' })).toBeEnabled();
      expect(screen.queryByText('Nenhum terminal aberto')).not.toBeInTheDocument();
      // A barra continua acima dos painéis.
      expect(screen.getByRole('button', { name: 'Abrir terminal' })).toBeInTheDocument();
    });

    it('falha ao abrir vira aviso com a mensagem do IPC', async () => {
      api.workspaces.addPane.mockResolvedValue({
        ok: false,
        error: { code: 'x', message: 'Limite de painéis' },
      });
      renderAt();
      await abrirPrograma(/Claude Code/);
      const alert = await screen.findByRole('alert');
      expect(alert).toHaveTextContent('Limite de painéis');
      expect(alert.closest('[aria-label="Avisos"]')).not.toBeNull();
    });

    it('dois cliques seguidos enquanto ocupado chamam addPane uma vez', async () => {
      let finish: (value: unknown) => void = () => {};
      api.workspaces.addPane.mockReturnValue(new Promise((resolve) => (finish = resolve)));
      renderAt();
      await abrirPrograma(/Claude Code/);
      const trigger = screen.getByRole('button', { name: 'Abrir terminal' });
      expect(trigger).toBeDisabled();
      await userEvent.click(trigger);
      expect(api.workspaces.addPane).toHaveBeenCalledTimes(1);
      await act(async () => finish({ ok: true, data: dto(leaf('n', 'claude')) }));
      await waitFor(() =>
        expect(screen.getByRole('button', { name: 'Abrir terminal' })).toBeEnabled(),
      );
    });
  });

  it('com painéis, a barra aparece acima da área', async () => {
    renderAt();
    expect(await screen.findByRole('button', { name: 'Abrir terminal' })).toBeInTheDocument();
  });

  it('falha de startSession aparece em alert no painel certo', async () => {
    api.workspaces.startSession.mockResolvedValue({
      ok: false,
      error: { code: 'x', message: 'Não abriu' },
    });
    renderAt();
    await userEvent.click(await screen.findByRole('button', { name: 'Iniciar PowerShell' }));
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Não abriu');
    const pane = screen.getByRole('region', { name: 'Painel PowerShell' });
    expect(within(pane).getByRole('alert')).toBe(alert);
  });

  it('layout recusado na gravação sai pelo aviso (alert), não solto na página', async () => {
    api.workspaces.saveLayout.mockResolvedValue({
      ok: false,
      error: { code: 'VALIDATION_FAILED', message: 'inválido' },
    });
    renderAt();
    const separator = (await screen.findAllByRole('separator'))[0];
    if (separator === undefined) throw new Error('sem separador');
    separator.focus();
    await userEvent.keyboard('{ArrowRight}');
    const alert = await screen.findByRole('alert', {}, { timeout: 3000 });
    expect(alert).toHaveTextContent('O layout não pôde ser gravado e não será tentado de novo.');
    expect(alert.closest('[aria-label="Avisos"]')).not.toBeNull();
  });

  it('location.state.showTerminal põe o terminal no painel ativo uma vez e limpa o estado', async () => {
    // Sessão de missão: é a única que ainda tem "Tirar do painel".
    api.terminals.list.mockResolvedValue({
      ok: true,
      data: [{ ...shellTerminal, missionId: 'm1' }],
    });
    const view = renderAt({ showTerminal: 't1' });
    expect(await screen.findByTestId('terminal-view')).toHaveTextContent('t1');
    // A sessão entra no painel ativo (o primeiro); o rótulo vem do provedor da sessão.
    const [active, other] = screen.getAllByRole('region', { name: 'Painel PowerShell' });
    expect(within(active!).getByTestId('terminal-view')).toBeInTheDocument();
    expect(within(other!).queryByTestId('terminal-view')).not.toBeInTheDocument();
    // O estado da rota é limpo por um efeito depois da inserção: espera, sem depender da ordem.
    await waitFor(() => expect(current.state).toBeNull());
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 500));
    });
    // Depois de consumido, tirar o terminal do painel não o devolve em um novo render da mesma rota.
    await userEvent.click(screen.getByRole('button', { name: 'Tirar do painel' }));
    view.rerender(<MemoryRouter initialEntries={['/ignorado']}>{tree()}</MemoryRouter>);
    await act(async () => {});
    expect(screen.queryByTestId('terminal-view')).not.toBeInTheDocument();
  });

  it('ao navegar de um projeto para outro com showTerminal, o terminal vai para o painel ativo do novo', async () => {
    const outro = { ...dto(padrao()), id: 'w2', projectId: 'p2' };
    api.workspaces.open.mockImplementation(async (id: string) => ({
      ok: true,
      data: id === 'p2' ? outro : dto(padrao()),
    }));
    api.projects.list.mockResolvedValue({
      ok: true,
      data: [
        { id: 'p1', name: 'app', path: 'x', repositoryKind: 'git', available: true },
        { id: 'p2', name: 'api', path: 'y', repositoryKind: 'git', available: true },
      ],
    });
    api.terminals.list.mockResolvedValue({
      ok: true,
      data: [{ ...shellTerminal, id: 't2', projectId: 'p2' }],
    });
    function Go() {
      const navigate = useNavigate();
      return (
        <button
          type="button"
          onClick={() => navigate('/workspaces/p2', { state: { showTerminal: 't2' } })}
        >
          ir
        </button>
      );
    }
    render(
      <MemoryRouter initialEntries={['/workspaces/p1']}>
        <Go />
        {tree()}
      </MemoryRouter>,
    );
    await screen.findByRole('button', { name: 'Iniciar Claude Code' });
    await userEvent.click(screen.getByRole('button', { name: 'ir' }));
    expect(await screen.findByTestId('terminal-view')).toHaveTextContent('t2');
    expect(api.workspaces.open).toHaveBeenLastCalledWith('p2');
  });

  it('enquanto a sessão abre, o painel espera em vez de dizer que ela terminou', async () => {
    api.workspaces.startSession.mockResolvedValue({ ok: true, data: dto(padrao('t1')) });
    renderAt();
    const start = await screen.findByRole('button', { name: 'Iniciar PowerShell' });
    // A leitura que vem depois de iniciar demora: a sessão nova ainda não está na lista.
    api.terminals.list.mockImplementation(() => new Promise(() => {}));
    await userEvent.click(start);
    expect(await screen.findByText('Abrindo a sessão…')).toBeInTheDocument();
    expect(screen.queryByText('A sessão terminou.')).not.toBeInTheDocument();
  });

  it('projeto inexistente mostra a mensagem com link para o Início', async () => {
    renderAt(undefined, 'outro');
    expect(await screen.findByText('O projeto não foi encontrado.')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /início/i })).toHaveAttribute('href', '/');
  });

  describe('abrir e fechar painéis (revisão final)', () => {
    const vazio = () => ({ ...dto(padrao()), layout: null });

    it('painel novo não pisca "A sessão terminou." enquanto a lista de terminais recarrega', async () => {
      api.workspaces.open.mockResolvedValue({ ok: true, data: vazio() });
      let releaseReload: (value: unknown) => void = () => {};
      api.terminals.list
        .mockResolvedValueOnce({ ok: true, data: [] })
        .mockReturnValueOnce(new Promise((resolve) => (releaseReload = resolve)));
      api.workspaces.addPane.mockResolvedValue({
        ok: true,
        data: dto(leaf('n', 'shell', 't1')),
      });
      renderAt();
      await abrirPrograma(/PowerShell/);
      expect(await screen.findByText('Abrindo a sessão…')).toBeInTheDocument();
      expect(screen.queryByText('A sessão terminou.')).not.toBeInTheDocument();
      await act(async () => releaseReload({ ok: true, data: [shellTerminal] }));
      expect(await screen.findByTestId('terminal-view')).toHaveTextContent('t1');
      expect(screen.queryByText('A sessão terminou.')).not.toBeInTheDocument();
    });

    it('com 12 painéis, os botões da barra ficam desabilitados com a dica do limite', async () => {
      let n = 0;
      const cheio = arrangeLeaves(
        Array.from({ length: 12 }, (_, i) => leaf('f' + i, 'shell')),
        () => 's' + n++,
      );
      api.workspaces.open.mockResolvedValue({
        ok: true,
        data: { ...dto(padrao()), layout: cheio },
      });
      renderAt();
      const trigger = await screen.findByRole('button', { name: 'Abrir terminal' });
      expect(trigger).toBeDisabled();
      const wrap = trigger.parentElement;
      expect(wrap).toHaveClass('workspace__open-wrap');
      act(() => wrap!.focus());
      expect((await screen.findAllByText('Limite de 12 painéis')).length).toBeGreaterThan(0);
    });

    it('falha ao carregar os programas vira aviso e a dica não manda usar a barra vazia', async () => {
      api.workspaces.open.mockResolvedValue({ ok: true, data: vazio() });
      api.providers.list.mockResolvedValue({
        ok: false,
        error: { code: 'x', message: 'falhou' },
      });
      renderAt();
      expect(
        await screen.findByText('Nenhum programa disponível para abrir um terminal.'),
      ).toBeInTheDocument();
      expect(
        screen.getByText('Não foi possível carregar os programas disponíveis.'),
      ).toBeInTheDocument();
      expect(
        screen.queryByText('Escolha um programa na barra acima para abrir um terminal.'),
      ).not.toBeInTheDocument();
    });

    it('fechar o último painel leva o foco ao botão Abrir terminal', async () => {
      api.workspaces.open.mockResolvedValue({
        ok: true,
        data: { ...dto(padrao()), layout: leaf('a', 'claude') },
      });
      api.workspaces.removePane.mockResolvedValue({ ok: true, data: vazio() });
      renderAt();
      const pane = await screen.findByRole('region', { name: 'Painel Claude Code' });
      await userEvent.click(within(pane).getByRole('button', { name: 'Fechar painel' }));
      await waitFor(() =>
        expect(screen.getByRole('button', { name: 'Abrir terminal' })).toHaveFocus(),
      );
    });

    it('sessão pedida pela barra lateral com workspace vazio abre um painel com ela', async () => {
      api.workspaces.open.mockResolvedValue({ ok: true, data: vazio() });
      api.terminals.list.mockResolvedValue({ ok: true, data: [shellTerminal] });
      renderAt({ showTerminal: 't1' });
      expect(await screen.findByTestId('terminal-view')).toHaveTextContent('t1');
      expect(screen.queryByText('Nenhum terminal aberto')).not.toBeInTheDocument();
    });
  });
});

describe('modo "um painel por vez"', () => {
  const pane = (name: string) => screen.queryByRole('region', { name: `Painel ${name}` });

  it('"Abas" mostra só o painel ativo com uma aba por painel, e "Grade" mostra todos de novo', async () => {
    renderAt();
    await screen.findByRole('button', { name: 'Iniciar Claude Code' });

    await userEvent.click(screen.getByRole('button', { name: 'Abas' }));

    const tabs = screen.getByRole('tablist', { name: 'Painéis abertos' });
    expect(within(tabs).getAllByRole('tab')).toHaveLength(3);
    expect(within(tabs).getByRole('tab', { name: /Claude Code/ })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    expect(pane('Claude Code')).toBeInTheDocument();
    expect(pane('Codex')).not.toBeInTheDocument();
    expect(pane('PowerShell')).not.toBeInTheDocument();
    expect(api.workspaces.saveLayout).not.toHaveBeenCalled();

    await userEvent.click(screen.getByRole('button', { name: 'Grade' }));

    expect(screen.queryByRole('tablist')).not.toBeInTheDocument();
    expect(pane('Claude Code')).toBeInTheDocument();
    expect(pane('Codex')).toBeInTheDocument();
    expect(pane('PowerShell')).toBeInTheDocument();
  });

  it('Maximizar painel mostra só aquele painel, e o mesmo botão volta à grade', async () => {
    renderAt();
    await screen.findByRole('button', { name: 'Iniciar PowerShell' });

    await userEvent.click(
      within(pane('PowerShell') as HTMLElement).getByRole('button', { name: 'Maximizar painel' }),
    );

    expect(pane('PowerShell')).toBeInTheDocument();
    expect(pane('Claude Code')).not.toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /PowerShell/ })).toHaveAttribute(
      'aria-selected',
      'true',
    );

    await userEvent.click(
      within(pane('PowerShell') as HTMLElement).getByRole('button', { name: 'Voltar à grade' }),
    );

    expect(screen.queryByRole('tablist')).not.toBeInTheDocument();
    expect(pane('Claude Code')).toBeInTheDocument();
  });

  it('duplo clique no cabeçalho do painel maximiza', async () => {
    renderAt();
    await screen.findByRole('button', { name: 'Iniciar PowerShell' });
    const head = (pane('PowerShell') as HTMLElement).querySelector('.pane__head') as HTMLElement;

    await userEvent.dblClick(head);

    expect(screen.getByRole('tablist')).toBeInTheDocument();
    expect(pane('Claude Code')).not.toBeInTheDocument();
  });

  it('clicar numa aba mostra aquele painel', async () => {
    renderAt();
    await screen.findByRole('button', { name: 'Iniciar Claude Code' });
    await userEvent.click(screen.getByRole('button', { name: 'Abas' }));

    await userEvent.click(screen.getByRole('tab', { name: /Codex/ }));

    expect(pane('Codex')).toBeInTheDocument();
    expect(pane('Claude Code')).not.toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /Codex/ })).toHaveAttribute('aria-selected', 'true');
  });

  it('Ctrl+Alt com as setas troca de aba, com volta nas pontas', async () => {
    renderAt();
    await screen.findByRole('button', { name: 'Iniciar Claude Code' });
    await userEvent.click(screen.getByRole('button', { name: 'Abas' }));
    screen.getByRole('tab', { name: /Claude Code/ }).focus();

    await userEvent.keyboard('{Control>}{Alt>}{ArrowRight}{/Alt}{/Control}');
    expect(pane('Codex')).toBeInTheDocument();

    await userEvent.keyboard('{Control>}{Alt>}{ArrowLeft}{ArrowLeft}{/Alt}{/Control}');
    expect(pane('PowerShell')).toBeInTheDocument();
  });

  it('fechar o painel mostrado passa para o vizinho', async () => {
    api.workspaces.open.mockResolvedValue({ ok: true, data: dto(padrao('t1')) });
    api.terminals.list.mockResolvedValue({ ok: true, data: [shellTerminal] });
    api.workspaces.removePane.mockResolvedValue({
      ok: true,
      data: dto(
        arrangeLeaves([leaf('a', 'claude'), leaf('b', 'codex')], () => crypto.randomUUID()) ??
          leaf('a', 'claude'),
      ),
    });
    renderAt();
    await screen.findByRole('region', { name: 'Painel PowerShell' });
    await userEvent.click(screen.getByRole('button', { name: 'Abas' }));
    await userEvent.click(screen.getByRole('tab', { name: /PowerShell/ }));

    await userEvent.click(
      within(pane('PowerShell') as HTMLElement).getByRole('button', { name: 'Fechar painel' }),
    );

    await waitFor(() => expect(pane('Codex')).toBeInTheDocument());
    expect(pane('PowerShell')).not.toBeInTheDocument();
    expect(screen.getAllByRole('tab')).toHaveLength(2);
  });
});
