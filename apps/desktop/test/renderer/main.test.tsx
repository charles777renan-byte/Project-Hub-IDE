import { act, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// O main.tsx é o ponto de entrada: monta o App na div #root dentro do HashRouter. Os outros testes
// usam MemoryRouter, então só este pega uma troca por BrowserRouter, que em file:// não funciona.
describe('main.tsx', () => {
  beforeEach(() => {
    vi.resetModules();
    document.body.innerHTML = '';
    window.location.hash = '';
  });

  it('monta o App na div #root e guarda a rota depois do #', async () => {
    document.body.innerHTML = '<div id="root"></div>';
    await act(async () => {
      await import('../../src/renderer/main');
    });

    await userEvent.click(screen.getByRole('link', { name: 'Projetos' }));

    expect(window.location.hash).toBe('#/projects');
    expect(window.location.pathname).toBe('/');
    expect(screen.getByRole('heading', { name: 'Projetos' })).toBeInTheDocument();
  });

  it('monta a barra de status e não passa mais os contadores à barra superior', async () => {
    document.body.innerHTML = '<div id="root"></div>';
    await act(async () => {
      await import('../../src/renderer/main');
    });

    const footer = screen.getByRole('contentinfo', { name: 'Barra de status' });
    expect(footer).toHaveTextContent('executando');
    expect(document.querySelector('header.topbar')).not.toHaveTextContent('executando');
  });

  it('falha com mensagem clara quando o index.html não tem a div #root', async () => {
    // Captura o erro à mão: o matcher rejects.toThrow(texto) não reportava o erro correto neste
    // ambiente (jsdom), embora a mensagem estivesse certa.
    let error: unknown;
    try {
      await import('../../src/renderer/main');
    } catch (caught) {
      error = caught;
    }
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toContain('#root');
  });
});
