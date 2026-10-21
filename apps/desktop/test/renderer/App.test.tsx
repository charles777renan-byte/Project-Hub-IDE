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

  it('chega aos links com Tab, na ordem da tela, e abre a página com Enter', async () => {
    const user = userEvent.setup();
    render(
      <MemoryRouter>
        <App />
      </MemoryRouter>,
    );

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

// Cabeçalho do workspace (Tarefa 3): marca, navegação e o espaço à direita para os contadores.
describe('cabeçalho', () => {
  beforeEach(() => {
    window.projectHub = {
      projects: { list: () => Promise.resolve({ ok: true, data: [] }) },
      missions: {
        list: () => Promise.resolve({ ok: true, data: [] }),
        subscribe: () => () => undefined,
      },
    } as unknown as ProjectHubApi;
  });

  afterEach(() => {
    Reflect.deleteProperty(window, 'projectHub');
  });

  it.each(['/', '/projects', '/projects/p1'])(
    'aparece com a marca e a navegação na rota %s',
    (route) => {
      render(
        <MemoryRouter initialEntries={[route]}>
          <App />
        </MemoryRouter>,
      );
      const banner = screen.getByRole('banner');
      expect(within(banner).getByText('Project Hub')).toBeInTheDocument();
      expect(within(banner).getByRole('navigation', { name: 'Principal' })).toBeInTheDocument();
    },
  );

  it('a marca tem o símbolo escondido dos leitores de tela', () => {
    render(
      <MemoryRouter>
        <App />
      </MemoryRouter>,
    );
    const mark = screen.getByRole('banner').querySelector('.app-brand__mark');
    expect(mark).not.toBeNull();
    expect(mark).toHaveAttribute('aria-hidden', 'true');
  });

  it('mostra no canto direito o que vier em headerStatus', () => {
    render(
      <MemoryRouter>
        <App headerStatus={<span>2 executando</span>} />
      </MemoryRouter>,
    );
    const status = screen.getByRole('banner').querySelector('.app-header__status');
    expect(status).toHaveTextContent('2 executando');
  });

  it('sem headerStatus, não deixa um espaço vazio no cabeçalho', () => {
    render(
      <MemoryRouter>
        <App />
      </MemoryRouter>,
    );
    expect(screen.getByRole('banner').querySelector('.app-header__status')).toBeNull();
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
