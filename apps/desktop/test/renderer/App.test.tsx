import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { ProjectHubApi } from '@project-hub/contracts';
import { App } from '../../src/renderer/App';

// O aplicativo usa HashRouter (o renderer roda de file:// em produção). Os testes usam
// MemoryRouter, que não depende do endereço da janela.
describe('App', () => {
  it('mostra navegação com Início e Projetos', () => {
    render(
      <MemoryRouter>
        <App />
      </MemoryRouter>,
    );
    expect(screen.getByRole('link', { name: 'Início' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Projetos' })).toBeInTheDocument();
  });

  it('abre a página de Projetos ao clicar', async () => {
    render(
      <MemoryRouter>
        <App />
      </MemoryRouter>,
    );
    await userEvent.click(screen.getByRole('link', { name: 'Projetos' }));
    expect(screen.getByRole('heading', { name: 'Projetos' })).toBeInTheDocument();
  });

  it('abre em Início e marca esse link como a página atual', () => {
    render(
      <MemoryRouter>
        <App />
      </MemoryRouter>,
    );
    expect(screen.getByRole('heading', { level: 1, name: 'Início' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Início' })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('link', { name: 'Projetos' })).not.toHaveAttribute('aria-current');
  });

  it('passa a marcar Projetos como a página atual depois do clique', async () => {
    render(
      <MemoryRouter>
        <App />
      </MemoryRouter>,
    );
    await userEvent.click(screen.getByRole('link', { name: 'Projetos' }));
    expect(screen.getByRole('link', { name: 'Projetos' })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('link', { name: 'Início' })).not.toHaveAttribute('aria-current');
    expect(screen.queryByRole('heading', { name: 'Início' })).not.toBeInTheDocument();
  });

  it('abre direto em Projetos quando a rota é /projects', () => {
    render(
      <MemoryRouter initialEntries={['/projects']}>
        <App />
      </MemoryRouter>,
    );
    expect(screen.getByRole('heading', { level: 1, name: 'Projetos' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Projetos' })).toHaveAttribute('aria-current', 'page');
  });

  it('agrupa os links numa navegação com nome e deixa o conteúdo em main', () => {
    render(
      <MemoryRouter>
        <App />
      </MemoryRouter>,
    );
    const navigation = screen.getByRole('navigation', { name: 'Principal' });
    expect(within(navigation).getAllByRole('link')).toHaveLength(2);
    expect(within(screen.getByRole('main')).getByRole('heading', { name: 'Início' })).toBeVisible();
  });

  it('chega aos controles com Tab, na ordem da tela, e abre a página com Enter', async () => {
    const user = userEvent.setup();
    render(
      <MemoryRouter>
        <App />
      </MemoryRouter>,
    );

    // A barra superior vem antes da navegação.
    await user.tab();
    expect(screen.getByRole('button', { name: 'Abrir workspace' })).toHaveFocus();
    await user.tab();
    expect(screen.getByRole('link', { name: 'Início' })).toHaveFocus();
    await user.tab();
    expect(screen.getByRole('link', { name: 'Projetos' })).toHaveFocus();

    await user.keyboard('{Enter}');
    expect(screen.getByRole('heading', { name: 'Projetos' })).toBeInTheDocument();
    // O foco continua no link que a pessoa acionou.
    expect(screen.getByRole('link', { name: 'Projetos' })).toHaveFocus();
  });
});

// Barra superior (Tarefa 6 do plano do workspace multiagente): marca, abas dos workspaces, botão de
// abrir e o espaço à direita para os contadores. A navegação principal fica na coluna lateral.
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

  it('não leva a navegação principal, que fica no topo da barra lateral, acima dos workspaces', () => {
    render(
      <MemoryRouter>
        <App />
      </MemoryRouter>,
    );
    const navigation = screen.getByRole('navigation', { name: 'Principal' });
    expect(topBar().contains(navigation)).toBe(false);
    const sidebar = navigation.closest('.sidebar');
    expect(sidebar).not.toBeNull();
    expect(sidebar?.closest('.app-side')).not.toBeNull();
    // A navegação é o primeiro item da barra, antes das seções.
    expect(sidebar?.firstElementChild).toBe(navigation);
    expect(screen.getAllByRole('navigation', { name: 'Principal' })).toHaveLength(1);
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

  it('mostra no canto direito o que vier em headerStatus', () => {
    render(
      <MemoryRouter>
        <App headerStatus={<span>2 executando</span>} />
      </MemoryRouter>,
    );
    const status = topBar().querySelector('.topbar__status');
    expect(status).toHaveTextContent('2 executando');
  });

  it.each([
    ['sem headerStatus', undefined],
    ['com headerStatus nulo', null],
  ])('%s, não deixa um espaço vazio na barra', (_caso, headerStatus) => {
    render(
      <MemoryRouter>
        <App headerStatus={headerStatus} />
      </MemoryRouter>,
    );
    expect(topBar().querySelector('.topbar__status')).toBeNull();
  });

  it('o fundo topográfico aparece fora da rota do workspace e some nela', () => {
    const first = render(
      <MemoryRouter initialEntries={['/']}>
        <App />
      </MemoryRouter>,
    );
    expect(document.querySelector('.topo-background')).not.toBeNull();
    first.unmount();
    render(
      <MemoryRouter initialEntries={['/workspaces/p1']}>
        <App />
      </MemoryRouter>,
    );
    expect(document.querySelector('.topo-background')).toBeNull();
    // Sem página até a Tarefa 9, mas a casca continua de pé.
    expect(document.querySelector('header.topbar')).not.toBeNull();
    expect(screen.getByRole('main')).toBeInTheDocument();
  });
});

// A página de Projetos chama a API do preload ao abrir. Aqui ela responde com lista vazia; o
// comportamento da página está em ProjectsPage.test.tsx.
describe('página de Projetos', () => {
  beforeEach(() => {
    window.projectHub = {
      ping: () => Promise.resolve({ ok: true, data: 'pong' }),
      projects: {
        list: () => Promise.resolve({ ok: true, data: [] }),
        listArchived: () => Promise.resolve({ ok: true, data: [] }),
        chooseDirectory: () => Promise.resolve({ ok: true, data: null }),
        add: () => Promise.reject(new Error('add não é chamado nesta página')),
      },
    } as unknown as ProjectHubApi;
  });

  afterEach(() => {
    Reflect.deleteProperty(window, 'projectHub');
  });

  it('mostra o botão Adicionar projeto habilitado, ao lado do título', async () => {
    render(
      <MemoryRouter initialEntries={['/projects']}>
        <App />
      </MemoryRouter>,
    );
    expect(screen.getByRole('heading', { level: 1, name: 'Projetos' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Adicionar projeto' })).toBeEnabled();
    expect(
      await screen.findByText('Nenhum projeto ainda. Adicione uma pasta para começar.'),
    ).toBeInTheDocument();
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
    const user = userEvent.setup();
    render(
      <MemoryRouter>
        <App />
      </MemoryRouter>,
    );
    await user.keyboard('{Control>}k{/Control}');
    await user.type(screen.getByRole('combobox'), 'Ir para Projetos{Enter}');
    expect(screen.getByRole('heading', { level: 1, name: 'Projetos' })).toBeInTheDocument();
    expect(screen.queryByRole('combobox')).toBeNull();
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
});
