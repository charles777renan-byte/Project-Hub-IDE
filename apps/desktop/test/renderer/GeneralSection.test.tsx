import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ProjectHubApi } from '@project-hub/contracts';
import { askBeforeClosing, setAskBeforeClosing } from '../../src/renderer/close-confirm';
import { GeneralSection } from '../../src/renderer/components/settings/GeneralSection';
import { setSidebarView, useSidebarView } from '../../src/renderer/sidebar-view';

// A seção Geral das Configurações: quatro linhas, cada uma com uma preferência ou um dado do app.

const DATA_DIR = 'C:\\Users\\voce\\AppData\\Roaming\\Project Hub';

function installApi(
  options: {
    info?: () => Promise<unknown>;
    openDataFolder?: () => Promise<unknown>;
  } = {},
) {
  const app = {
    info: vi.fn(
      options.info ??
        (() => Promise.resolve({ ok: true, data: { version: '0.1.0', dataDir: DATA_DIR } })),
    ),
    openDataFolder: vi.fn(
      options.openDataFolder ?? (() => Promise.resolve({ ok: true, data: undefined })),
    ),
  };
  window.projectHub = { app } as unknown as ProjectHubApi;
  return app;
}

function row(label: string): HTMLElement {
  const term = screen.getByText(label, { selector: 'dt' });
  return term.parentElement as HTMLElement;
}

function ViewProbe() {
  return <p data-testid="view">{useSidebarView()}</p>;
}

afterEach(() => {
  Reflect.deleteProperty(window, 'projectHub');
  setAskBeforeClosing(true);
  setSidebarView('list');
  window.localStorage.clear();
});

describe('GeneralSection', () => {
  it('tem o título Geral e as quatro linhas, na ordem', async () => {
    installApi();
    render(<GeneralSection />);
    expect(screen.getByRole('heading', { level: 2, name: 'Geral' })).toBeInTheDocument();
    expect([...document.querySelectorAll('dt')].map((term) => term.textContent)).toEqual([
      'Ao fechar',
      'Barra lateral',
      'Pasta de dados',
      'Versão',
    ]);
    await screen.findByText('0.1.0');
  });

  it('a caixa "Ao fechar" mostra a preferência e a grava', async () => {
    installApi();
    render(<GeneralSection />);
    const box = within(row('Ao fechar')).getByRole('checkbox', {
      name: 'Perguntar antes de fechar um terminal com agente rodando',
    });
    expect(box).toBeChecked();

    await userEvent.click(box);

    expect(box).not.toBeChecked();
    expect(askBeforeClosing()).toBe(false);
  });

  it('a barra lateral troca entre Lista e Grade, e a lateral vê a mudança na hora', async () => {
    installApi();
    render(
      <>
        <GeneralSection />
        <ViewProbe />
      </>,
    );
    const group = within(row('Barra lateral')).getByRole('group', {
      name: 'Projetos na barra lateral',
    });
    expect(within(group).getByRole('button', { name: 'Lista' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );

    await userEvent.click(within(group).getByRole('button', { name: 'Grade' }));

    expect(within(group).getByRole('button', { name: 'Grade' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    expect(within(group).getByRole('button', { name: 'Lista' })).toHaveAttribute(
      'aria-pressed',
      'false',
    );
    expect(screen.getByTestId('view')).toHaveTextContent('grid');
    expect(window.localStorage.getItem('project-hub:sidebar-view')).toBe('grid');
  });

  it('mostra a pasta de dados e a versão que o app informa', async () => {
    installApi();
    render(<GeneralSection />);
    await waitFor(() => expect(row('Pasta de dados')).toHaveTextContent(DATA_DIR));
    expect(row('Versão')).toHaveTextContent('0.1.0');
  });

  it('Abrir pasta pede ao app para abrir a pasta de dados, sem mandar caminho', async () => {
    const app = installApi();
    render(<GeneralSection />);
    await screen.findByText('0.1.0');

    await userEvent.click(within(row('Pasta de dados')).getByRole('button', { name: 'Abrir pasta' }));

    expect(app.openDataFolder).toHaveBeenCalledExactlyOnceWith();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('quando a pasta não abre, a linha diz o que houve', async () => {
    installApi({
      openDataFolder: () =>
        Promise.resolve({
          ok: false,
          error: { code: 'UNKNOWN', message: 'Não foi possível abrir a pasta de dados.', retryable: false },
        }),
    });
    render(<GeneralSection />);
    await screen.findByText('0.1.0');

    await userEvent.click(screen.getByRole('button', { name: 'Abrir pasta' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Não foi possível abrir a pasta de dados.',
    );
  });

  it('quando o app não informa os dados, as linhas dizem isso e o botão fica desligado', async () => {
    installApi({ info: () => Promise.reject(new Error('sem ponte')) });
    render(<GeneralSection />);
    await waitFor(() => expect(row('Versão')).toHaveTextContent('Não foi possível ler'));
    expect(row('Pasta de dados')).toHaveTextContent('Não foi possível ler');
    expect(screen.getByRole('button', { name: 'Abrir pasta' })).toBeDisabled();
  });

  it('sem a ponte do app (testes da janela inteira), a seção ainda aparece', () => {
    render(<GeneralSection />);
    expect(screen.getByRole('heading', { level: 2, name: 'Geral' })).toBeInTheDocument();
  });
});
