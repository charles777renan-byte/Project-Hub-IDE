import {
  act,
  fireEvent,
  render,
  renderHook,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
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
import {
  PROJECT_NO_GIT_NOTICE_ID,
  PROJECT_UNAVAILABLE_NOTICE_ID,
} from '../../src/renderer/components/project/ProjectHeader';
import { useTerminals } from '../../src/renderer/terminals-data';
import { notify } from '../../src/renderer/notify';
import { openFile, resetOpenFilesForTests, updateText } from '../../src/renderer/open-files';
import { WorkspacePage } from '../../src/renderer/pages/WorkspacePage';
import { AppRoutes, missionPath, ROUTE_PATHS } from '../../src/renderer/routes';

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
  files: { read: vi.fn() },
};

let current: { pathname: string; search: string; state: unknown } = {
  pathname: '',
  search: '',
  state: null,
};
function Probe() {
  const location = useLocation();
  current = { pathname: location.pathname, search: location.search, state: location.state };
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

function renderAt(state?: unknown, projectId = 'p1', search = '') {
  return render(
    <>
      <MemoryRouter initialEntries={[{ pathname: `/workspaces/${projectId}`, search, state }]}>
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
  api.files.read.mockReset().mockImplementation((_projectId: string, path: string) =>
    Promise.resolve({
      ok: true,
      data: {
        text: `texto de ${path}`,
        eol: 'lf',
        bom: false,
        version: { size: 1, mtimeMs: 1, hash: 'a'.repeat(64) },
      },
    }),
  );
  window.localStorage.clear();
  resetOpenFilesForTests();
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

  it('o terminal fechado some da lista compartilhada (a barra lateral) na hora, e volta se o fechamento falhar', async () => {
    api.workspaces.open.mockResolvedValue({
      ok: true,
      data: { ...dto(padrao()), layout: leaf('c', 'shell', 't1') },
    });
    api.terminals.list.mockResolvedValue({ ok: true, data: [shellTerminal] });
    let finish: (value: unknown) => void = () => {};
    api.workspaces.removePane.mockReturnValue(new Promise((resolve) => (finish = resolve)));
    renderAt();
    // O mesmo que a barra lateral lê: a lista de terminais da janela.
    const sidebar = renderHook(() => useTerminals());
    const pane = await screen.findByRole('region', { name: 'Painel PowerShell' });
    await waitFor(() => expect(sidebar.result.current.terminals).toHaveLength(1));
    await userEvent.click(within(pane).getByRole('button', { name: 'Fechar painel' }));
    // O processo principal ainda não respondeu, e a lista já não traz o terminal.
    expect(sidebar.result.current.terminals).toHaveLength(0);
    await act(async () =>
      finish({ ok: false, error: { code: 'x', message: 'Não foi possível fechar o painel' } }),
    );
    await waitFor(() => expect(sidebar.result.current.terminals).toHaveLength(1));
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

    describe('atalhos Ctrl+Alt+número', () => {
      const atalho = (
        digit: number,
        extra: { shiftKey?: boolean; ctrlKey?: boolean; altKey?: boolean } = {},
      ) =>
        fireEvent.keyDown(screen.getByRole('button', { name: 'Abrir terminal' }), {
          code: `Digit${digit}`,
          key: ['¹', '²', '³'][digit - 1] ?? String(digit),
          ctrlKey: true,
          altKey: true,
          ...extra,
        });

      it('Ctrl+Alt+1 abre o primeiro programa do menu sem abrir o menu', async () => {
        api.workspaces.addPane.mockResolvedValue({ ok: true, data: dto(leaf('n', 'claude')) });
        renderAt();
        await screen.findByRole('button', { name: 'Abrir terminal' });
        atalho(1);
        await waitFor(() => expect(api.workspaces.addPane).toHaveBeenCalledWith('w1', 'claude'));
        expect(screen.queryByRole('menu')).not.toBeInTheDocument();
      });

      it('Ctrl+Alt+3 abre o terceiro programa', async () => {
        api.workspaces.addPane.mockResolvedValue({ ok: true, data: dto(leaf('n', 'shell')) });
        renderAt();
        await screen.findByRole('button', { name: 'Abrir terminal' });
        atalho(3);
        await waitFor(() => expect(api.workspaces.addPane).toHaveBeenCalledWith('w1', 'shell'));
      });

      it('o atalho de um programa não instalado não abre nada', async () => {
        renderAt();
        await screen.findByRole('button', { name: 'Abrir terminal' });
        atalho(2);
        expect(api.workspaces.addPane).not.toHaveBeenCalled();
      });

      it('um número sem programa no menu não abre nada', async () => {
        renderAt();
        await screen.findByRole('button', { name: 'Abrir terminal' });
        atalho(7);
        expect(api.workspaces.addPane).not.toHaveBeenCalled();
      });

      it('sem Alt, com Shift ou sem Ctrl, o número passa direto', async () => {
        renderAt();
        await screen.findByRole('button', { name: 'Abrir terminal' });
        atalho(1, { altKey: false });
        atalho(1, { shiftKey: true });
        atalho(1, { ctrlKey: false });
        expect(api.workspaces.addPane).not.toHaveBeenCalled();
      });

      it('o atalho vale como o clique: com a pasta indisponível não abre nada', async () => {
        api.projects.list.mockResolvedValue({
          ok: true,
          data: [{ id: 'p1', name: 'app', path: 'x', repositoryKind: 'git', available: false }],
        });
        renderAt();
        await screen.findByRole('alert');
        atalho(1);
        expect(api.workspaces.addPane).not.toHaveBeenCalled();
      });

      it('o atalho engole a tecla, para o ¹ do AltGr não chegar ao terminal', async () => {
        renderAt();
        const botao = await screen.findByRole('button', { name: 'Abrir terminal' });
        const evento = new KeyboardEvent('keydown', {
          code: 'Digit1',
          key: '¹',
          ctrlKey: true,
          altKey: true,
          bubbles: true,
          cancelable: true,
        });
        botao.dispatchEvent(evento);
        expect(evento.defaultPrevented).toBe(true);
      });
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

// A animação em si só toca na janela real; aqui se prova quem é marcado e quando o painel sai do layout.
describe('animação ao abrir e fechar painéis', () => {
  beforeEach(() => {
    // Com `matchMedia` e sem "reduzir movimento", a saída espera a animação.
    vi.stubGlobal(
      'matchMedia',
      vi.fn().mockReturnValue({
        matches: false,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      }),
    );
  });

  const leafOf = (pane: HTMLElement) => pane.closest('.pane-tree__leaf') as HTMLElement;
  // O jsdom não tem AnimationEvent: sem ele o React escuta o nome com prefixo, e o `animationName` entra à mão.
  const animationEnd = (target: Element, animationName: string) => {
    const event = new Event('webkitAnimationEnd', { bubbles: true });
    Object.defineProperty(event, 'animationName', { value: animationName });
    fireEvent(target, event);
  };

  it('o painel novo nasce marcado para entrar; os que o workspace trouxe ao abrir, não', async () => {
    api.workspaces.open.mockResolvedValue({ ok: true, data: dto(leaf('a', 'claude')) });
    api.workspaces.addPane.mockResolvedValue({
      ok: true,
      data: dto(
        arrangeLeaves([leaf('a', 'claude'), leaf('n', 'shell')], () => 'novo') as LayoutNode,
      ),
    });
    renderAt();
    const first = await screen.findByRole('region', { name: 'Painel Claude Code' });
    expect(leafOf(first)).not.toHaveAttribute('data-motion');
    await abrirPrograma(/PowerShell/);
    const created = await screen.findByRole('region', { name: 'Painel PowerShell' });
    expect(leafOf(created)).toHaveAttribute('data-motion', 'entering');
    expect(leafOf(screen.getByRole('region', { name: 'Painel Claude Code' }))).not.toHaveAttribute(
      'data-motion',
    );
  });

  it('a marca de entrada sai quando a entrada termina (voltar à visão Terminais não a repete)', async () => {
    api.workspaces.open.mockResolvedValue({ ok: true, data: dto(leaf('a', 'claude')) });
    api.workspaces.addPane.mockResolvedValue({
      ok: true,
      data: dto(
        arrangeLeaves([leaf('a', 'claude'), leaf('n', 'shell')], () => 'novo') as LayoutNode,
      ),
    });
    renderAt();
    await screen.findByRole('region', { name: 'Painel Claude Code' });
    await abrirPrograma(/PowerShell/);
    const created = await screen.findByRole('region', { name: 'Painel PowerShell' });
    animationEnd(leafOf(created), 'pane-in');
    expect(leafOf(created)).not.toHaveAttribute('data-motion');
  });

  it('fechar marca a saída e só chama removePane quando a animação termina, uma vez', async () => {
    api.workspaces.open.mockResolvedValue({ ok: true, data: dto(padrao('t1')) });
    api.terminals.list.mockResolvedValue({ ok: true, data: [shellTerminal] });
    api.workspaces.removePane.mockResolvedValue({ ok: true, data: dto(leaf('a', 'claude')) });
    renderAt();
    const pane = await screen.findByRole('region', { name: 'Painel PowerShell' });
    await userEvent.click(within(pane).getByRole('button', { name: 'Fechar painel' }));
    expect(leafOf(pane)).toHaveAttribute('data-motion', 'leaving');
    expect(api.workspaces.removePane).not.toHaveBeenCalled();
    // A animação de algo de dentro do painel não conta.
    animationEnd(within(pane).getByRole('button', { name: 'Fechar painel' }), 'pane-out');
    expect(screen.getByRole('region', { name: 'Painel PowerShell' })).toBe(pane);
    expect(leafOf(pane)).toHaveAttribute('data-motion', 'leaving');
    // O fim da saída tira o painel da tela no mesmo instante, sem esperar o prazo.
    animationEnd(leafOf(pane), 'pane-out');
    expect(screen.queryByRole('region', { name: 'Painel PowerShell' })).not.toBeInTheDocument();
    await waitFor(() => expect(api.workspaces.removePane).toHaveBeenCalledWith('w1', 'c'));
    expect(api.workspaces.removePane).toHaveBeenCalledTimes(1);
  });

  it('sem o fim da animação (janela em segundo plano), o painel fecha pelo prazo', async () => {
    api.workspaces.open.mockResolvedValue({ ok: true, data: dto(padrao('t1')) });
    api.terminals.list.mockResolvedValue({ ok: true, data: [shellTerminal] });
    api.workspaces.removePane.mockResolvedValue({ ok: true, data: dto(leaf('a', 'claude')) });
    renderAt();
    const pane = await screen.findByRole('region', { name: 'Painel PowerShell' });
    await userEvent.click(within(pane).getByRole('button', { name: 'Fechar painel' }));
    await waitFor(() => expect(api.workspaces.removePane).toHaveBeenCalledWith('w1', 'c'));
    expect(api.workspaces.removePane).toHaveBeenCalledTimes(1);
  });

  it('com "reduzir movimento", fecha na hora', async () => {
    vi.stubGlobal('matchMedia', vi.fn().mockReturnValue({ matches: true }));
    api.workspaces.open.mockResolvedValue({ ok: true, data: dto(padrao('t1')) });
    api.terminals.list.mockResolvedValue({ ok: true, data: [shellTerminal] });
    api.workspaces.removePane.mockResolvedValue({ ok: true, data: dto(leaf('a', 'claude')) });
    renderAt();
    const pane = await screen.findByRole('region', { name: 'Painel PowerShell' });
    await userEvent.click(within(pane).getByRole('button', { name: 'Fechar painel' }));
    expect(api.workspaces.removePane).toHaveBeenCalledWith('w1', 'c');
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

    expect(screen.queryByRole('tablist', { name: 'Painéis abertos' })).not.toBeInTheDocument();
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

    expect(screen.queryByRole('tablist', { name: 'Painéis abertos' })).not.toBeInTheDocument();
    expect(pane('Claude Code')).toBeInTheDocument();
  });

  it('duplo clique no cabeçalho do painel maximiza', async () => {
    renderAt();
    await screen.findByRole('button', { name: 'Iniciar PowerShell' });
    const head = (pane('PowerShell') as HTMLElement).querySelector('.pane__head') as HTMLElement;

    await userEvent.dblClick(head);

    expect(screen.getByRole('tablist', { name: 'Painéis abertos' })).toBeInTheDocument();
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
    expect(
      within(screen.getByRole('tablist', { name: 'Painéis abertos' })).getAllByRole('tab'),
    ).toHaveLength(2);
  });
});

describe('aba do projeto: visões', () => {
  const view = (name: string) => screen.getByRole('tab', { name });
  // O jsdom não tem geometria: o react-resizable-panels acha que todo ponteiro cai numa divisória e cancela o
  // pointerdown de qualquer controle da página. Por isso as abas e o menu do cabeçalho aqui são acionados pelo
  // teclado (foco ativa a aba; Enter abre o menu e escolhe o item).
  const selectView = (name: string) => act(() => view(name).focus());
  const projectsApi = api.projects as unknown as Record<string, ReturnType<typeof vi.fn>>;

  it('abre em Terminais, com o workspace de painéis e a barra de visões acima', async () => {
    renderAt();

    expect(await screen.findByRole('button', { name: 'Iniciar Claude Code' })).toBeEnabled();
    const tabs = screen.getByRole('tablist', { name: 'Visões do projeto' });
    expect(within(tabs).getByRole('tab', { name: 'Terminais' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    expect(screen.getByRole('heading', { level: 1, name: 'app' })).toBeInTheDocument();
  });

  it('?visao=terminais é a mesma visão do padrão', async () => {
    renderAt(undefined, 'p1', '?visao=terminais');

    expect(await screen.findByRole('button', { name: 'Iniciar Claude Code' })).toBeEnabled();
  });

  it('trocar de visão muda ?visao= e esconde os terminais sem desmontá-los, e voltar não recarrega o workspace', async () => {
    Object.assign(api, {
      worktrees: { list: vi.fn(() => Promise.resolve({ ok: true, data: [] })) },
    });
    Object.assign(api.missions, {
      subscribe: vi.fn(() => () => undefined),
      subscribeUsage: vi.fn(() => () => undefined),
    });
    api.workspaces.open.mockResolvedValue({ ok: true, data: dto(padrao('t1')) });
    api.terminals.list.mockResolvedValue({ ok: true, data: [shellTerminal] });
    renderAt();
    const terminal = await screen.findByTestId('terminal-view');
    const terminaisPanel = document.getElementById('project-panel-terminais');
    expect(terminaisPanel).not.toHaveAttribute('hidden');
    expect(api.workspaces.open).toHaveBeenCalledTimes(1);

    selectView('Configurações');
    expect(current.search).toBe('?visao=configuracoes');
    // Continua na árvore, com o mesmo nó (o xterm não é refeito), só escondido.
    expect(screen.getByTestId('terminal-view', { exact: true })).toBe(terminal);
    expect(terminaisPanel).toHaveAttribute('hidden');
    expect(terminaisPanel).toContainElement(terminal);
    expect(
      screen.queryByRole('button', { name: 'Abrir terminal', hidden: false }),
    ).not.toBeInTheDocument();
    expect(await screen.findByRole('button', { name: 'Editar grupo' })).toBeInTheDocument();
    expect(document.getElementById('project-panel-configuracoes')).not.toHaveAttribute('hidden');

    selectView('Worktrees');
    expect(screen.getByTestId('terminal-view')).toBe(terminal);
    // As outras visões só existem enquanto ativas.
    expect(screen.queryByRole('button', { name: 'Editar grupo' })).not.toBeInTheDocument();

    selectView('Terminais');
    expect(current.search).toBe('?visao=terminais');
    expect(terminaisPanel).not.toHaveAttribute('hidden');
    expect(screen.getByTestId('terminal-view')).toBe(terminal);
    expect(screen.getByRole('button', { name: 'Abrir terminal' })).toBeInTheDocument();
    expect(api.workspaces.open).toHaveBeenCalledTimes(1);
  });

  describe('arquivos abertos', () => {
    async function comTerminal() {
      api.workspaces.open.mockResolvedValue({ ok: true, data: dto(padrao('t1')) });
      api.terminals.list.mockResolvedValue({ ok: true, data: [shellTerminal] });
      renderAt();
      return screen.findByTestId('terminal-view');
    }

    it('sem arquivo aberto, não há faixa de abas e o workspace aparece', async () => {
      const terminal = await comTerminal();

      expect(screen.queryByRole('tablist', { name: 'Arquivos abertos' })).not.toBeInTheDocument();
      expect(terminal.closest('[hidden]')).toBeNull();
    });

    it('abrir um arquivo mostra a faixa e esconde o workspace sem desmontá-lo', async () => {
      const terminal = await comTerminal();

      act(() => openFile('p1', 'src/a.ts'));

      const faixa = await screen.findByRole('tablist', { name: 'Arquivos abertos' });
      expect(within(faixa).getByRole('tab', { name: 'a.ts' })).toHaveAttribute(
        'aria-selected',
        'true',
      );
      // O mesmo nó (o xterm não é refeito), ainda no DOM, só escondido.
      expect(screen.getByTestId('terminal-view', { exact: true })).toBe(terminal);
      expect(terminal.closest('[hidden]')).not.toBeNull();
      expect(screen.queryByRole('button', { name: 'Abrir terminal' })).not.toBeInTheDocument();
      expect(api.workspaces.open).toHaveBeenCalledTimes(1);
    });

    it('a faixa fica acima do workspace, dentro do painel Terminais', async () => {
      await comTerminal();

      act(() => openFile('p1', 'a.ts'));

      const faixa = await screen.findByRole('tablist', { name: 'Arquivos abertos' });
      const painel = document.getElementById('project-panel-terminais');
      expect(painel).toContainElement(faixa);
      expect(painel?.firstElementChild).toContainElement(faixa);
    });

    it('a aba Terminais volta a mostrar o workspace sem fechar o arquivo', async () => {
      const terminal = await comTerminal();
      act(() => openFile('p1', 'a.ts'));

      const faixa = await screen.findByRole('tablist', { name: 'Arquivos abertos' });
      await userEvent.click(within(faixa).getByRole('tab', { name: 'Terminais' }));

      expect(terminal.closest('[hidden]')).toBeNull();
      expect(screen.getByRole('button', { name: 'Abrir terminal' })).toBeInTheDocument();
      expect(screen.getByRole('tab', { name: 'a.ts' })).toBeInTheDocument();
    });

    it('fechar o último arquivo remove a faixa e mostra o workspace', async () => {
      const terminal = await comTerminal();
      act(() => openFile('p1', 'a.ts'));
      await screen.findByRole('tablist', { name: 'Arquivos abertos' });

      await userEvent.click(screen.getByRole('button', { name: 'Fechar a.ts' }));

      expect(screen.queryByRole('tablist', { name: 'Arquivos abertos' })).not.toBeInTheDocument();
      expect(terminal.closest('[hidden]')).toBeNull();
      expect(screen.getByTestId('terminal-view')).toBe(terminal);
    });

    it('o painel do arquivo ativo é o tabpanel da aba dele e avisa quando o arquivo não abre', async () => {
      api.files.read.mockResolvedValue({
        ok: false,
        error: { code: 'FILE_NOT_TEXT', message: 'O arquivo não é de texto e não abre no editor.' },
      });
      await comTerminal();

      act(() => openFile('p1', 'logo.png'));

      const painel = await screen.findByRole('tabpanel', { name: 'logo.png' });
      expect(painel).toHaveTextContent('O arquivo não é de texto e não abre no editor.');
    });

    it('trocar de visão com um arquivo aberto não perde o buffer nem as edições', async () => {
      Object.assign(api, {
        worktrees: { list: vi.fn(() => Promise.resolve({ ok: true, data: [] })) },
      });
      Object.assign(api.missions, {
        subscribe: vi.fn(() => () => undefined),
        subscribeUsage: vi.fn(() => () => undefined),
      });
      const terminal = await comTerminal();
      act(() => openFile('p1', 'a.ts'));
      await screen.findByRole('tab', { name: 'a.ts' });
      // A leitura responde: só então o arquivo pode ser editado.
      await act(async () => {});
      act(() => updateText('p1', 'a.ts', 'editado'));

      selectView('Worktrees');
      expect(await screen.findByRole('tab', { name: 'Worktrees', selected: true })).toBeVisible();
      selectView('Terminais');

      const aba = await screen.findByRole('tab', { name: /a\.ts/ });
      expect(aba).toHaveAttribute('aria-selected', 'true');
      expect(within(aba).getByText('alterações não salvas')).toBeInTheDocument();
      expect(screen.getByTestId('terminal-view')).toBe(terminal);
      expect(api.files.read).toHaveBeenCalledTimes(1);
    });
  });

  it('o modo "um painel por vez" sobrevive a uma ida às Configurações e volta', async () => {
    renderAt();
    await screen.findByRole('button', { name: 'Iniciar Claude Code' });
    await userEvent.click(screen.getByRole('button', { name: 'Abas' }));
    expect(screen.getByRole('tablist', { name: 'Painéis abertos' })).toBeInTheDocument();

    selectView('Configurações');
    await screen.findByRole('button', { name: 'Editar grupo' });
    selectView('Terminais');

    expect(screen.getByRole('tablist', { name: 'Painéis abertos' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Grade' })).toBeInTheDocument();
    expect(api.workspaces.open).toHaveBeenCalledTimes(1);
  });

  it('o painel da visão é o tabpanel das abas da barra, nomeado pela aba ativa', async () => {
    Object.assign(api, {
      worktrees: { list: vi.fn(() => Promise.resolve({ ok: true, data: [] })) },
    });
    Object.assign(api.missions, {
      subscribe: vi.fn(() => () => undefined),
      subscribeUsage: vi.fn(() => () => undefined),
    });
    renderAt(undefined, 'p1', '?visao=worktrees');
    await screen.findByRole('tab', { name: 'Worktrees' });

    const panel = document.getElementById('project-panel-worktrees');
    expect(panel).toHaveAttribute('role', 'tabpanel');
    expect(panel).toHaveAttribute('aria-labelledby', 'tab-worktrees');
    expect(panel).not.toHaveAttribute('hidden');
    // Cada aba controla um painel que existe; os das outras visões ficam escondidos.
    for (const name of ['terminais', 'missoes', 'progresso', 'worktrees', 'configuracoes']) {
      const tab = document.getElementById(`tab-${name}`);
      const controlled = document.getElementById(tab?.getAttribute('aria-controls') ?? '');
      expect(controlled, name).toHaveAttribute('role', 'tabpanel');
      expect(controlled?.hasAttribute('hidden'), name).toBe(name !== 'worktrees');
    }
  });

  it('?visao=progresso mostra só o painel Progresso, com a aba selecionada', async () => {
    Object.assign(api.missions, {
      subscribe: vi.fn(() => () => undefined),
      subscribeUsage: vi.fn(() => () => undefined),
    });
    renderAt(undefined, 'p1', '?visao=progresso');

    const panel = await screen.findByRole('tabpanel', { name: 'Progresso' });
    expect(panel).not.toHaveAttribute('hidden');
    expect(screen.getByRole('tab', { name: 'Progresso' })).toHaveAttribute('aria-selected', 'true');
    for (const name of ['terminais', 'missoes', 'worktrees', 'configuracoes']) {
      expect(document.getElementById(`project-panel-${name}`), name).toHaveAttribute('hidden');
    }
  });

  it('?visao=progresso traz o resumo e a lista de missões do projeto, e as outras visões não montam', async () => {
    api.missions.list.mockResolvedValue({
      ok: true,
      data: [
        {
          id: 'm1',
          projectId: 'p1',
          title: 'Ajustar login',
          objective: 'Corrigir o login',
          status: 'running',
          altersCode: false,
          acceptanceCriteria: [],
          createdAt: '2026-10-20T09:00:00.000Z',
          updatedAt: '2026-10-20T09:00:00.000Z',
        },
      ],
    });
    Object.assign(api.missions, {
      get: vi.fn(() => Promise.resolve({ ok: false, error: { code: 'X', message: 'x' } })),
      subscribe: vi.fn(() => () => undefined),
      subscribeUsage: vi.fn(() => () => undefined),
    });
    renderAt(undefined, 'p1', '?visao=progresso');

    const panel = await screen.findByRole('tabpanel', { name: 'Progresso' });
    expect(
      await within(panel).findByRole('heading', { level: 2, name: 'Em andamento' }),
    ).toBeInTheDocument();
    expect(within(panel).getByRole('button', { name: /Ajustar login/ })).toBeInTheDocument();
    expect(within(panel).getByRole('complementary', { name: 'Atividade recente' })).toBeVisible();
    // As outras visões não montam o conteúdo (a lista de missões do projeto, worktrees e configurações).
    for (const name of ['missoes', 'worktrees', 'configuracoes']) {
      expect(document.getElementById(`project-panel-${name}`), name).toBeEmptyDOMElement();
    }
  });

  it('fora de ?visao=progresso a aba Progresso não monta a lista', async () => {
    renderAt(undefined, 'p1', '?visao=missoes');
    await screen.findByRole('tab', { name: 'Progresso' });
    expect(screen.queryByRole('complementary', { name: 'Atividade recente' })).toBeNull();
    expect(document.getElementById('project-panel-progresso')).toHaveAttribute('hidden');
  });

  it('?visao=worktrees lista os worktrees, sem título repetido', async () => {
    Object.assign(api, {
      worktrees: {
        list: vi.fn(() =>
          Promise.resolve({
            ok: true,
            data: [
              {
                missionId: 'm1',
                missionTitle: 'Ajustar login',
                status: 'failed',
                path: 'C:\\worktrees\\app\\m1',
                branch: 'ph/m1-ajustar-login',
              },
            ],
          }),
        ),
      },
    });
    Object.assign(api.missions, {
      subscribe: vi.fn(() => () => undefined),
      subscribeUsage: vi.fn(() => () => undefined),
    });
    renderAt(undefined, 'p1', '?visao=worktrees');

    expect(await screen.findByText('ph/m1-ajustar-login')).toBeInTheDocument();
    expect(screen.getByRole('list', { name: 'Worktrees do projeto' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: /^Worktrees/ })).not.toBeInTheDocument();
    expect(view('Worktrees')).toHaveAttribute('aria-selected', 'true');
  });

  it('?visao=configuracoes mostra pasta, branch, grupo e apelido, e salva grupo e apelido pela API', async () => {
    const ok = () => Promise.resolve({ ok: true, data: undefined });
    Object.assign(api.projects, {
      setGroup: vi.fn(ok),
      setNickname: vi.fn(ok),
      openFolder: vi.fn(ok),
    });
    api.projects.list.mockResolvedValue({
      ok: true,
      data: [
        {
          id: 'p1',
          name: 'app',
          path: 'C:\\Projetos\\app',
          repositoryKind: 'git',
          available: true,
          defaultBranch: 'main',
        },
      ],
    });
    renderAt(undefined, 'p1', '?visao=configuracoes');

    expect(await screen.findByText('main · Repositório Git')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Abrir pasta' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Editar grupo' }));
    await userEvent.type(screen.getByLabelText('Grupo'), 'Trabalho');
    await userEvent.click(
      within(screen.getByRole('form', { name: 'Grupo do projeto' })).getByRole('button', {
        name: 'Salvar',
      }),
    );
    expect(projectsApi['setGroup']).toHaveBeenCalledWith('p1', 'Trabalho');
    await userEvent.click(screen.getByRole('button', { name: 'Editar apelido' }));
    await userEvent.type(screen.getByLabelText('Apelido'), 'App');
    await userEvent.click(
      within(screen.getByRole('form', { name: 'Apelido do projeto' })).getByRole('button', {
        name: 'Salvar',
      }),
    );
    expect(projectsApi['setNickname']).toHaveBeenCalledWith('p1', 'App');
  });

  it('?visao=missoes mostra a lista de missões do projeto, com o estado vazio e o botão', async () => {
    Object.assign(api.missions, {
      subscribe: vi.fn(() => () => undefined),
      subscribeUsage: vi.fn(() => () => undefined),
    });
    renderAt(undefined, 'p1', '?visao=missoes');

    expect(await screen.findByRole('tab', { name: 'Missões' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    const panel = await screen.findByRole('tabpanel', { name: 'Missões' });
    expect(await within(panel).findByText('Nenhuma missão ainda.')).toBeInTheDocument();
    expect(within(panel).getByRole('button', { name: 'Nova missão' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Abrir terminal' })).not.toBeInTheDocument();
  });

  it('Nova missão do cabeçalho abre o formulário na visão Missões e limpa o pedido da rota', async () => {
    Object.assign(api.missions, {
      subscribe: vi.fn(() => () => undefined),
      subscribeUsage: vi.fn(() => () => undefined),
    });
    renderAt();
    await screen.findByRole('button', { name: 'Iniciar Claude Code' });

    await userEvent.click(screen.getByRole('button', { name: 'Nova missão' }));

    expect(await screen.findByRole('form', { name: 'Nova missão' })).toBeInTheDocument();
    await waitFor(() => expect(current.state).toBeNull());
    expect(current.pathname).toBe('/workspaces/p1');
    expect(current.search).toBe('?visao=missoes');
  });

  it('Nova missão do cabeçalho com o formulário já fechado, na própria visão, abre de novo', async () => {
    Object.assign(api.missions, {
      subscribe: vi.fn(() => () => undefined),
      subscribeUsage: vi.fn(() => () => undefined),
    });
    renderAt(undefined, 'p1', '?visao=missoes');
    const panel = await screen.findByRole('tabpanel', { name: 'Missões' });
    await within(panel).findByText('Nenhuma missão ainda.');

    await userEvent.click(screen.getAllByRole('button', { name: 'Nova missão' })[0]!);
    await userEvent.click(await screen.findByRole('button', { name: 'Cancelar' }));
    expect(screen.queryByRole('form', { name: 'Nova missão' })).not.toBeInTheDocument();
    await userEvent.click(screen.getAllByRole('button', { name: 'Nova missão' })[0]!);

    expect(await screen.findByRole('form', { name: 'Nova missão' })).toBeInTheDocument();
  });

  it('?nova-missao=1 sem ?visao= abre a visão Missões com o formulário', async () => {
    Object.assign(api.missions, {
      subscribe: vi.fn(() => () => undefined),
      subscribeUsage: vi.fn(() => () => undefined),
    });
    renderAt(undefined, 'p1', '?nova-missao=1');

    expect(await screen.findByRole('form', { name: 'Nova missão' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Missões' })).toHaveAttribute('aria-selected', 'true');
    // O pedido sai da rota, e a visão fica escrita nela (senão voltaria para Terminais).
    await waitFor(() => expect(current.search).toBe('?visao=missoes'));
    expect(screen.getByRole('tab', { name: 'Missões' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('form', { name: 'Nova missão' })).toBeInTheDocument();
  });

  it('o fundo topográfico não aparece na aba do projeto com terminais, nas Missões nem nas outras visões', async () => {
    Object.assign(api, {
      worktrees: { list: vi.fn(() => Promise.resolve({ ok: true, data: [] })) },
    });
    Object.assign(api.missions, {
      subscribe: vi.fn(() => () => undefined),
      subscribeUsage: vi.fn(() => () => undefined),
    });
    const first = renderAt(undefined, 'p1', '?visao=terminais');
    await screen.findByRole('button', { name: 'Iniciar Claude Code' });
    expect(document.querySelector('.topo-background')).toBeNull();
    first.unmount();

    for (const search of ['?visao=missoes', '?visao=worktrees', '?visao=configuracoes']) {
      const view = renderAt(undefined, 'p1', search);
      await screen.findByRole('tablist', { name: 'Visões do projeto' });
      expect(document.querySelector('.topo-background')).toBeNull();
      view.unmount();
    }
  });

  it('o fundo topográfico só aparece no estado vazio dos terminais, dentro dele', async () => {
    api.workspaces.open.mockResolvedValue({ ok: true, data: { ...dto(padrao()), layout: null } });
    renderAt(undefined, 'p1', '?visao=terminais');

    const empty = (await screen.findByText('Nenhum terminal aberto')).closest('.workspace__empty');
    expect(empty).not.toBeNull();
    expect(empty?.querySelector('.topo-background')).not.toBeNull();
    expect(document.querySelectorAll('.topo-background')).toHaveLength(1);
  });

  it('com os terminais vazios mas escondidos (outra visão), o fundo topográfico não fica montado', async () => {
    Object.assign(api, {
      worktrees: { list: vi.fn(() => Promise.resolve({ ok: true, data: [] })) },
    });
    Object.assign(api.missions, {
      subscribe: vi.fn(() => () => undefined),
      subscribeUsage: vi.fn(() => () => undefined),
    });
    api.workspaces.open.mockResolvedValue({ ok: true, data: { ...dto(padrao()), layout: null } });
    renderAt(undefined, 'p1', '?visao=terminais');
    await screen.findByText('Nenhum terminal aberto');
    expect(document.querySelectorAll('.topo-background')).toHaveLength(1);

    selectView('Missões');
    expect(document.getElementById('project-panel-terminais')).toHaveAttribute('hidden');
    expect(document.querySelector('.topo-background')).toBeNull();

    selectView('Worktrees');
    expect(document.querySelector('.topo-background')).toBeNull();

    selectView('Terminais');
    expect(document.querySelectorAll('.topo-background')).toHaveLength(1);
  });

  it('Arquivar pelo Mais ações pede confirmação e leva ao Início', async () => {
    Object.assign(api.projects, {
      archive: vi.fn(() => Promise.resolve({ ok: true, data: undefined })),
    });
    renderAt();
    await screen.findByRole('button', { name: 'Iniciar Claude Code' });

    act(() => screen.getByRole('button', { name: 'Mais ações' }).focus());
    await userEvent.keyboard('{Enter}');
    await screen.findByRole('menuitem', { name: 'Arquivar projeto' });
    await userEvent.keyboard('{Enter}');
    expect(projectsApi['archive']).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole('button', { name: 'Arquivar' }));

    expect(await screen.findByText('página inicial')).toBeInTheDocument();
    expect(projectsApi['archive']).toHaveBeenCalledWith('p1');
  });

  it('o pedido de terminal da barra lateral mantém a visão da rota ao limpar o estado', async () => {
    api.workspaces.open.mockResolvedValue({ ok: true, data: dto(padrao('t1')) });
    api.terminals.list.mockResolvedValue({ ok: true, data: [shellTerminal] });
    renderAt({ showTerminal: 't1' }, 'p1', '?visao=terminais');

    await screen.findByTestId('terminal-view');
    await waitFor(() => expect(current.state).toBeNull());
    expect(current.search).toBe('?visao=terminais');
  });

  it('projeto ausente, em qualquer visão, mostra a mensagem com o link para o Início', async () => {
    renderAt(undefined, 'outro', '?visao=configuracoes');

    expect(await screen.findByText('O projeto não foi encontrado.')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Voltar ao Início' })).toHaveAttribute('href', '/');
    expect(screen.queryByRole('tablist', { name: 'Visões do projeto' })).not.toBeInTheDocument();
  });

  it('/projects/p1 redireciona para /workspaces/p1?visao=missoes e abre o formulário da nova missão', async () => {
    Object.assign(api.missions, {
      subscribe: vi.fn(() => () => undefined),
      subscribeUsage: vi.fn(() => () => undefined),
    });
    render(
      <MemoryRouter initialEntries={[{ pathname: '/projects/p1', state: { newMission: true } }]}>
        <Probe />
        <AppRoutes />
      </MemoryRouter>,
    );

    expect(await screen.findByRole('tab', { name: 'Missões' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    expect(await screen.findByRole('form', { name: 'Nova missão' })).toBeInTheDocument();
    await waitFor(() => expect(current.state).toBeNull());
    expect(current.pathname).toBe('/workspaces/p1');
    expect(current.search).toBe('?visao=missoes');
  });
});

describe('aba do projeto: missão aberta', () => {
  const MISSION_VIEW = {
    mission: {
      id: 'm1',
      projectId: 'p1',
      title: 'Ajustar login',
      objective: 'Corrigir o login',
      status: 'draft',
      altersCode: false,
      acceptanceCriteria: [],
      createdAt: '2026-10-20T09:00:00.000Z',
      updatedAt: '2026-10-20T09:00:00.000Z',
    },
    project: { id: 'p1', name: 'app', path: 'x', defaultBranch: 'main' },
    steps: [],
    executions: [],
    pendingApprovals: [],
    events: [],
  };
  let go: (to: string) => void = () => undefined;
  function Nav() {
    const navigate = useNavigate();
    go = (to) => navigate(to);
    return null;
  }

  function renderMission(initial = '/workspaces/p1/missoes/m1') {
    Object.assign(api, {
      worktrees: { list: vi.fn(() => Promise.resolve({ ok: true, data: [] })) },
    });
    Object.assign(api.missions, {
      get: vi.fn(() => Promise.resolve({ ok: true, data: MISSION_VIEW })),
      diff: vi.fn(() => Promise.resolve({ ok: true, data: { files: [], truncatedFiles: false } })),
      subscribe: vi.fn(() => () => undefined),
      subscribeUsage: vi.fn(() => () => undefined),
    });
    return render(
      <>
        <MemoryRouter initialEntries={[initial]}>
          <Nav />
          {tree()}
        </MemoryRouter>
        <Toaster />
      </>,
    );
  }

  it('a missão abre dentro da aba do projeto: o cabeçalho segue na tela, com Missões como visão ativa', async () => {
    renderMission();

    expect(
      await screen.findByRole('heading', { level: 1, name: 'Ajustar login' }),
    ).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 1, name: 'app' })).toBeInTheDocument();
    const tabs = screen.getByRole('tablist', { name: 'Visões do projeto' });
    expect(within(tabs).getByRole('tab', { name: 'Missões' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    expect(within(tabs).getByRole('tab', { name: 'Terminais' })).toHaveAttribute(
      'aria-selected',
      'false',
    );
    // A missão ocupa o painel das Missões, no lugar da lista.
    const panel = document.getElementById('project-panel-missoes');
    expect(panel).not.toHaveAttribute('hidden');
    expect(panel).toHaveClass('project-tab__panel--mission');
    expect(panel).toContainElement(
      screen.getByRole('heading', { level: 1, name: 'Ajustar login' }),
    );
    expect(screen.queryByRole('form', { name: 'Nova missão' })).not.toBeInTheDocument();
  });

  it('com a missão aberta, o cabeçalho do projeto não repete Nova missão nem Mais ações: sobra o Mais ações da missão', async () => {
    renderMission();
    await screen.findByRole('heading', { level: 1, name: 'Ajustar login' });

    const header = document.querySelector('.project-header') as HTMLElement;
    expect(within(header).queryByRole('button', { name: 'Nova missão' })).toBeNull();
    expect(within(header).queryByRole('button', { name: 'Mais ações' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Nova missão' })).toBeNull();
    expect(screen.getAllByRole('button', { name: 'Mais ações' })).toHaveLength(1);
  });

  it('o fundo topográfico não aparece atrás da missão aberta, nem com os terminais vazios escondidos', async () => {
    api.workspaces.open.mockResolvedValue({ ok: true, data: { ...dto(padrao()), layout: null } });
    renderMission();
    await screen.findByRole('heading', { level: 1, name: 'Ajustar login' });

    expect(document.querySelector('.topo-background')).toBeNull();
  });

  it('com a missão aberta, os terminais seguem montados, escondidos', async () => {
    api.workspaces.open.mockResolvedValue({ ok: true, data: dto(padrao('t1')) });
    api.terminals.list.mockResolvedValue({ ok: true, data: [shellTerminal] });
    renderMission();

    await screen.findByRole('heading', { level: 1, name: 'Ajustar login' });
    const terminal = await screen.findByTestId('terminal-view');
    expect(document.getElementById('project-panel-terminais')).toHaveAttribute('hidden');
    expect(document.getElementById('project-panel-terminais')).toContainElement(terminal);
  });

  it('abrir a missão e voltar por "← Missões" não recarrega o workspace nem refaz o terminal', async () => {
    api.workspaces.open.mockResolvedValue({ ok: true, data: dto(padrao('t1')) });
    api.terminals.list.mockResolvedValue({ ok: true, data: [shellTerminal] });
    renderMission('/workspaces/p1');
    const terminal = await screen.findByTestId('terminal-view');
    expect(api.workspaces.open).toHaveBeenCalledTimes(1);

    act(() => go('/workspaces/p1/missoes/m1'));
    await screen.findByRole('heading', { level: 1, name: 'Ajustar login' });
    expect(current.pathname).toBe('/workspaces/p1/missoes/m1');
    expect(screen.getByTestId('terminal-view')).toBe(terminal);

    await userEvent.click(screen.getByRole('link', { name: '← Missões' }));

    expect(current.pathname).toBe('/workspaces/p1');
    expect(current.search).toBe('?visao=missoes');
    // A lista de missões do projeto voltou ao painel (o botão do cabeçalho também se chama "Nova missão").
    const panel = document.getElementById('project-panel-missoes') as HTMLElement;
    expect(await within(panel).findByRole('button', { name: 'Nova missão' })).toBeInTheDocument();
    expect(
      screen.queryByRole('heading', { level: 1, name: 'Ajustar login' }),
    ).not.toBeInTheDocument();
    expect(screen.getByTestId('terminal-view')).toBe(terminal);
    expect(api.workspaces.open).toHaveBeenCalledTimes(1);
  });

  it('escolher Missões de novo, com a missão aberta, volta à lista de missões', async () => {
    renderMission();
    await screen.findByRole('heading', { level: 1, name: 'Ajustar login' });

    fireEvent.click(screen.getByRole('tab', { name: 'Missões' }));

    await waitFor(() => expect(current.pathname).toBe('/workspaces/p1'));
    expect(current.search).toBe('?visao=missoes');
  });

  it('escolher outra visão com a missão aberta leva a ela', async () => {
    renderMission();
    await screen.findByRole('heading', { level: 1, name: 'Ajustar login' });

    act(() => screen.getByRole('tab', { name: 'Terminais' }).focus());

    await waitFor(() => expect(current.search).toBe('?visao=terminais'));
    expect(current.pathname).toBe('/workspaces/p1');
    expect(
      screen.queryByRole('heading', { level: 1, name: 'Ajustar login' }),
    ).not.toBeInTheDocument();
  });

  it('a rota antiga da missão redireciona para a missão dentro da aba do projeto', async () => {
    Object.assign(api.missions, {
      get: vi.fn(() => Promise.resolve({ ok: true, data: MISSION_VIEW })),
      diff: vi.fn(() => Promise.resolve({ ok: true, data: { files: [], truncatedFiles: false } })),
      subscribe: vi.fn(() => () => undefined),
      subscribeUsage: vi.fn(() => () => undefined),
    });
    render(
      <MemoryRouter initialEntries={['/projects/p1/missions/m1']}>
        <Probe />
        <AppRoutes />
      </MemoryRouter>,
    );

    expect(
      await screen.findByRole('heading', { level: 1, name: 'Ajustar login' }),
    ).toBeInTheDocument();
    expect(current.pathname).toBe('/workspaces/p1/missoes/m1');
  });

  it('missionPath monta o endereço da missão na aba do projeto', () => {
    expect(missionPath('p1', 'm1')).toBe('/workspaces/p1/missoes/m1');
    expect(missionPath('a b', 'm/1')).toBe('/workspaces/a%20b/missoes/m%2F1');
  });

  it('projeto ausente, com a missão na rota, mostra a mensagem com o link para o Início', async () => {
    renderMission('/workspaces/outro/missoes/m1');

    expect(await screen.findByText('O projeto não foi encontrado.')).toBeInTheDocument();
    expect(screen.queryByRole('heading', { level: 1, name: 'Ajustar login' })).toBeNull();
  });

  it('com a pasta indisponível, a missão aberta mostra o aviso da pasta acima do conteúdo', async () => {
    api.projects.list.mockResolvedValue({
      ok: true,
      data: [
        {
          id: 'p1',
          name: 'app',
          path: 'C:\\Projetos\\app',
          repositoryKind: 'git',
          available: false,
        },
      ],
    });
    renderMission();

    expect(
      await screen.findByRole('heading', { level: 1, name: 'Ajustar login' }),
    ).toBeInTheDocument();
    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent('A pasta deste projeto não está disponível.');
    expect(alert).toHaveAttribute('id', PROJECT_UNAVAILABLE_NOTICE_ID);
  });
});

describe('pasta do projeto indisponível', () => {
  /** Lista de projetos com a pasta `p1`; os campos extras entram no resumo (ex.: `available`). */
  const comPasta = (extra: Record<string, unknown>) =>
    api.projects.list.mockResolvedValue({
      ok: true,
      data: [{ id: 'p1', name: 'app', path: 'C:\\Projetos\\app', repositoryKind: 'git', ...extra }],
    });

  it('mostra o aviso com o caminho esperado quando available é false', async () => {
    comPasta({ available: false });
    renderAt();

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(
      'A pasta deste projeto não está disponível. Ela pode ter sido movida ou apagada. Caminho esperado: C:\\Projetos\\app',
    );
    expect(alert).toHaveAttribute('id', PROJECT_UNAVAILABLE_NOTICE_ID);
  });

  it('o aviso fica acima do corpo da aba, também fora de Terminais', async () => {
    Object.assign(api.missions, {
      subscribe: vi.fn(() => () => undefined),
      subscribeUsage: vi.fn(() => () => undefined),
    });
    comPasta({ available: false });
    renderAt(undefined, 'p1', '?visao=missoes');

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('A pasta deste projeto não está disponível.');
    const panel = await screen.findByRole('tabpanel', { name: 'Missões' });
    // O aviso vem antes do painel da visão na ordem do documento: fica acima dele.
    expect(alert.compareDocumentPosition(panel) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('com a pasta indisponível, Abrir terminal e Nova missão ficam desabilitados', async () => {
    comPasta({ available: false });
    renderAt();

    await screen.findByRole('alert');
    expect(await screen.findByRole('button', { name: 'Abrir terminal' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Nova missão' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Nova missão' })).toHaveAttribute(
      'aria-describedby',
      PROJECT_UNAVAILABLE_NOTICE_ID,
    );
  });

  it('com a pasta indisponível, os painéis do lançador ficam com o Iniciar desabilitado', async () => {
    comPasta({ available: false });
    renderAt();

    await screen.findByRole('alert');
    const claude = await screen.findByRole('button', { name: 'Iniciar Claude Code' });
    expect(claude).toBeDisabled();
    expect(claude).toHaveAttribute('aria-describedby', PROJECT_UNAVAILABLE_NOTICE_ID);
    expect(screen.getByRole('button', { name: 'Iniciar PowerShell' })).toBeDisabled();
  });

  it('com a pasta disponível, não há aviso e os dois botões seguem habilitados', async () => {
    comPasta({ available: true });
    renderAt();

    expect(await screen.findByRole('button', { name: 'Abrir terminal' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Nova missão' })).toBeEnabled();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('sem o campo available, vale disponível: sem aviso e com os botões habilitados', async () => {
    comPasta({});
    renderAt();

    expect(await screen.findByRole('button', { name: 'Abrir terminal' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Nova missão' })).toBeEnabled();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
});

describe('projeto sem Git', () => {
  it('sem Git, a aba Terminais não mostra aviso e Nova missão explica pelo título', async () => {
    api.projects.list.mockResolvedValue({
      ok: true,
      data: [
        {
          id: 'p1',
          name: 'app',
          path: 'C:\\Projetos\\app',
          repositoryKind: 'none',
          available: true,
        },
      ],
    });
    renderAt();

    const button = await screen.findByRole('button', { name: 'Nova missão' });
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute('title', expect.stringContaining('git init'));
    expect(screen.queryByText(/git init/)).toBeNull();
  });

  it('com Git, não há aviso e Nova missão segue habilitado', async () => {
    renderAt();

    expect(await screen.findByRole('button', { name: 'Nova missão' })).toBeEnabled();
    expect(document.getElementById(PROJECT_NO_GIT_NOTICE_ID)).toBeNull();
  });
});
