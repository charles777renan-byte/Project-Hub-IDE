import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ProjectHubApi } from '@project-hub/contracts';
import { App } from '../../src/renderer/App';

/** A aba fixa Início da barra superior. */
function homeTab(): HTMLElement {
  const header = document.querySelector<HTMLElement>('header.topbar');
  expect(header).not.toBeNull();
  return within(header as HTMLElement).getByRole('link', { name: 'Início' });
}

// O aplicativo usa HashRouter (o renderer roda de file:// em produção). Os testes usam
// MemoryRouter, que não depende do endereço da janela.
describe('App', () => {
  it('a lateral não tem navegação principal: Início é a aba fixa da barra superior', () => {
    render(
      <MemoryRouter>
        <App />
      </MemoryRouter>,
    );
    expect(screen.queryByRole('navigation', { name: 'Principal' })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Projetos' })).not.toBeInTheDocument();
    expect(homeTab()).toBeInTheDocument();
  });

  it('abre em Início e marca essa aba como a página atual', () => {
    render(
      <MemoryRouter>
        <App />
      </MemoryRouter>,
    );
    expect(screen.getByRole('heading', { level: 1, name: 'Início' })).toBeInTheDocument();
    expect(homeTab()).toHaveAttribute('aria-current', 'page');
  });

  it('a rota antiga /projects cai em Início', () => {
    render(
      <MemoryRouter initialEntries={['/projects']}>
        <App />
      </MemoryRouter>,
    );
    expect(screen.getByRole('heading', { level: 1, name: 'Início' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Projetos' })).not.toBeInTheDocument();
    expect(homeTab()).toHaveAttribute('aria-current', 'page');
  });

  it('deixa o conteúdo em main', () => {
    render(
      <MemoryRouter>
        <App />
      </MemoryRouter>,
    );
    expect(within(screen.getByRole('main')).getByRole('heading', { name: 'Início' })).toBeVisible();
  });

  it('chega aos controles com Tab, na ordem da tela, e aciona Adicionar projeto com Enter', async () => {
    const chooseDirectory = vi.fn(() => Promise.resolve({ ok: true, data: null }));
    window.projectHub = { projects: { chooseDirectory } } as unknown as ProjectHubApi;
    const user = userEvent.setup();
    try {
      render(
        <MemoryRouter>
          <App />
        </MemoryRouter>,
      );

      // A barra superior vem antes da lateral: primeiro o botão da barra lateral e o do painel direito, depois a
      // aba fixa Início e o botão de abrir workspace.
      await user.tab();
      expect(screen.getByRole('button', { name: 'Ocultar barra lateral' })).toHaveFocus();
      await user.tab();
      expect(screen.getByRole('button', { name: 'Ocultar painel direito' })).toHaveFocus();
      await user.tab();
      expect(homeTab()).toHaveFocus();
      await user.tab();
      expect(screen.getByRole('button', { name: 'Abrir workspace' })).toHaveFocus();
      await user.tab();
      expect(screen.getByRole('button', { name: /Buscar projeto ou agente/ })).toHaveFocus();
      await user.tab();
      expect(screen.getByRole('button', { name: 'Adicionar projeto' })).toHaveFocus();

      await user.keyboard('{Enter}');
      expect(chooseDirectory).toHaveBeenCalledTimes(1);
      // O foco continua no botão que a pessoa acionou.
      expect(screen.getByRole('button', { name: 'Adicionar projeto' })).toHaveFocus();
    } finally {
      Reflect.deleteProperty(window, 'projectHub');
    }
  });
});

// Barra superior (Tarefa 6 do plano do workspace multiagente): marca, abas dos workspaces, botão de
// abrir e o espaço à direita para os contadores.
describe('barra superior', () => {
  // Os painéis (<header> do Panel) também contam como banner no testing-library; a barra do app é achada pela classe.
  function topBar(): HTMLElement {
    const header = document.querySelector<HTMLElement>('header.topbar');
    expect(header).not.toBeNull();
    return header as HTMLElement;
  }

  beforeEach(() => {
    window.projectHub = {
      projects: {
        list: () => Promise.resolve({ ok: true, data: [] }),
        listArchived: () => Promise.resolve({ ok: true, data: [] }),
      },
      missions: {
        list: () => Promise.resolve({ ok: true, data: [] }),
        subscribe: () => () => undefined,
      },
      workspaces: {
        list: () => Promise.resolve({ ok: true, data: [] }),
      },
    } as unknown as ProjectHubApi;
  });

  afterEach(() => {
    Reflect.deleteProperty(window, 'projectHub');
  });

  it.each(['/', '/projects', '/projects/p1'])(
    'aparece com a marca e o botão de abrir workspace na rota %s',
    async (route) => {
      render(
        <MemoryRouter initialEntries={[route]}>
          <App />
        </MemoryRouter>,
      );
      const banner = topBar();
      expect(within(banner).getByText('Project Hub')).toBeInTheDocument();
      expect(
        await within(banner).findByRole('button', { name: 'Abrir workspace' }),
      ).toBeInTheDocument();
    },
  );

  it('a barra lateral não leva navegação principal, só a busca e o explorador de projetos', () => {
    render(
      <MemoryRouter>
        <App />
      </MemoryRouter>,
    );
    expect(screen.queryByRole('navigation', { name: 'Principal' })).not.toBeInTheDocument();
    const sidebar = screen.getByRole('complementary', { name: 'Projetos e missões' });
    expect(sidebar.closest('.app-side')).not.toBeNull();
    expect(topBar().contains(sidebar)).toBe(false);
  });

  it('a divisória da barra lateral tem nome', () => {
    render(
      <MemoryRouter>
        <App />
      </MemoryRouter>,
    );
    expect(
      screen.getByRole('separator', { name: 'Redimensionar barra lateral' }),
    ).toBeInTheDocument();
  });

  it('a divisória do painel direito tem nome', () => {
    render(
      <MemoryRouter>
        <App />
      </MemoryRouter>,
    );
    expect(
      screen.getByRole('separator', { name: 'Redimensionar painel direito' }),
    ).toBeInTheDocument();
  });

  it('o painel direito fica depois da página e mostra o aviso no Início', () => {
    render(
      <MemoryRouter>
        <App />
      </MemoryRouter>,
    );
    const panel = screen.getByRole('complementary', { name: 'Painel direito' });
    expect(screen.getByRole('main').compareDocumentPosition(panel)).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING,
    );
    expect(within(panel).getByText('Abra um projeto para ver os arquivos')).toBeInTheDocument();
  });

  it('o painel direito pega o projeto da aba ativa: na rota do projeto, não pede para abrir um', () => {
    render(
      <MemoryRouter initialEntries={['/workspaces/p1']}>
        <App />
      </MemoryRouter>,
    );
    const panel = screen.getByRole('complementary', { name: 'Painel direito' });
    expect(within(panel).queryByText('Abra um projeto para ver os arquivos')).toBeNull();
  });

  it('a marca tem o símbolo escondido dos leitores de tela', () => {
    render(
      <MemoryRouter>
        <App />
      </MemoryRouter>,
    );
    const mark = topBar().querySelector('.topbar__mark');
    expect(mark).not.toBeNull();
    expect(mark).toHaveAttribute('aria-hidden', 'true');
  });

  it('a aba Início é a primeira da barra e marca a rota raiz como a atual', () => {
    render(
      <MemoryRouter>
        <App />
      </MemoryRouter>,
    );
    const home = within(topBar()).getAllByRole('link')[0];
    expect(home).toHaveTextContent('Início');
    expect(home).toHaveAttribute('aria-current', 'page');
  });

  it('não leva mais os contadores, que foram para a barra de status', () => {
    render(
      <MemoryRouter>
        <App />
      </MemoryRouter>,
    );
    expect(topBar().querySelector('.topbar__status')).toBeNull();
    expect(within(topBar()).queryByText(/executando/)).toBeNull();
  });

  it('o fundo topográfico não cobre mais a janela: fica só no topo do Início', () => {
    render(
      <MemoryRouter initialEntries={['/']}>
        <App />
      </MemoryRouter>,
    );
    const background = document.querySelector('.topo-background');
    expect(background).not.toBeNull();
    expect(background?.parentElement).toHaveClass('home-hero');
    expect(document.querySelectorAll('.topo-background')).toHaveLength(1);
    // Nada de fundo atrás da barra lateral, da barra de status nem das listas do Início.
    expect(document.querySelector('.app-shell > .topo-background')).toBeNull();
    expect(document.querySelector('.home-columns .topo-background')).toBeNull();
  });

  it('a janela da aba do projeto não tem fundo topográfico por trás da casca', () => {
    render(
      <MemoryRouter initialEntries={['/workspaces/p1']}>
        <App />
      </MemoryRouter>,
    );
    expect(document.querySelector('.app-shell > .topo-background')).toBeNull();
    expect(document.querySelector('header.topbar')).not.toBeNull();
    expect(screen.getByRole('main')).toBeInTheDocument();
  });
});

// Paleta de comandos (Ctrl+K, components/PaletaComandos.tsx). O atalho fica no App, então vale em qualquer tela.
describe('paleta de comandos (Ctrl+K)', () => {
  it('Ctrl+K abre a paleta com o foco na busca', async () => {
    const user = userEvent.setup();
    render(
      <MemoryRouter>
        <App />
      </MemoryRouter>,
    );
    await user.keyboard('{Control>}k{/Control}');
    expect(screen.getByRole('combobox')).toHaveFocus();
  });

  it('com a paleta aberta, Ctrl+K não a fecha: quem fecha é o Escape', async () => {
    const user = userEvent.setup();
    render(
      <MemoryRouter>
        <App />
      </MemoryRouter>,
    );
    await user.keyboard('{Control>}k{/Control}');
    await user.keyboard('{Control>}k{/Control}');
    expect(screen.getByRole('combobox')).toBeInTheDocument();
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('combobox')).toBeNull();
  });

  it('escolher uma ação leva à tela e fecha a paleta', async () => {
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
    const user = userEvent.setup();
    try {
      // Sem o projeto p1, a rota do workspace mostra só o aviso e o link de volta ao Início.
      render(
        <MemoryRouter initialEntries={['/workspaces/p1']}>
          <App />
        </MemoryRouter>,
      );
      await screen.findByText('O projeto não foi encontrado.');
      await user.keyboard('{Control>}k{/Control}');
      await user.type(screen.getByRole('combobox'), 'Ir para Início{Enter}');
      expect(screen.getByRole('heading', { level: 1, name: 'Início' })).toBeInTheDocument();
      expect(screen.queryByRole('combobox')).toBeNull();
    } finally {
      Reflect.deleteProperty(window, 'projectHub');
    }
  });

  it('a ação Adicionar projeto abre o seletor de pasta e fecha a paleta', async () => {
    const chooseDirectory = vi.fn(() => Promise.resolve({ ok: true, data: null }));
    window.projectHub = { projects: { chooseDirectory } } as unknown as ProjectHubApi;
    const user = userEvent.setup();
    try {
      render(
        <MemoryRouter>
          <App />
        </MemoryRouter>,
      );
      await user.keyboard('{Control>}k{/Control}');
      await user.type(screen.getByRole('combobox'), 'Adicionar projeto{Enter}');
      expect(chooseDirectory).toHaveBeenCalledTimes(1);
      expect(screen.queryByRole('combobox')).toBeNull();
    } finally {
      Reflect.deleteProperty(window, 'projectHub');
    }
  });

  it('dentro do terminal, Ctrl+K segue para o programa e não abre a paleta', async () => {
    const user = userEvent.setup();
    render(
      <MemoryRouter>
        <App />
        <div className="terminal-view">
          <input aria-label="Terminal de teste" />
        </div>
      </MemoryRouter>,
    );
    await user.click(screen.getByRole('textbox', { name: 'Terminal de teste' }));
    await user.keyboard('{Control>}k{/Control}');
    expect(screen.queryByRole('combobox')).toBeNull();
  });
  it('o botão Buscar projeto ou agente da lateral abre a paleta de comandos', async () => {
    const user = userEvent.setup();
    render(
      <MemoryRouter>
        <App />
      </MemoryRouter>,
    );
    await user.click(screen.getByRole('button', { name: /Buscar projeto ou agente/ }));
    expect(screen.getByRole('dialog', { name: 'Paleta de comandos' })).toBeVisible();
    expect(screen.getByRole('combobox')).toHaveFocus();
  });
});

// Barra de status: o rodapé da janela aparece em todas as rotas, abaixo do corpo, com os contadores.
describe('barra de status', () => {
  beforeEach(() => {
    window.projectHub = {
      projects: {
        list: () => Promise.resolve({ ok: true, data: [] }),
        listArchived: () => Promise.resolve({ ok: true, data: [] }),
      },
      missions: {
        list: () => Promise.resolve({ ok: true, data: [] }),
        subscribe: () => () => undefined,
      },
      workspaces: {
        list: () => Promise.resolve({ ok: true, data: [] }),
      },
    } as unknown as ProjectHubApi;
  });

  afterEach(() => {
    Reflect.deleteProperty(window, 'projectHub');
  });

  it.each(['/', '/projects', '/projects/p1', '/workspaces/p1'])(
    'existe na rota %s, com os contadores como links, e vem depois do corpo da janela',
    async (route) => {
      render(
        <MemoryRouter initialEntries={[route]}>
          <App />
        </MemoryRouter>,
      );
      const footer = screen.getByRole('contentinfo', { name: 'Barra de status' });
      expect(await within(footer).findByRole('link', { name: '0 executando' })).toHaveAttribute(
        'href',
        '/?estado=running',
      );
      expect(within(footer).getAllByRole('link')).toHaveLength(3);
      const shell = footer.parentElement as HTMLElement;
      expect(shell).toHaveClass('app-shell');
      expect(document.querySelector('.app-body')?.compareDocumentPosition(footer)).toBe(
        Node.DOCUMENT_POSITION_FOLLOWING,
      );
    },
  );
});
