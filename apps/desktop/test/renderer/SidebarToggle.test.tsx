import { act, fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ProjectHubApi } from '@project-hub/contracts';
import { App } from '../../src/renderer/App';
import { buildPaletteItems } from '../../src/renderer/palette-items';
import { TOGGLE_RIGHT_PANEL_EVENT } from '../../src/renderer/right-panel-events';
import { TOGGLE_SIDEBAR_EVENT } from '../../src/renderer/sidebar-events';

// Voltar à barra lateral recolhida: o botão da barra superior, o Ctrl+B e a paleta mostram e escondem a lateral, e
// uma largura 0 guardada abre recolhida, mas com o botão para voltar. O painel direito segue o mesmo caminho (botão,
// Ctrl+Alt+B e paleta). O jsdom não mede nada (o painel real reporta sempre 50%), então a biblioteca de painéis é
// simulada: cada painel guarda se está recolhido, expõe o `collapse`/`expand`/`isCollapsed` do `panelRef`, avisa o
// `onResize` com o tamanho e o grupo avisa o `onLayoutChanged` com o layout inteiro, como a biblioteca faz. O
// comportamento do arrasto fica para a conferência na janela real.
const STORAGE_KEY = 'project-hub:app-layout';
const OLD_STORAGE_KEY = 'project-hub:sidebar-layout';

vi.mock('react-resizable-panels', async () => {
  const React = await import('react');
  type Handle = { collapse: () => void; expand: () => void; isCollapsed: () => boolean };
  type Layout = Record<string, number>;
  const GroupContext = React.createContext<{
    layout: Layout;
    changed: (layout: Layout) => void;
  }>({ layout: {}, changed: () => undefined });
  return {
    usePanelRef: () => React.useRef<Handle | null>(null),
    Group: (props: {
      className?: string;
      defaultLayout?: Layout;
      onLayoutChanged?: (layout: Layout) => void;
      children: React.ReactNode;
    }) => {
      // O layout é do grupo e vale para todos os painéis: cada resize muda o painel e devolve o layout inteiro.
      const layout = React.useRef<Layout>({ ...props.defaultLayout });
      return (
        <GroupContext.Provider
          value={{
            layout: layout.current,
            changed: props.onLayoutChanged ?? (() => undefined),
          }}
        >
          <div className={props.className}>{props.children}</div>
        </GroupContext.Provider>
      );
    },
    Separator: (props: { className?: string; 'aria-label'?: string }) => (
      <div role="separator" aria-orientation="vertical" {...props} />
    ),
    Panel: (props: {
      id: string;
      className?: string;
      panelRef?: { current: Handle | null };
      onResize?: (size: { asPercentage: number; inPixels: number }) => void;
      children: React.ReactNode;
    }) => {
      const group = React.useContext(GroupContext);
      const [size, setSize] = React.useState(group.layout[props.id] ?? 20);
      const sizeRef = React.useRef(size);
      // Largura de volta ao expandir: a padrão de cada painel recolhível.
      const expanded = props.id === 'right' ? 24 : 22;
      const resize = React.useCallback(
        (next: number) => {
          sizeRef.current = next;
          setSize(next);
          props.onResize?.({ asPercentage: next, inPixels: next * 10 });
          group.layout[props.id] = next;
          group.layout.main = 100 - (group.layout.side ?? 0) - (group.layout.right ?? 0);
          group.changed({ ...group.layout });
        },
        [props, group],
      );
      React.useEffect(() => {
        if (props.panelRef === undefined) return;
        props.panelRef.current = {
          collapse: () => resize(0),
          expand: () => resize(expanded),
          isCollapsed: () => sizeRef.current === 0,
        };
        props.onResize?.({ asPercentage: sizeRef.current, inPixels: sizeRef.current * 10 });
        // Só na montagem: o painel real avisa o tamanho inicial uma vez.
      }, []);
      return (
        <div className={props.className} data-size={size}>
          {props.children}
        </div>
      );
    },
  };
});

beforeEach(() => {
  window.localStorage.clear();
  window.projectHub = {
    projects: {
      list: () => Promise.resolve({ ok: true, data: [] }),
      listArchived: () => Promise.resolve({ ok: true, data: [] }),
    },
    missions: {
      list: () => Promise.resolve({ ok: true, data: [] }),
      subscribe: () => () => undefined,
    },
    workspaces: { list: () => Promise.resolve({ ok: true, data: [] }) },
  } as unknown as ProjectHubApi;
});

afterEach(() => {
  Reflect.deleteProperty(window, 'projectHub');
  vi.restoreAllMocks();
});

function renderApp() {
  return render(
    <MemoryRouter>
      <App />
    </MemoryRouter>,
  );
}

function topBar(): HTMLElement {
  const header = document.querySelector<HTMLElement>('header.topbar');
  expect(header).not.toBeNull();
  return header as HTMLElement;
}

function savedLayout(): { side?: number; right?: number } | undefined {
  const raw = window.localStorage.getItem(STORAGE_KEY);
  return raw === null ? undefined : (JSON.parse(raw) as { side?: number; right?: number });
}

function savedSide(): number | undefined {
  return savedLayout()?.side;
}

function savedRight(): number | undefined {
  return savedLayout()?.right;
}

function rightToggle(name: 'Mostrar painel direito' | 'Ocultar painel direito'): HTMLElement {
  return within(topBar()).getByRole('button', { name });
}

function rightPanel(): HTMLElement {
  const panel = document.querySelector<HTMLElement>('.app-right');
  expect(panel).not.toBeNull();
  return panel as HTMLElement;
}

describe('barra lateral: esconder e mostrar', () => {
  it('a barra superior tem o botão Ocultar barra lateral, expandido, com a lateral à vista', () => {
    renderApp();

    const button = within(topBar()).getByRole('button', { name: 'Ocultar barra lateral' });
    expect(button).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByRole('complementary', { name: 'Projetos e missões' })).toBeVisible();
  });

  it('o botão esconde a lateral e vira Mostrar barra lateral; clicar de novo a devolve', async () => {
    const user = userEvent.setup();
    renderApp();

    await user.click(within(topBar()).getByRole('button', { name: 'Ocultar barra lateral' }));
    const show = within(topBar()).getByRole('button', { name: 'Mostrar barra lateral' });
    expect(show).toHaveAttribute('aria-expanded', 'false');
    expect(savedSide()).toBe(0);
    expect(document.querySelector('.app-body--side-collapsed')).not.toBeNull();

    await user.click(show);
    expect(within(topBar()).getByRole('button', { name: 'Ocultar barra lateral' })).toHaveAttribute(
      'aria-expanded',
      'true',
    );
    expect(savedSide()).toBeGreaterThan(0);
    expect(document.querySelector('.app-body--side-collapsed')).toBeNull();
  });

  it('uma largura 0 guardada abre recolhida, com o botão para voltar', () => {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ side: 0, right: 24 }));
    renderApp();

    expect(within(topBar()).getByRole('button', { name: 'Mostrar barra lateral' })).toHaveAttribute(
      'aria-expanded',
      'false',
    );
    expect(document.querySelector('.app-body--side-collapsed')).not.toBeNull();
  });

  it('a largura guardada na chave antiga ainda é lida, com o painel direito na largura padrão', () => {
    window.localStorage.setItem(OLD_STORAGE_KEY, JSON.stringify({ side: 0, main: 100 }));
    renderApp();

    expect(within(topBar()).getByRole('button', { name: 'Mostrar barra lateral' })).toHaveAttribute(
      'aria-expanded',
      'false',
    );
    expect(rightToggle('Ocultar painel direito')).toHaveAttribute('aria-expanded', 'true');
    expect(document.querySelector('.app-body--side-collapsed')).not.toBeNull();
    expect(document.querySelector('.app-body--right-collapsed')).toBeNull();
  });

  it('a chave nova vale mais que a antiga quando as duas existem', () => {
    window.localStorage.setItem(OLD_STORAGE_KEY, JSON.stringify({ side: 0, main: 100 }));
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ side: 30, right: 0 }));
    renderApp();

    expect(within(topBar()).getByRole('button', { name: 'Ocultar barra lateral' })).toHaveAttribute(
      'aria-expanded',
      'true',
    );
    expect(rightToggle('Mostrar painel direito')).toHaveAttribute('aria-expanded', 'false');
  });

  it.each([
    ['texto que não é JSON', 'isto não é JSON'],
    ['larguras fora dos limites', JSON.stringify({ side: 90, right: 90 })],
    ['larguras que não deixam 30% para a página', JSON.stringify({ side: 40, right: 45 })],
    ['larguras que não são números', JSON.stringify({ side: '22', right: null })],
  ])('um layout guardado com %s volta às larguras padrão', (_name, raw) => {
    window.localStorage.setItem(STORAGE_KEY, raw);
    renderApp();

    expect(within(topBar()).getByRole('button', { name: 'Ocultar barra lateral' })).toBeVisible();
    expect(rightToggle('Ocultar painel direito')).toBeVisible();
  });

  it('Ctrl+B alterna a lateral', async () => {
    const user = userEvent.setup();
    renderApp();

    await user.keyboard('{Control>}b{/Control}');
    expect(
      within(topBar()).getByRole('button', { name: 'Mostrar barra lateral' }),
    ).toBeInTheDocument();

    await user.keyboard('{Control>}b{/Control}');
    expect(
      within(topBar()).getByRole('button', { name: 'Ocultar barra lateral' }),
    ).toBeInTheDocument();
  });

  it('dentro do terminal, Ctrl+B segue para o programa e não mexe na lateral', () => {
    renderApp();
    const terminal = document.createElement('div');
    terminal.className = 'terminal-view';
    terminal.tabIndex = 0;
    document.body.append(terminal);

    fireEvent.keyDown(terminal, { key: 'b', ctrlKey: true });

    expect(
      within(topBar()).getByRole('button', { name: 'Ocultar barra lateral' }),
    ).toBeInTheDocument();
    terminal.remove();
  });

  it('o evento de alternar (usado pela paleta) esconde a lateral', () => {
    renderApp();

    act(() => {
      window.dispatchEvent(new Event(TOGGLE_SIDEBAR_EVENT));
    });

    expect(
      within(topBar()).getByRole('button', { name: 'Mostrar barra lateral' }),
    ).toBeInTheDocument();
  });
});

describe('paleta: Mostrar ou ocultar a barra lateral', () => {
  it('a ação existe no grupo Ações e dispara o evento de alternar', () => {
    const items = buildPaletteItems(
      { status: 'ready', projects: [], missionsByProject: {} } as never,
      vi.fn(),
    );
    const item = items.find((entry) => entry.id === 'acao:alternar-lateral');
    expect(item).toBeDefined();
    expect(item?.rotulo).toBe('Mostrar ou ocultar a barra lateral');
    expect(item?.grupo).toBe('Ações');
    const listener = vi.fn();
    window.addEventListener(TOGGLE_SIDEBAR_EVENT, listener);

    item?.executar();

    expect(listener).toHaveBeenCalledTimes(1);
    window.removeEventListener(TOGGLE_SIDEBAR_EVENT, listener);
  });
});

describe('painel direito: esconder e mostrar', () => {
  it('a barra superior tem o botão Ocultar painel direito, expandido, com o painel à vista', () => {
    renderApp();

    expect(rightToggle('Ocultar painel direito')).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByRole('complementary', { name: 'Painel direito' })).toBeVisible();
    expect(rightPanel()).not.toHaveAttribute('inert');
    expect(
      screen.getByRole('separator', { name: 'Redimensionar painel direito' }),
    ).toBeInTheDocument();
  });

  it('o botão fica no canto da barra, depois do botão de abrir workspace; o da lateral segue antes do nome do aplicativo', () => {
    renderApp();

    const left = within(topBar()).getByRole('button', { name: 'Ocultar barra lateral' });
    const right = rightToggle('Ocultar painel direito');
    const add = within(topBar()).getByRole('button', { name: 'Abrir workspace' });
    expect(left.compareDocumentPosition(screen.getByText('Project Hub'))).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING,
    );
    expect(add.compareDocumentPosition(right)).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
  });

  it('o botão esconde o painel, que fica inert, e vira Mostrar painel direito; clicar de novo o devolve', async () => {
    const user = userEvent.setup();
    renderApp();

    await user.click(rightToggle('Ocultar painel direito'));
    const show = rightToggle('Mostrar painel direito');
    expect(show).toHaveAttribute('aria-expanded', 'false');
    expect(show).toHaveFocus();
    expect(savedRight()).toBe(0);
    expect(rightPanel()).toHaveAttribute('inert');
    expect(document.querySelector('.app-body--right-collapsed')).not.toBeNull();

    await user.click(show);
    expect(rightToggle('Ocultar painel direito')).toHaveAttribute('aria-expanded', 'true');
    expect(rightToggle('Ocultar painel direito')).toHaveFocus();
    expect(savedRight()).toBeGreaterThan(0);
    expect(rightPanel()).not.toHaveAttribute('inert');
    expect(document.querySelector('.app-body--right-collapsed')).toBeNull();
  });

  it('esconder o painel não mexe na largura guardada da lateral, e esconder a lateral não mexe na do painel', async () => {
    const user = userEvent.setup();
    renderApp();

    await user.click(rightToggle('Ocultar painel direito'));
    expect(savedSide()).toBe(22);
    expect(savedRight()).toBe(0);

    await user.click(within(topBar()).getByRole('button', { name: 'Ocultar barra lateral' }));
    expect(savedSide()).toBe(0);
    expect(savedRight()).toBe(0);

    await user.click(rightToggle('Mostrar painel direito'));
    expect(savedSide()).toBe(0);
    expect(savedRight()).toBe(24);
  });

  it('recolher com o foco dentro do painel leva o foco ao botão da barra superior', async () => {
    const user = userEvent.setup();
    renderApp();
    await user.click(within(rightPanel()).getByRole('tab', { name: 'Arquivos' }));
    expect(rightPanel().contains(document.activeElement)).toBe(true);

    await user.keyboard('{Control>}{Alt>}b{/Alt}{/Control}');

    expect(rightToggle('Mostrar painel direito')).toHaveFocus();
    expect(rightPanel()).toHaveAttribute('inert');
  });

  it('uma largura 0 guardada abre recolhida, com o botão para voltar', () => {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ side: 22, right: 0 }));
    renderApp();

    expect(rightToggle('Mostrar painel direito')).toHaveAttribute('aria-expanded', 'false');
    expect(rightPanel()).toHaveAttribute('inert');
    expect(document.querySelector('.app-body--right-collapsed')).not.toBeNull();
  });

  it('Ctrl+Alt+B alterna o painel direito e não mexe na lateral', async () => {
    const user = userEvent.setup();
    renderApp();

    await user.keyboard('{Control>}{Alt>}b{/Alt}{/Control}');
    expect(rightToggle('Mostrar painel direito')).toBeInTheDocument();
    expect(
      within(topBar()).getByRole('button', { name: 'Ocultar barra lateral' }),
    ).toBeInTheDocument();

    await user.keyboard('{Control>}{Alt>}b{/Alt}{/Control}');
    expect(rightToggle('Ocultar painel direito')).toBeInTheDocument();
  });

  it('Ctrl+B sozinho não mexe no painel direito', async () => {
    const user = userEvent.setup();
    renderApp();

    await user.keyboard('{Control>}b{/Control}');

    expect(rightToggle('Ocultar painel direito')).toBeInTheDocument();
    expect(
      within(topBar()).getByRole('button', { name: 'Mostrar barra lateral' }),
    ).toBeInTheDocument();
  });

  it('dentro do terminal, Ctrl+Alt+B segue para o programa e não mexe no painel', () => {
    renderApp();
    const terminal = document.createElement('div');
    terminal.className = 'terminal-view';
    terminal.tabIndex = 0;
    document.body.append(terminal);

    fireEvent.keyDown(terminal, { key: 'b', ctrlKey: true, altKey: true });

    expect(rightToggle('Ocultar painel direito')).toBeInTheDocument();
    terminal.remove();
  });

  it('o evento de alternar (usado pela paleta) esconde o painel direito', () => {
    renderApp();

    act(() => {
      window.dispatchEvent(new Event(TOGGLE_RIGHT_PANEL_EVENT));
    });

    expect(rightToggle('Mostrar painel direito')).toBeInTheDocument();
  });

  it('sem projeto na rota, o painel pede para abrir um projeto', () => {
    renderApp();

    expect(
      within(rightPanel()).getByText('Abra um projeto para ver os arquivos'),
    ).toBeInTheDocument();
  });
});

describe('paleta: Mostrar/Esconder painel direito', () => {
  it('a ação existe no grupo Ações, com o atalho, e dispara o evento de alternar', () => {
    const items = buildPaletteItems(
      { status: 'ready', projects: [], missionsByProject: {} } as never,
      vi.fn(),
    );
    const item = items.find((entry) => entry.id === 'acao:alternar-painel-direito');
    expect(item).toBeDefined();
    expect(item?.rotulo).toBe('Mostrar/Esconder painel direito');
    expect(item?.grupo).toBe('Ações');
    expect(item?.atalho).toBe('Ctrl Alt B');
    const listener = vi.fn();
    window.addEventListener(TOGGLE_RIGHT_PANEL_EVENT, listener);

    item?.executar();

    expect(listener).toHaveBeenCalledTimes(1);
    window.removeEventListener(TOGGLE_RIGHT_PANEL_EVENT, listener);
  });
});
