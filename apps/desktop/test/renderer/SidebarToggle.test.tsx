import { act, fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ProjectHubApi } from '@project-hub/contracts';
import { App } from '../../src/renderer/App';
import { buildPaletteItems } from '../../src/renderer/palette-items';
import { TOGGLE_SIDEBAR_EVENT } from '../../src/renderer/sidebar-events';

// Voltar à barra lateral recolhida: o botão da barra superior, o Ctrl+B e a paleta mostram e escondem a lateral, e
// uma largura 0 guardada abre recolhida, mas com o botão para voltar. O jsdom não mede nada (o painel real reporta
// sempre 50%), então a biblioteca de painéis é simulada: o painel da lateral guarda se está recolhido, expõe o
// `collapse`/`expand`/`isCollapsed` do `panelRef`, avisa o `onResize` com o tamanho e o grupo avisa o
// `onLayoutChanged`, como a biblioteca faz. O comportamento do arrasto fica para a conferência na janela real.
const STORAGE_KEY = 'project-hub:sidebar-layout';

vi.mock('react-resizable-panels', async () => {
  const React = await import('react');
  type Handle = { collapse: () => void; expand: () => void; isCollapsed: () => boolean };
  const GroupContext = React.createContext<{
    layout: Record<string, number>;
    changed: (layout: Record<string, number>) => void;
  }>({ layout: {}, changed: () => undefined });
  return {
    usePanelRef: () => React.useRef<Handle | null>(null),
    Group: (props: {
      className?: string;
      defaultLayout?: Record<string, number>;
      onLayoutChanged?: (layout: Record<string, number>) => void;
      children: React.ReactNode;
    }) => (
      <GroupContext.Provider
        value={{
          layout: props.defaultLayout ?? {},
          changed: props.onLayoutChanged ?? (() => undefined),
        }}
      >
        <div className={props.className}>{props.children}</div>
      </GroupContext.Provider>
    ),
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
      const resize = React.useCallback(
        (next: number) => {
          sizeRef.current = next;
          setSize(next);
          props.onResize?.({ asPercentage: next, inPixels: next * 10 });
          group.changed({ side: next, main: 100 - next });
        },
        [props, group],
      );
      React.useEffect(() => {
        if (props.panelRef === undefined) return;
        props.panelRef.current = {
          collapse: () => resize(0),
          expand: () => resize(22),
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

function savedSide(): number | undefined {
  const raw = window.localStorage.getItem(STORAGE_KEY);
  return raw === null ? undefined : (JSON.parse(raw) as { side?: number }).side;
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
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ side: 0, main: 100 }));
    renderApp();

    expect(within(topBar()).getByRole('button', { name: 'Mostrar barra lateral' })).toHaveAttribute(
      'aria-expanded',
      'false',
    );
    expect(document.querySelector('.app-body--side-collapsed')).not.toBeNull();
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
