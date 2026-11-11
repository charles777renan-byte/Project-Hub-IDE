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
import { arrangeLeaves } from '@project-hub/contracts/layout-ops';
import { Toaster } from '../../src/renderer/components/Toaster';
import { FakeResizeObserver } from './fake-resize-observer';
import {
  PROJECT_NO_GIT_NOTICE_ID,
  PROJECT_UNAVAILABLE_NOTICE_ID,
} from '../../src/renderer/components/project/ProjectHeader';
import { useTerminals } from '../../src/renderer/terminals-data';
import { notify } from '../../src/renderer/notify';
import { openFile, resetOpenFilesForTests } from '../../src/renderer/open-files';
import {
  requestCloseAll,
  resetCloseAllForTests,
  useCloseAllRequest,
  usePaneCount,
} from '../../src/renderer/workspace/close-all';
import { WorkspacePage } from '../../src/renderer/pages/WorkspacePage';
import { AppRoutes, missionPath, ROUTE_PATHS } from '../../src/renderer/routes';

// O xterm precisa de um navegador de verdade. Aqui o terminal é trocado por um marcador, que conta as montagens: cada
// uma, no app, cria o xterm e o WebGL de novo e repete a saída guardada.
const montagensDoTerminal = vi.hoisted(() => ({ ids: [] as string[] }));
vi.mock('../../src/renderer/components/terminals/TerminalView', async () => {
  const { useEffect } = await import('react');
  return {
    TerminalView: ({ terminalId }: { terminalId: string }) => {
      useEffect(() => {
        montagensDoTerminal.ids.push(terminalId);
      }, [terminalId]);
      return <div data-testid="terminal-view">{terminalId}</div>;
    },
  };
});

/**
 * A medida que o observador falso dá à área da grade (`.workspace__area`) quando começa a observá-la; `null` é "ainda
 * sem medida". Todo outro elemento mede 1000 × 800, para a biblioteca das divisórias calcular o layout.
 */
let areaSize: { width: number; height: number } | null = { width: 1000, height: 800 };
class ObservadorDaArea extends FakeResizeObserver {
  override observe(target: Element) {
    super.observe(target);
    const size = target.classList.contains('workspace__area')
      ? areaSize
      : { width: 1000, height: 800 };
    if (size !== null) this.report(target, size.width, size.height);
  }
}

/** Avisa que a área da grade passou a medir `width` × `height`, como o navegador ao mudar o tamanho da janela. */
function medirArea(width: number, height: number) {
  const area = document.querySelector('.workspace__area');
  if (area === null) throw new Error('A área da grade não está na tela.');
  const observadores = FakeResizeObserver.instances.filter((item) => item.observed.has(area));
  if (observadores.length === 0) throw new Error('Ninguém observa a área da grade.');
  act(() => observadores.forEach((item) => item.report(area, width, height)));
}

// Um espião sobre `setSizes`, para ver se mover uma divisória chega ao hook (o resto do hook é o de verdade).
const setSizesChamado = vi.hoisted(() => vi.fn());
vi.mock('../../src/renderer/workspace/use-workspace', async (importOriginal) => {
  const original =
    await importOriginal<typeof import('../../src/renderer/workspace/use-workspace')>();
  return {
    ...original,
    useWorkspace: (projectId: string) => {
      const workspace = original.useWorkspace(projectId);
      return {
        ...workspace,
        setSizes: (splitId: string, sizes: number[]) => {
          setSizesChamado(splitId, sizes);
          workspace.setSizes(splitId, sizes);
        },
      };
    },
  };
});

const leaf = (
  id: string,
  provider: 'claude' | 'codex' | 'shell',
  terminalId: string | null = null,
) => ({ type: 'leaf', id, provider, terminalId }) as const;

/**
 * Abre o menu ⋯ do painel pelo teclado. Com mais de um painel, o clique do mouse não serve no jsdom: a
 * biblioteca das divisórias mede tudo em zero ali, trata todo clique como se fosse na divisória e o cancela, e
 * o Radix só abre o menu no pointerdown que ninguém cancelou. No navegador de verdade o clique funciona (E2E).
 */
async function abrirMenuDoPainel(pane: HTMLElement): Promise<void> {
  within(pane).getByRole('button', { name: 'Mais ações do painel' }).focus();
  await userEvent.keyboard('{Enter}');
}

/** Fecha o painel de uma sessão viva: abre o menu ⋯ e escolhe o item que fecha sem perguntar (shell comum). */
async function fecharPeloMenu(pane: HTMLElement): Promise<void> {
  await abrirMenuDoPainel(pane);
  await userEvent.click(await screen.findByRole('menuitem', { name: 'Fechar painel' }));
}

function padrao(shellTerminal: string | null = null): LayoutNode {
  return {
    type: 'split',
    id: 'raiz',
    direction: 'row',
    children: [
      leaf('a', 'claude'),
      {
        type: 'split',
        id: 'meio',
        direction: 'column',
        children: [leaf('b', 'codex'), leaf('c', 'shell', shellTerminal)],
        sizes: [0.5, 0.5],
      },
    ],
    sizes: [0.5, 0.5],
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
    splitPane: vi.fn(),
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
  montagensDoTerminal.ids.length = 0;
  vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockReturnValue(1000);
  vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockReturnValue(800);
  areaSize = { width: 1000, height: 800 };
  setSizesChamado.mockClear();
  FakeResizeObserver.instances = [];
  vi.stubGlobal('ResizeObserver', ObservadorDaArea);
  api.workspaces.list.mockResolvedValue({ ok: true, data: [] });
  api.workspaces.open.mockResolvedValue({ ok: true, data: dto(padrao()) });
  api.workspaces.saveLayout.mockReset().mockResolvedValue({ ok: true, data: undefined });
  api.workspaces.startSession.mockReset();
  api.workspaces.endSession.mockReset();
  api.workspaces.addPane.mockReset();
  api.workspaces.splitPane.mockReset();
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
  resetCloseAllForTests();
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
    await fecharPeloMenu(pane);
    expect(api.workspaces.removePane).toHaveBeenCalledWith('w1', 'c');
  });

  it('fechar um agente avulso vivo pergunta antes; "Voltar" mantém o painel e confirmar chama removePane', async () => {
    api.workspaces.open.mockResolvedValue({ ok: true, data: dto(padrao('t1')) });
    api.terminals.list.mockResolvedValue({
      ok: true,
      data: [{ ...shellTerminal, provider: 'claude', title: 'Claude Code' }],
    });
    api.workspaces.removePane.mockResolvedValue({ ok: true, data: dto(leaf('a', 'claude')) });
    renderAt();
    await screen.findAllByRole('region', { name: 'Painel Claude Code' });
    // Dois painéis levam o nome do Claude Code: o lançador da folha `a` e a sessão avulsa da folha `c`.
    const pane = screen
      .getAllByRole('region', { name: 'Painel Claude Code' })
      .find(
        (item) => within(item).queryByRole('button', { name: 'Mais ações do painel' }) !== null,
      );
    if (pane === undefined) throw new Error('sem o painel da sessão avulsa');
    await abrirMenuDoPainel(pane);
    await userEvent.click(
      await screen.findByRole('menuitem', { name: 'Fechar painel e encerrar…' }),
    );
    await userEvent.click(within(pane).getByRole('button', { name: 'Voltar' }));
    expect(api.workspaces.removePane).not.toHaveBeenCalled();
    await abrirMenuDoPainel(pane);
    await userEvent.click(
      await screen.findByRole('menuitem', { name: 'Fechar painel e encerrar…' }),
    );
    await userEvent.click(within(pane).getByRole('button', { name: 'Fechar e encerrar' }));
    await waitFor(() => expect(api.workspaces.removePane).toHaveBeenCalledWith('w1', 'c'));
    expect(api.workspaces.removePane).toHaveBeenCalledTimes(1);
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
    await fecharPeloMenu(pane);
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
    await fecharPeloMenu(pane);
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
    await fecharPeloMenu(pane);
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
    // Sessão de missão: é a única que tem "Tirar do painel" (item do menu ⋯).
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
    await abrirMenuDoPainel(active!);
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Tirar do painel' }));
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
    api.workspaces.splitPane.mockResolvedValue({
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
    api.workspaces.splitPane.mockResolvedValue({
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
    await fecharPeloMenu(pane);
    expect(leafOf(pane)).toHaveAttribute('data-motion', 'leaving');
    expect(api.workspaces.removePane).not.toHaveBeenCalled();
    // A animação de algo de dentro do painel não conta.
    animationEnd(within(pane).getByRole('button', { name: 'Mais ações do painel' }), 'pane-out');
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
    await fecharPeloMenu(pane);
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
    await fecharPeloMenu(pane);
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

  it('entrar e sair do modo Abas e trocar de aba não recriam o terminal', async () => {
    api.workspaces.open.mockResolvedValue({ ok: true, data: dto(padrao('t1')) });
    api.terminals.list.mockResolvedValue({ ok: true, data: [shellTerminal] });
    renderAt();
    await screen.findByRole('region', { name: 'Painel PowerShell' });
    await waitFor(() => expect(montagensDoTerminal.ids).toEqual(['t1']));

    await userEvent.click(screen.getByRole('button', { name: 'Abas' }));
    expect(pane('PowerShell')).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('tab', { name: /PowerShell/ }));
    expect(pane('PowerShell')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('tab', { name: /Codex/ }));
    await userEvent.click(screen.getByRole('tab', { name: /PowerShell/ }));
    await userEvent.click(screen.getByRole('button', { name: 'Grade' }));

    expect(pane('PowerShell')).toBeInTheDocument();
    expect(screen.getAllByTestId('terminal-view')).toHaveLength(1);
    expect(montagensDoTerminal.ids).toEqual(['t1']);
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

    await fecharPeloMenu(pane('PowerShell') as HTMLElement);

    await waitFor(() => expect(pane('Codex')).toBeInTheDocument());
    expect(pane('PowerShell')).not.toBeInTheDocument();
    expect(
      within(screen.getByRole('tablist', { name: 'Painéis abertos' })).getAllByRole('tab'),
    ).toHaveLength(2);
  });
});

describe('layout que não cabe na área (modo foco)', () => {
  const regioes = () => screen.queryAllByRole('region', { name: /^Painel / });
  const abas = () => screen.queryByRole('tablist', { name: 'Painéis abertos' });
  const idsDosGrupos = () =>
    Array.from(document.querySelectorAll('.pane-tree__group')).map((grupo) => grupo.id);

  /** `n` painéis de Claude Code sem sessão, em grade (6 ficam em 3 colunas e 2 linhas: pedem 1036 × 408 px). */
  function guardado(n: number): LayoutNode {
    const folhas = Array.from({ length: n }, (_, i) => leaf(`g${i + 1}`, 'claude'));
    return arrangeLeaves(folhas, () => crypto.randomUUID()) as LayoutNode;
  }
  const abrirCom = (layout: LayoutNode) =>
    api.workspaces.open.mockResolvedValue({ ok: true, data: dto(layout) });

  it('sem a primeira medida, mostra o layout guardado, sem abas', async () => {
    areaSize = null;
    abrirCom(guardado(6));
    renderAt();
    await screen.findAllByRole('button', { name: 'Iniciar Claude Code' });
    expect(regioes()).toHaveLength(6);
    expect(abas()).not.toBeInTheDocument();
  });

  it('1200 × 600 com 6 painéis em 3 × 2: o layout guardado fica como está', async () => {
    areaSize = null;
    abrirCom(guardado(6));
    renderAt();
    await screen.findAllByRole('button', { name: 'Iniciar Claude Code' });
    const antes = idsDosGrupos();
    medirArea(1200, 600);
    expect(regioes()).toHaveLength(6);
    expect(abas()).not.toBeInTheDocument();
    expect(idsDosGrupos()).toEqual(antes);
  });

  it('1000 × 600 com 6 painéis: um painel grande e os outros nas abas; ao caber de novo, volta o layout guardado', async () => {
    abrirCom(guardado(6));
    renderAt();
    await screen.findAllByRole('button', { name: 'Iniciar Claude Code' });
    medirArea(1200, 600);
    const antes = idsDosGrupos();
    medirArea(1000, 600);
    expect(regioes()).toHaveLength(1);
    expect(within(abas() as HTMLElement).getAllByRole('tab')).toHaveLength(6);
    expect(api.workspaces.saveLayout).not.toHaveBeenCalled();

    medirArea(1200, 600);
    expect(abas()).not.toBeInTheDocument();
    expect(regioes()).toHaveLength(6);
    expect(idsDosGrupos()).toEqual(antes);
  });

  it('área baixa demais (1400 × 400 com 3 painéis, dois deles empilhados) também entra no modo foco', async () => {
    renderAt();
    await screen.findByRole('button', { name: 'Iniciar Claude Code' });
    medirArea(1400, 400);
    expect(regioes()).toHaveLength(1);
    expect(abas()).toBeInTheDocument();
    medirArea(1400, 420);
    expect(regioes()).toHaveLength(3);
  });

  describe('janela estreita (modo Abas automático)', () => {
    it('quando o layout não cabe na largura entra a faixa de abas com o aviso, "Grade" sem efeito e "Abas" apertado', async () => {
      renderAt();
      await screen.findByRole('button', { name: 'Iniciar Claude Code' });
      medirArea(600, 600);
      expect(screen.getByRole('tablist', { name: 'Painéis abertos' })).toBeInTheDocument();
      expect(screen.getByText('Janela estreita')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Grade' })).toHaveAttribute(
        'aria-disabled',
        'true',
      );
      expect(screen.getByRole('button', { name: 'Abas' })).toHaveAttribute('aria-pressed', 'true');
      expect(regioes()).toHaveLength(1);
    });

    it('voltar a 1000 × 600 restaura a grade', async () => {
      renderAt();
      await screen.findByRole('button', { name: 'Iniciar Claude Code' });
      medirArea(600, 600);
      medirArea(1000, 600);
      expect(screen.queryByRole('tablist', { name: 'Painéis abertos' })).not.toBeInTheDocument();
      expect(regioes()).toHaveLength(3);
      expect(screen.getByRole('button', { name: 'Abas' })).toHaveAttribute('aria-pressed', 'false');
    });

    it('se a pessoa ligou "Abas" à mão antes, o modo continua ao alargar a janela', async () => {
      renderAt();
      await screen.findByRole('button', { name: 'Iniciar Claude Code' });
      await userEvent.click(screen.getByRole('button', { name: 'Abas' }));
      medirArea(600, 600);
      expect(screen.getByText('Janela estreita')).toBeInTheDocument();
      medirArea(1000, 600);
      expect(screen.getByRole('tablist', { name: 'Painéis abertos' })).toBeInTheDocument();
      expect(screen.queryByText('Janela estreita')).not.toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Grade' })).toBeInTheDocument();
    });

    it('trocar de aba na janela estreita não liga o modo à mão: ao alargar, volta a grade', async () => {
      renderAt();
      await screen.findByRole('button', { name: 'Iniciar Claude Code' });
      medirArea(600, 600);
      await userEvent.click(screen.getByRole('tab', { name: /Codex/ }));
      expect(regioes()).toHaveLength(1);
      medirArea(1000, 600);
      expect(screen.queryByRole('tablist', { name: 'Painéis abertos' })).not.toBeInTheDocument();
      expect(regioes()).toHaveLength(3);
    });

    it('"Abas" na janela estreita não parece morto: o clique vale quando a janela alargar', async () => {
      renderAt();
      await screen.findByRole('button', { name: 'Iniciar Claude Code' });
      medirArea(600, 600);
      await userEvent.click(screen.getByRole('button', { name: 'Abas' }));
      expect(screen.getByRole('button', { name: 'Abas' })).toHaveAttribute('aria-pressed', 'true');
      medirArea(1000, 600);
      expect(screen.getByRole('tablist', { name: 'Painéis abertos' })).toBeInTheDocument();
    });

    it('Ctrl+Alt com as setas troca de aba no modo automático', async () => {
      renderAt();
      await screen.findByRole('button', { name: 'Iniciar Claude Code' });
      medirArea(600, 600);
      screen.getByRole('tab', { name: /Claude Code/ }).focus();
      await userEvent.keyboard('{Control>}{Alt>}{ArrowRight}{/Alt}{/Control}');
      expect(screen.getByRole('region', { name: 'Painel Codex' })).toBeInTheDocument();
      expect(screen.getByText('Janela estreita')).toBeInTheDocument();
    });

    it('o painel mostrado não tem o botão de maximizar (não haveria para onde voltar)', async () => {
      renderAt();
      await screen.findByRole('button', { name: 'Iniciar Claude Code' });
      medirArea(600, 600);
      expect(screen.queryByRole('button', { name: 'Voltar à grade' })).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Maximizar painel' })).not.toBeInTheDocument();
    });
  });

  it('janela arrastada em rajada (1200 → 1210 → 1220 × 600) não remonta a árvore', async () => {
    abrirCom(guardado(6));
    renderAt();
    await screen.findAllByRole('button', { name: 'Iniciar Claude Code' });
    medirArea(1200, 600);
    const grupo = document.querySelector('.pane-tree__group');
    expect(grupo).not.toBeNull();
    medirArea(1210, 600);
    medirArea(1220, 600);
    expect(document.querySelector('.pane-tree__group')).toBe(grupo);
    expect(regioes()).toHaveLength(6);
  });

  it('uma medida zerada (a visão do projeto escondida) mantém a grade como estava', async () => {
    abrirCom(guardado(6));
    renderAt();
    await screen.findAllByRole('button', { name: 'Iniciar Claude Code' });
    medirArea(1200, 600);
    const grupo = document.querySelector('.pane-tree__group');
    medirArea(0, 0);
    expect(abas()).not.toBeInTheDocument();
    expect(regioes()).toHaveLength(6);
    expect(document.querySelector('.pane-tree__group')).toBe(grupo);
  });

  it('mover uma divisória chega ao hook com os tamanhos novos e grava o layout', async () => {
    abrirCom(guardado(6));
    renderAt();
    await screen.findAllByRole('button', { name: 'Iniciar Claude Code' });
    medirArea(1200, 600);
    const [primeira] = screen.getAllByRole('separator') as [HTMLElement];
    // A divisória vertical anda com as setas laterais; a horizontal, com as de cima e de baixo.
    const key =
      primeira.getAttribute('aria-orientation') === 'horizontal' ? 'ArrowDown' : 'ArrowRight';
    act(() => primeira.focus());
    fireEvent.keyDown(primeira, { key });
    expect(setSizesChamado).toHaveBeenCalledTimes(1);
    const [, sizes] = setSizesChamado.mock.calls[0] as [string, number[]];
    expect(sizes.reduce((sum, size) => sum + size, 0)).toBeCloseTo(1);
    await waitFor(() => expect(api.workspaces.saveLayout).toHaveBeenCalled(), { timeout: 2000 });
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

  it('as ferramentas dos terminais ficam na faixa do projeto, sem uma terceira faixa', async () => {
    renderAt();
    await screen.findByRole('button', { name: 'Iniciar Claude Code' });

    const header = document.querySelector('.project-header') as HTMLElement;
    expect(within(header).getByRole('button', { name: 'Abrir terminal' })).toBeInTheDocument();
    expect(within(header).getByRole('group', { name: 'Layout dos painéis' })).toBeInTheDocument();
    expect(document.querySelector('.workspace > .workspace__toolbar')).toBeNull();
    // Um destino num lugar só: "Terminais" é a aba da visão e nada mais.
    expect(screen.getAllByText('Terminais')).toHaveLength(1);
  });

  it('em outra visão, as ferramentas dos terminais saem do cabeçalho e voltam com Terminais', async () => {
    Object.assign(api, {
      worktrees: { list: vi.fn(() => Promise.resolve({ ok: true, data: [] })) },
    });
    Object.assign(api.missions, {
      subscribe: vi.fn(() => () => undefined),
      subscribeUsage: vi.fn(() => () => undefined),
    });
    renderAt();
    await screen.findByRole('button', { name: 'Iniciar Claude Code' });

    selectView('Worktrees');
    expect(screen.queryByRole('group', { name: 'Layout dos painéis' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Abrir terminal' })).not.toBeInTheDocument();

    selectView('Terminais');
    expect(screen.getByRole('group', { name: 'Layout dos painéis' })).toBeInTheDocument();
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

    it('a barra do workspace não tem faixa de arquivos, mesmo com um arquivo aberto', async () => {
      const terminal = await comTerminal();

      act(() => openFile('p1', 'src/a.ts'));
      await act(async () => {});

      expect(screen.queryByRole('tablist', { name: 'Arquivos abertos' })).not.toBeInTheDocument();
      // O workspace segue na tela: o mesmo nó, nada escondido e a barra com o "Abrir terminal".
      expect(screen.getByTestId('terminal-view', { exact: true })).toBe(terminal);
      expect(terminal.closest('[hidden]')).toBeNull();
      expect(screen.getByRole('button', { name: 'Abrir terminal' })).toBeVisible();
    });

    it('o arquivo aberto não ocupa a área central: o workspace não ganha painel de arquivo', async () => {
      await comTerminal();

      act(() => openFile('p1', 'src/a.ts'));
      await act(async () => {});

      expect(document.querySelector('.project-tab__file')).toBeNull();
      expect(screen.queryByRole('tabpanel', { name: 'a.ts' })).not.toBeInTheDocument();
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

describe('fechar todos os terminais', () => {
  const FAIXA = '.workspace__confirm';
  const faixa = () => document.querySelector(FAIXA);
  const vazio = () => ({ ...dto(padrao()), layout: null });

  /** `n` painéis de shell, `g1`..`gn`, arrumados como o servidor arruma; cada um com a sessão `t1`..`tn`. */
  function comSessoes(n: number, terminaisDe: (i: number) => TerminalSummary | null) {
    const layout = arrangeLeaves(
      Array.from({ length: n }, (_, i) =>
        leaf(`g${i + 1}`, 'shell', terminaisDe(i) === null ? null : `t${i + 1}`),
      ),
      () => crypto.randomUUID(),
    ) as LayoutNode;
    api.workspaces.open.mockResolvedValue({ ok: true, data: dto(layout) });
    api.terminals.list.mockResolvedValue({
      ok: true,
      data: Array.from({ length: n }, (_, i) => terminaisDe(i)).filter(
        (item): item is TerminalSummary => item !== null,
      ),
    });
  }
  const shell = (i: number, extra: Partial<TerminalSummary> = {}): TerminalSummary => ({
    ...shellTerminal,
    id: `t${i + 1}`,
    ...extra,
  });
  const regioes = () => screen.queryAllByRole('region', { name: /^Painel / });

  /** Deixa o workspace pronto (os painéis na tela) e faz o pedido de fechar todos, como o cabeçalho faz. */
  async function pedir(projectId = 'p1') {
    await screen.findByRole('button', { name: 'Abrir terminal' });
    await waitFor(() => expect(regioes().length).toBeGreaterThan(0));
    act(() => requestCloseAll(projectId));
  }

  it('publica quantos painéis o projeto tem, e 0 ao desmontar', async () => {
    comSessoes(3, (i) => shell(i));
    const contagem = renderHook(() => usePaneCount('p1'));
    const { unmount } = renderAt();
    await waitFor(() => expect(contagem.result.current).toBe(3));
    unmount();
    expect(contagem.result.current).toBe(0);
  });

  it('12 painéis com 11 sessões e uma missão: pergunta com os números, e "Voltar" nasce focado', async () => {
    comSessoes(12, (i) => (i === 11 ? shell(i, { missionId: 'm1' }) : shell(i)));
    renderAt();
    await pedir();

    expect(await screen.findByRole('group', { name: /Fechar os 12 painéis/ })).toHaveTextContent(
      'Fechar os 12 painéis? 11 sessões serão encerradas; as missões continuam.',
    );
    const faixaEl = faixa() as HTMLElement;
    expect(faixaEl).not.toBeNull();
    expect(within(faixaEl).getByRole('button', { name: 'Fechar todos' })).toBeInTheDocument();
    expect(within(faixaEl).getByRole('button', { name: 'Voltar' })).toHaveFocus();
  });

  it('um painel com uma sessão viva: frases no singular', async () => {
    comSessoes(1, (i) => shell(i));
    renderAt();
    await pedir();

    expect(await screen.findByRole('group', { name: /Fechar o painel/ })).toHaveTextContent(
      'Fechar o painel? 1 sessão será encerrada.',
    );
  });

  it('só missões: não fala de sessões', async () => {
    comSessoes(2, (i) => shell(i, { missionId: 'm1' }));
    renderAt();
    await pedir();

    expect(await screen.findByRole('group', { name: /Fechar os 2 painéis/ })).toHaveTextContent(
      'Fechar os 2 painéis? As missões continuam.',
    );
  });

  it('só shells sem sessão viva (sem terminal ou já encerrado): só a pergunta', async () => {
    comSessoes(3, (i) => (i === 0 ? shell(i, { state: 'exited' }) : null));
    renderAt();
    await pedir();

    const grupo = await screen.findByRole('group', { name: /Fechar os 3 painéis/ });
    expect(grupo).toHaveAccessibleName('Fechar os 3 painéis?');
  });

  it('"Voltar" fecha a faixa e limpa o pedido, sem fechar nada', async () => {
    comSessoes(2, (i) => shell(i));
    const pedido = renderHook(() => useCloseAllRequest('p1'));
    renderAt();
    await pedir();
    await screen.findByRole('group', { name: /Fechar os 2 painéis/ });

    await userEvent.click(screen.getByRole('button', { name: 'Voltar' }));

    expect(faixa()).toBeNull();
    expect(pedido.result.current).toBe(false);
    expect(api.workspaces.removePane).not.toHaveBeenCalled();
    expect(regioes()).toHaveLength(2);
  });

  it('Esc faz o mesmo que "Voltar"', async () => {
    comSessoes(2, (i) => shell(i));
    const pedido = renderHook(() => useCloseAllRequest('p1'));
    renderAt();
    await pedir();
    await screen.findByRole('group', { name: /Fechar os 2 painéis/ });

    await userEvent.keyboard('{Escape}');

    expect(faixa()).toBeNull();
    expect(pedido.result.current).toBe(false);
    expect(api.workspaces.removePane).not.toHaveBeenCalled();
    expect(regioes()).toHaveLength(2);
  });

  it('"Fechar todos" tira todos os painéis da tela na hora, fecha um a um, limpa o pedido e leva o foco a "Abrir terminal"', async () => {
    comSessoes(3, (i) => (i === 2 ? shell(i, { missionId: 'm1' }) : shell(i)));
    // O processo principal ainda não respondeu: o que sai da tela é só a tela.
    api.workspaces.removePane.mockReturnValue(new Promise(() => {}));
    const pedido = renderHook(() => useCloseAllRequest('p1'));
    const lateral = renderHook(() => useTerminals());
    renderAt();
    await pedir();
    await waitFor(() => expect(lateral.result.current.terminals).toHaveLength(3));
    await screen.findByRole('group', { name: /Fechar os 3 painéis/ });

    await userEvent.click(screen.getByRole('button', { name: 'Fechar todos' }));

    expect(regioes()).toHaveLength(0);
    expect(faixa()).toBeNull();
    expect(pedido.result.current).toBe(false);
    expect(api.workspaces.removePane.mock.calls).toEqual([
      ['w1', 'g1'],
      ['w1', 'g2'],
      ['w1', 'g3'],
    ]);
    // As sessões avulsas somem da barra lateral na hora; a de missão segue na lista.
    expect(lateral.result.current.terminals.map((item) => item.id)).toEqual(['t3']);
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Abrir terminal' })).toHaveFocus(),
    );
  });

  it('com 12 painéis, o foco chega a "Abrir terminal" quando o último sai', async () => {
    comSessoes(12, (i) => shell(i));
    api.workspaces.removePane.mockResolvedValue({ ok: true, data: vazio() });
    renderAt();
    await pedir();
    await screen.findByRole('group', { name: /Fechar os 12 painéis/ });

    await userEvent.click(screen.getByRole('button', { name: 'Fechar todos' }));

    await waitFor(() => expect(api.workspaces.removePane).toHaveBeenCalledTimes(12));
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Abrir terminal' })).toHaveFocus(),
    );
    expect(regioes()).toHaveLength(0);
  });

  it('um removePane que falha deixa só aquele painel de volta, com o erro; os outros saem', async () => {
    comSessoes(3, (i) => shell(i));
    api.workspaces.removePane.mockImplementation((_workspaceId: string, leafId: string) =>
      Promise.resolve(
        leafId === 'g2'
          ? { ok: false, error: { code: 'x', message: 'Não foi possível fechar o painel' } }
          : { ok: true, data: dto(leaf('g2', 'shell', 't2')) },
      ),
    );
    renderAt();
    await pedir();
    await screen.findByRole('group', { name: /Fechar os 3 painéis/ });

    await userEvent.click(screen.getByRole('button', { name: 'Fechar todos' }));

    const volta = await screen.findAllByRole('region', { name: 'Painel PowerShell' });
    expect(volta).toHaveLength(1);
    expect(await within(volta[0] as HTMLElement).findByRole('alert')).toHaveTextContent(
      'Não foi possível fechar o painel',
    );
    expect(api.workspaces.removePane).toHaveBeenCalledTimes(3);
  });

  it('a faixa aparece mesmo com a preferência "perguntar ao fechar" desligada', async () => {
    window.localStorage.setItem('project-hub:perguntar-ao-fechar-terminal', 'false');
    comSessoes(2, (i) => shell(i));
    renderAt();
    await pedir();

    expect(await screen.findByRole('group', { name: /Fechar os 2 painéis/ })).toBeInTheDocument();
    expect(api.workspaces.removePane).not.toHaveBeenCalled();
  });

  it('o pedido de outro projeto não abre a faixa deste', async () => {
    comSessoes(2, (i) => shell(i));
    renderAt();
    await pedir('p2');

    expect(faixa()).toBeNull();
    expect(screen.queryByRole('group', { name: /Fechar os/ })).not.toBeInTheDocument();
  });

  it('um pedido sem painéis é descartado, sem faixa', async () => {
    api.workspaces.open.mockResolvedValue({ ok: true, data: vazio() });
    const pedido = renderHook(() => useCloseAllRequest('p1'));
    renderAt();
    await screen.findByRole('button', { name: 'Abrir terminal' });
    act(() => requestCloseAll('p1'));

    await waitFor(() => expect(pedido.result.current).toBe(false));
    expect(faixa()).toBeNull();
  });

  it('sair do projeto com a faixa aberta descarta o pedido: ao voltar, não há faixa', async () => {
    comSessoes(2, (i) => shell(i));
    const pedido = renderHook(() => useCloseAllRequest('p1'));
    const primeira = renderAt();
    await pedir();
    await screen.findByRole('group', { name: /Fechar os 2 painéis/ });

    primeira.unmount();
    expect(pedido.result.current).toBe(false);

    renderAt();
    await screen.findByRole('button', { name: 'Abrir terminal' });
    await waitFor(() => expect(regioes().length).toBeGreaterThan(0));
    expect(faixa()).toBeNull();
    expect(screen.queryByRole('group', { name: /Fechar os/ })).not.toBeInTheDocument();
  });

  it('a faixa só aparece com a lista de terminais carregada, para não subestimar as sessões', async () => {
    comSessoes(2, (i) => shell(i));
    let responder: (valor: unknown) => void = () => {};
    api.terminals.list.mockReturnValue(new Promise((resolve) => (responder = resolve)));
    renderAt();
    await pedir();

    expect(faixa()).toBeNull();

    await act(async () => {
      responder({ ok: true, data: [shell(0), shell(1)] });
    });

    expect(await screen.findByRole('group', { name: /Fechar os 2 painéis/ })).toHaveTextContent(
      '2 sessões serão encerradas',
    );
  });

  it('a faixa flutua sobre a área da grade: abrir a pergunta não muda a área medida nem os painéis mostrados', async () => {
    // 12 painéis numa área com altura para uma linha: o limite em que perder altura perderia a linha.
    areaSize = { width: 1000, height: 270 };
    comSessoes(12, (i) => shell(i));
    renderAt();
    await screen.findByRole('button', { name: 'Abrir terminal' });
    await waitFor(() => expect(regioes().length).toBeGreaterThan(0));
    const area = document.querySelector('.workspace__area') as HTMLElement;
    const mostrados = regioes().length;
    expect(mostrados).toBeLessThan(12);

    act(() => requestCloseAll('p1'));
    const grupo = await screen.findByRole('group', { name: /Fechar os 12 painéis/ });

    // A faixa mora dentro da área (posicionada por cima, fora do fluxo), não ao lado dela: não tira altura da medida.
    expect(area.contains(grupo)).toBe(true);
    expect(document.querySelector('.workspace__area')).toBe(area);
    expect(regioes()).toHaveLength(mostrados);
  });

  describe('pelo cabeçalho', () => {
    /** Abre Mais ações pelo teclado (como em "aba do projeto: visões") e escolhe "Fechar todos os terminais…". */
    async function escolherFecharTodos() {
      act(() => screen.getByRole('button', { name: 'Mais ações' }).focus());
      await userEvent.keyboard('{Enter}');
      await screen.findByRole('menuitem', { name: 'Fechar todos os terminais…' });
      await userEvent.keyboard('{ArrowDown}{ArrowDown}{Enter}');
    }

    it('feito de outra visão, abre Terminais e a pergunta aparece uma vez só', async () => {
      comSessoes(2, (i) => shell(i));
      renderAt(undefined, 'p1', '?visao=missoes');
      // A contagem só chega depois de o workspace carregar.
      await waitFor(() => expect(document.querySelectorAll('.pane').length).toBeGreaterThan(0));

      await escolherFecharTodos();

      expect(screen.getByRole('tab', { name: 'Terminais' })).toHaveAttribute(
        'aria-selected',
        'true',
      );
      expect(await screen.findByRole('group', { name: /Fechar os 2 painéis/ })).toBeVisible();
      expect(screen.getByRole('button', { name: 'Voltar' })).toHaveFocus();

      await userEvent.click(screen.getByRole('button', { name: 'Voltar' }));
      act(() => screen.getByRole('tab', { name: 'Missões' }).focus());
      act(() => screen.getByRole('tab', { name: 'Terminais' }).focus());

      expect(faixa()).toBeNull();
      expect(api.workspaces.removePane).not.toHaveBeenCalled();
    });

    it('sem painéis, o item está desabilitado', async () => {
      api.workspaces.open.mockResolvedValue({ ok: true, data: vazio() });
      renderAt();
      await screen.findByRole('button', { name: 'Abrir terminal' });
      act(() => screen.getByRole('button', { name: 'Mais ações' }).focus());
      await userEvent.keyboard('{Enter}');

      expect(
        await screen.findByRole('menuitem', { name: 'Fechar todos os terminais…' }),
      ).toHaveAttribute('aria-disabled', 'true');
    });
  });
});

describe('dividir pelo cabeçalho do painel', () => {
  const painel = (nome: string) => screen.getByRole('region', { name: `Painel ${nome}` });
  // Pelo teclado: no jsdom a biblioteca das divisórias cancela o clique do mouse (ver `abrirMenuDoPainel`).
  const apertar = async (botao: HTMLElement) => {
    botao.focus();
    await userEvent.keyboard('{Enter}');
  };

  it('"Dividir abaixo" pede a divisão daquele painel, daquele lado, com o mesmo programa', async () => {
    api.workspaces.splitPane.mockReturnValue(new Promise(() => {}));
    renderAt();
    await screen.findByRole('button', { name: 'Iniciar Claude Code' });
    await apertar(within(painel('Claude Code')).getByRole('button', { name: 'Dividir abaixo' }));
    expect(api.workspaces.splitPane).toHaveBeenCalledWith(
      expect.any(String),
      'a',
      'bottom',
      'claude',
    );
    expect(api.workspaces.addPane).not.toHaveBeenCalled();
  });

  it('sem largura para mais uma coluna, "Dividir à direita" fica apagado e não pede nada; alargando, volta', async () => {
    renderAt();
    await screen.findByRole('button', { name: 'Iniciar Claude Code' });
    // 1000 px: duas colunas cabem (688), três não (1036).
    const direita = () =>
      within(painel('Claude Code')).getByRole('button', { name: 'Dividir à direita' });
    expect(direita()).toHaveAttribute('aria-disabled', 'true');
    await apertar(direita());
    expect(api.workspaces.splitPane).not.toHaveBeenCalled();
    medirArea(1200, 800);
    expect(direita()).toHaveAttribute('aria-disabled', 'false');
  });

  it('com um painel por vez na tela (Abas), os botões de dividir somem', async () => {
    renderAt();
    await screen.findByRole('button', { name: 'Iniciar Claude Code' });
    await userEvent.click(screen.getByRole('button', { name: 'Abas' }));
    expect(screen.queryByRole('button', { name: 'Dividir à direita' })).not.toBeInTheDocument();
  });
});

describe('alça de arrastar na grade', () => {
  it('com mais de um painel na grade cada um tem a alça; em Abas, ou com um painel só, não', async () => {
    renderAt();
    await screen.findByRole('button', { name: 'Iniciar Claude Code' });
    expect(document.querySelectorAll('.pane__grip')).toHaveLength(3);
    await userEvent.click(screen.getByRole('button', { name: 'Abas' }));
    expect(document.querySelectorAll('.pane__grip')).toHaveLength(0);
  });

  it('um painel só não tem para onde ir: sem alça', async () => {
    api.workspaces.open.mockResolvedValue({ ok: true, data: dto(leaf('a', 'claude')) });
    renderAt();
    await screen.findByRole('button', { name: 'Iniciar Claude Code' });
    expect(document.querySelector('.pane__grip')).toBeNull();
  });
});
