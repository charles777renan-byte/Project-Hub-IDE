import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import type {
  AppResult,
  MissionDto,
  ProjectHubApi,
  ProjectSummary,
  TerminalSummary,
} from '@project-hub/contracts';
import { afterEach, describe, expect, it } from 'vitest';
import { App } from '../../src/renderer/App';

/*
 * "Precisa de você" num critério só (decisao-revisao-ui-ux-respostas, decisão 1). O contador "aguarda você" da barra
 * de status, a faixa da lateral, o cabeçalho e as linhas do Início e o filtro `?estado=attention` contam as mesmas
 * entradas de `attention.ts`. Aqui a janela inteira é montada (App), com a API do preload falsa.
 */

const project: ProjectSummary = {
  id: 'p1',
  name: 'Projeto p1',
  path: 'C:\\p1',
  repositoryKind: 'git',
  available: true,
  defaultBranch: 'main',
};

function mission(id: string, status: MissionDto['status']): MissionDto {
  return {
    id,
    projectId: 'p1',
    title: `Missão ${id}`,
    objective: 'Objetivo da missão',
    status,
    altersCode: false,
    acceptanceCriteria: [{ id: `${id}-c1`, position: 1, text: 'Critério' }],
    createdAt: '2026-10-20T09:00:00.000Z',
    updatedAt: '2026-10-20T09:00:00.000Z',
  };
}

/** Uma sessão de terminal em espera. Com `missionId`, ela representa essa missão. */
function waitingSession(extra: Partial<TerminalSummary> = {}): TerminalSummary {
  return {
    id: 't1',
    kind: 'shell',
    title: 'Claude Code',
    projectId: 'p1',
    projectName: 'Projeto p1',
    state: 'waiting',
    provider: 'claude',
    origin: 'new',
    ...extra,
  };
}

const ok = <T,>(data: T): Promise<AppResult<T>> => Promise.resolve({ ok: true, data });

/**
 * Instala a API falsa. `terminals: 'pending'` nunca responde a primeira leitura, como uma janela ainda carregando.
 * As missões do projeto p1 são `missions`.
 */
function installApi({
  terminals,
  missions,
}: {
  terminals: TerminalSummary[] | 'pending';
  missions: MissionDto[];
}) {
  window.projectHub = {
    projects: {
      list: () => ok([project]),
      listArchived: () => ok([]),
    },
    missions: {
      list: (projectId: string) => ok(projectId === 'p1' ? missions : []),
      get: () => ok({ steps: [], pendingApprovals: [] }),
      subscribe: () => () => undefined,
    },
    terminals: {
      list: () => (terminals === 'pending' ? new Promise<never>(() => {}) : ok(terminals)),
    },
    workspaces: { list: () => ok([]) },
    activity: { daily: () => ok([]) },
    profile: {
      get: () => ok({ displayName: null }),
      setDisplayName: () => ok({}),
    },
    limits: {
      get: () => ok({ providers: [] }),
      refresh: () => undefined,
      subscribe: () => () => undefined,
    },
  } as unknown as ProjectHubApi;
}

function renderApp(entry = '/') {
  return render(
    <MemoryRouter initialEntries={[entry]}>
      <App />
    </MemoryRouter>,
  );
}

afterEach(() => {
  Reflect.deleteProperty(window, 'projectHub');
  window.localStorage.clear();
});

describe('Precisa de você: um critério só em toda a janela', () => {
  it('com uma sessão em espera e uma missão planned, o contador, a lateral, o Início e o filtro dizem 2', async () => {
    const user = userEvent.setup();
    installApi({ terminals: [waitingSession()], missions: [mission('m1', 'planned')] });
    renderApp();

    const footer = screen.getByRole('contentinfo', { name: 'Barra de status' });
    const counter = await within(footer).findByRole('link', { name: '2 aguarda você' });
    expect(counter).toHaveAttribute('href', '/?estado=attention');

    const sidebar = screen.getByRole('complementary', { name: 'Projetos e missões' });
    const strip = await within(sidebar).findByRole('region', { name: 'Precisa de você' });
    expect(strip).toHaveTextContent('Precisa de você · 2');

    const main = screen.getByRole('main');
    const needs = within(main).getByRole('region', { name: 'Precisa de você' });
    expect(within(needs).getByText('2')).toBeInTheDocument();
    await waitFor(() => expect(within(needs).getAllByRole('listitem')).toHaveLength(2));

    await user.click(counter);

    const missions = within(main).getByRole('region', { name: 'Missões' });
    await waitFor(() => expect(within(missions).getAllByRole('listitem')).toHaveLength(2));
    expect(within(missions).getByText('2')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: '2 aguarda você' })).toBeInTheDocument();
  });

  it('antes da primeira leitura dos terminais, o contador mostra traço e não zero', async () => {
    installApi({ terminals: 'pending', missions: [mission('m1', 'planned')] });
    renderApp();

    const footer = screen.getByRole('contentinfo', { name: 'Barra de status' });
    // A missão só aparece quando a carga das missões chegou: aí a contagem já tem o que dizer, e ainda é traço.
    const main = screen.getByRole('main');
    await waitFor(() =>
      expect(within(main).getAllByRole('link', { name: 'Missão m1' }).length).toBeGreaterThan(0),
    );
    expect(within(footer).getByRole('link', { name: '— aguarda você' })).toBeInTheDocument();
    expect(within(footer).queryByRole('link', { name: '0 aguarda você' })).not.toBeInTheDocument();
    expect(within(footer).queryByRole('link', { name: '1 aguarda você' })).not.toBeInTheDocument();

    const needs = within(main).getByRole('region', { name: 'Precisa de você' });
    expect(within(needs).getByText('—')).toBeInTheDocument();
  });

  it('uma missão que já tem a sessão em espera conta uma vez só, e a linha também', async () => {
    installApi({
      terminals: [waitingSession({ kind: 'agent', missionId: 'm2' })],
      missions: [mission('m2', 'waiting_input')],
    });
    renderApp('/?estado=attention');

    const footer = screen.getByRole('contentinfo', { name: 'Barra de status' });
    await within(footer).findByRole('link', { name: '1 aguarda você' });

    const sidebar = screen.getByRole('complementary', { name: 'Projetos e missões' });
    expect(
      await within(sidebar).findByRole('region', { name: 'Precisa de você' }),
    ).toHaveTextContent('Precisa de você · 1');

    const main = screen.getByRole('main');
    const needs = within(main).getByRole('region', { name: 'Precisa de você' });
    await waitFor(() => expect(within(needs).getAllByRole('listitem')).toHaveLength(1));
    expect(within(needs).getByText('1')).toBeInTheDocument();

    const missions = within(main).getByRole('region', { name: 'Missões' });
    await waitFor(() => expect(within(missions).getAllByRole('listitem')).toHaveLength(1));
    // A linha é a da sessão: a missão que ela representa não entra de novo.
    expect(within(missions).getByRole('link', { name: 'Claude Code' })).toBeInTheDocument();
    expect(within(missions).queryByRole('link', { name: 'Missão m2' })).not.toBeInTheDocument();
  });
});
