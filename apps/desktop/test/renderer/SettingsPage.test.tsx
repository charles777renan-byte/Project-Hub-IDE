import { act, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, useLocation } from 'react-router';
import { afterEach, describe, expect, it } from 'vitest';
import { App } from '../../src/renderer/App';
import { SidebarRail } from '../../src/renderer/components/SidebarRail';
import { AppRoutes, ROUTE_PATHS, SETTINGS_SECTIONS, settingsPath } from '../../src/renderer/routes';

// A área de Configurações: a rota, as seções e os acessos a ela (engrenagem, aba, atalho). O conteúdo das seções
// tem os testes dele (GeneralSection, AccountsSection).

function Where() {
  return <p data-testid="where">{useLocation().pathname}</p>;
}

function renderRoutes(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <AppRoutes />
      <Where />
    </MemoryRouter>,
  );
}

function renderApp(path = '/') {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <App />
      <Where />
    </MemoryRouter>,
  );
}

const where = () => screen.getByTestId('where').textContent;
const topbar = () => document.querySelector<HTMLElement>('header.topbar') as HTMLElement;

afterEach(() => {
  Reflect.deleteProperty(window, 'projectHub');
  window.localStorage.clear();
});

describe('rota das configurações', () => {
  it('os endereços das seções', () => {
    expect(ROUTE_PATHS.settings).toBe('/settings/*');
    expect(SETTINGS_SECTIONS).toEqual(['contas', 'agentes', 'geral']);
    expect(settingsPath()).toBe('/settings/contas');
    expect(settingsPath('geral')).toBe('/settings/geral');
  });

  it('a rota /settings abre na seção Contas', () => {
    renderRoutes('/settings');
    expect(where()).toBe('/settings/contas');
    expect(screen.getByRole('heading', { level: 1, name: 'Configurações' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 2, name: 'Contas' })).toBeInTheDocument();
  });

  it('seção desconhecida cai em Contas', () => {
    renderRoutes('/settings/outra');
    expect(where()).toBe('/settings/contas');
  });

  it('a navegação marca a seção atual e troca de seção', async () => {
    renderRoutes('/settings/contas');
    const nav = screen.getByRole('navigation', { name: 'Seções das configurações' });
    expect(within(nav).getByRole('link', { name: 'Contas' })).toHaveAttribute(
      'aria-current',
      'page',
    );
    expect(within(nav).getByRole('link', { name: 'Geral' })).not.toHaveAttribute('aria-current');

    await userEvent.click(within(nav).getByRole('link', { name: 'Geral' }));

    expect(where()).toBe('/settings/geral');
    expect(within(nav).getByRole('link', { name: 'Geral' })).toHaveAttribute(
      'aria-current',
      'page',
    );
    expect(screen.getByRole('heading', { level: 2, name: 'Geral' })).toBeInTheDocument();
  });
});

describe('seção Agentes', () => {
  it('fica entre Contas e Geral na navegação e abre pela rota', async () => {
    renderRoutes('/settings/contas');
    const nav = screen.getByRole('navigation', { name: 'Seções das configurações' });
    expect(
      within(nav)
        .getAllByRole('link')
        .map((link) => link.textContent),
    ).toEqual(['Contas', 'Agentes', 'Geral']);

    await userEvent.click(within(nav).getByRole('link', { name: 'Agentes' }));

    expect(where()).toBe('/settings/agentes');
    expect(screen.getByRole('heading', { level: 2, name: 'Agentes' })).toBeInTheDocument();
  });
});

describe('aba Configurações na barra de cima', () => {
  it('não aparece fora das configurações', () => {
    renderApp('/');
    expect(within(topbar()).queryByRole('link', { name: 'Configurações' })).toBeNull();
  });

  it('aparece na rota de configurações, marcada como a página atual', () => {
    renderApp('/settings/geral');
    expect(within(topbar()).getByRole('link', { name: 'Configurações' })).toHaveAttribute(
      'aria-current',
      'page',
    );
    expect(within(topbar()).getByRole('link', { name: 'Início' })).not.toHaveAttribute(
      'aria-current',
    );
  });

  it('fechar volta para a página de onde a pessoa veio', async () => {
    renderApp('/');
    await userEvent.click(screen.getByRole('link', { name: 'Configurações' }));
    expect(where()).toBe('/settings/contas');

    await userEvent.click(within(topbar()).getByRole('button', { name: 'Fechar Configurações' }));

    expect(where()).toBe('/');
    expect(within(topbar()).queryByRole('link', { name: 'Configurações' })).toBeNull();
  });

  it('aberta direto nas configurações, fechar leva ao Início', async () => {
    renderApp('/settings/contas');
    await userEvent.click(within(topbar()).getByRole('button', { name: 'Fechar Configurações' }));
    expect(where()).toBe('/');
  });
});

describe('engrenagem', () => {
  it('o pé da lateral tem o link Configurações, marcado quando a área está aberta', async () => {
    renderApp('/');
    const sidebar = screen.getByRole('complementary', { name: 'Projetos e missões' });
    const link = within(sidebar).getByRole('link', { name: 'Configurações' });
    expect(link).not.toHaveAttribute('aria-current');

    await userEvent.click(link);

    expect(where()).toBe('/settings/contas');
    expect(within(sidebar).getByRole('link', { name: 'Configurações' })).toHaveAttribute(
      'aria-current',
      'page',
    );
  });

  it('o trilho tem o link Configurações', async () => {
    render(
      <MemoryRouter>
        <SidebarRail onExpand={() => undefined} />
        <Where />
      </MemoryRouter>,
    );
    await userEvent.click(screen.getByRole('link', { name: 'Configurações' }));
    expect(where()).toBe('/settings');
  });
});

describe('atalho Ctrl+vírgula', () => {
  const press = (target: EventTarget, init: KeyboardEventInit = { ctrlKey: true }) =>
    act(() => {
      target.dispatchEvent(
        new KeyboardEvent('keydown', { key: ',', bubbles: true, cancelable: true, ...init }),
      );
    });

  it('abre as configurações', () => {
    renderApp('/');
    press(document.body);
    expect(where()).toBe('/settings/contas');
  });

  it('vale com Cmd no lugar de Ctrl', () => {
    renderApp('/');
    press(document.body, { metaKey: true });
    expect(where()).toBe('/settings/contas');
  });

  it('não dispara dentro de um campo de texto', () => {
    renderApp('/');
    const input = document.createElement('input');
    document.body.append(input);
    press(input);
    expect(where()).toBe('/');
    input.remove();
  });

  it('não dispara dentro do terminal', () => {
    renderApp('/');
    const terminal = document.createElement('div');
    terminal.className = 'terminal-view';
    document.body.append(terminal);
    press(terminal);
    expect(where()).toBe('/');
    terminal.remove();
  });

  it('sem Ctrl a vírgula não faz nada', () => {
    renderApp('/');
    press(document.body, {});
    expect(where()).toBe('/');
  });
});
