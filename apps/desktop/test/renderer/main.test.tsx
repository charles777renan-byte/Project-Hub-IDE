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

  it('falha com mensagem clara quando o index.html não tem a div #root', async () => {
    await expect(import('../../src/renderer/main')).rejects.toThrow('#root');
  });
});
