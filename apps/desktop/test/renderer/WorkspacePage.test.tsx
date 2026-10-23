import { act, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, useLocation, useNavigate } from 'react-router';
import type {
  LayoutNode,
  ProviderInfo,
  TerminalSummary,
  WorkspaceDto,
} from '@project-hub/contracts';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
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
        <Route path="/projects" element={<p>lista de projetos</p>} />
      </Routes>
    </>
  );
}

function renderAt(state?: unknown, projectId = 'p1') {
  return render(
    <MemoryRouter initialEntries={[{ pathname: `/workspaces/${projectId}`, state }]}>
      {tree()}
    </MemoryRouter>,
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
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

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

  it('location.state.showTerminal põe o terminal no painel ativo uma vez e limpa o estado', async () => {
    api.terminals.list.mockResolvedValue({ ok: true, data: [shellTerminal] });
    const view = renderAt({ showTerminal: 't1' });
    expect(await screen.findByTestId('terminal-view')).toHaveTextContent('t1');
    // A sessão entra no painel ativo (o primeiro); o rótulo vem do provedor da sessão.
    const [active, other] = screen.getAllByRole('region', { name: 'Painel PowerShell' });
    expect(within(active!).getByTestId('terminal-view')).toBeInTheDocument();
    expect(within(other!).queryByTestId('terminal-view')).not.toBeInTheDocument();
    expect(current.state).toBeNull();
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

  it('projeto inexistente mostra a mensagem com link para a lista', async () => {
    renderAt(undefined, 'outro');
    expect(await screen.findByText('O projeto não foi encontrado.')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /projetos/i })).toHaveAttribute('href', '/projects');
  });
});
