import { act, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import type { BrowserStateDto, ProjectHubApi } from '@project-hub/contracts';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RightPanel } from '../../src/renderer/components/right-panel/RightPanel';
import { browserState, browserTab, installBrowserApi } from './browser-fixtures';

/*
 * O ponto de atividade da aba Navegador na barra do painel direito: aparece enquanto o projeto tem aba de agente,
 * com a aba Navegador fechada (a aba guardada é a de Arquivos).
 */

const AGENT_TAB = browserTab({
  id: 'g1',
  title: 'Página do agente',
  owner: 'agent',
  terminalTitle: 'Claude Code · app',
});
const WITH_AGENT = browserState([browserTab(), AGENT_TAB]);
const WITHOUT_AGENT = browserState([browserTab()]);

function renderBar(initial: BrowserStateDto, projectId: string | null = 'p1') {
  const browser = installBrowserApi(initial);
  window.projectHub = {
    ...window.projectHub,
    github: { pr: vi.fn(() => new Promise(() => undefined)) },
    git: { status: vi.fn() },
    sessions: { list: vi.fn(() => new Promise(() => undefined)), resume: vi.fn() },
  } as unknown as ProjectHubApi;
  render(
    <MemoryRouter initialEntries={['/workspaces/p?visao=terminais']}>
      <RightPanel projectId={projectId} />
    </MemoryRouter>,
  );
  return browser;
}

const bar = () => screen.getByRole('tablist', { name: 'Painéis laterais' });
const dotOf = (button: HTMLElement) => button.querySelector('.right-panel__dot');

beforeEach(() => {
  window.localStorage.clear();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('ponto de atividade da aba Navegador', () => {
  it('com aba de agente no projeto, a aba leva o ponto e o nome diz "agente no navegador"', async () => {
    renderBar(WITH_AGENT);
    const button = await within(bar()).findByRole('tab', {
      name: 'Navegador: agente no navegador',
    });
    expect(dotOf(button)).toHaveClass('right-panel__dot--ok');
    expect(dotOf(button)).toHaveAttribute('aria-hidden', 'true');
    expect(button).toHaveAttribute('aria-selected', 'false');
  });

  it('sem aba de agente, não há ponto, e ele some quando a última aba de agente fecha', async () => {
    const { emit } = renderBar(WITH_AGENT);
    await within(bar()).findByRole('tab', { name: 'Navegador: agente no navegador' });
    act(() => emit(WITHOUT_AGENT));
    const button = within(bar()).getByRole('tab', { name: 'Navegador' });
    expect(dotOf(button)).toBeNull();
  });

  it('o ponto aparece quando o agente abre a primeira aba', async () => {
    const { api, emit } = renderBar(WITHOUT_AGENT);
    await act(async () => {
      await api.state.mock.results[0]?.value;
    });
    expect(dotOf(within(bar()).getByRole('tab', { name: 'Navegador' }))).toBeNull();
    act(() => emit(WITH_AGENT));
    expect(
      within(bar()).getByRole('tab', { name: 'Navegador: agente no navegador' }),
    ).toBeInTheDocument();
  });

  it('o estado de outro projeto não acende o ponto, e sem projeto nada é lido', async () => {
    const { api, emit } = renderBar(WITHOUT_AGENT);
    await act(async () => {
      await api.state.mock.results[0]?.value;
    });
    act(() => emit(browserState([AGENT_TAB], 'g1', 'p2')));
    expect(within(bar()).getByRole('tab', { name: 'Navegador' })).toBeInTheDocument();
  });
});
