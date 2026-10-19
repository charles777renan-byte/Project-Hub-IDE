import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { describe, expect, it } from 'vitest';
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

describe('página de Projetos', () => {
  it('mostra o estado vazio e o botão Adicionar projeto desabilitado', () => {
    render(
      <MemoryRouter initialEntries={['/projects']}>
        <App />
      </MemoryRouter>,
    );
    expect(
      screen.getByText('Nenhum projeto ainda. Adicione uma pasta para começar.'),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Adicionar projeto' })).toBeDisabled();
  });
});
