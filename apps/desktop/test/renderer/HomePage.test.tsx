import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router';
import type {
  AgentActivity,
  AppResult,
  ApprovalDto,
  MissionDto,
  MissionViewDto,
  ProjectHubApi,
  ProjectSummary,
  TerminalSummary,
} from '@project-hub/contracts';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { OverviewCounters } from '../../src/renderer/components/OverviewCounters';
import { HomePage } from '../../src/renderer/pages/HomePage';
import { ADD_PROJECT_REQUEST_EVENT } from '../../src/renderer/projects-events';
import { missionPath, ROUTE_PATHS, workspacePath } from '../../src/renderer/routes';

/**
 * Início como painel de abertura: saudação numa linha, "Precisa de você", missões com progresso (e o
 * filtro `?estado=` dos contadores da barra de status), o bloco "Visão geral" de largura toda e o uso dos agentes. A API do
 * preload é falsa; cada teste monta projetos, missões e as leituras de `missions.get`.
 */

type Status = MissionDto['status'];

function project(id: string): ProjectSummary {
  return {
    id,
    name: `Projeto ${id}`,
    path: `C:\\${id}`,
    repositoryKind: 'git',
    available: true,
    defaultBranch: 'main',
  };
}

function mission(id: string, projectId: string, status: Status): MissionDto {
  return {
    id,
    projectId,
    title: `Missão ${id}`,
    objective: 'Objetivo da missão',
    status,
    altersCode: false,
    acceptanceCriteria: [{ id: `${id}-c1`, position: 1, text: 'Critério' }],
    createdAt: '2026-10-20T09:00:00.000Z',
    updatedAt: '2026-10-20T09:00:00.000Z',
  };
}

function approval(missionId: string): ApprovalDto {
  return {
    id: `ap-${missionId}`,
    missionId,
    executionId: 'ex1',
    actionType: 'command',
    title: `Aprovar ${missionId}`,
    rationale: 'Motivo',
    affectedResources: [],
    status: 'pending',
    requestedAt: '2026-10-20T09:10:00.000Z',
  };
}

const EMPTY_ACTIVITY: AppResult<AgentActivity> = {
  ok: true,
  data: {
    agents: [
      { id: 'claude', label: 'Claude Code', messagesAvailable: true, tokensAvailable: true },
      { id: 'codex', label: 'Codex', messagesAvailable: true, tokensAvailable: true },
      {
        id: 'antigravity',
        label: 'Antigravity CLI',
        messagesAvailable: true,
        tokensAvailable: false,
      },
    ],
    days: [],
    since: null,
  },
};

type Setup = {
  projects?: ProjectSummary[] | 'error';
  missions?: Record<string, MissionDto[]>;
  /** Resposta de `missions.get` por missão; `undefined` devolve a aprovação da missão. */
  get?: (missionId: string) => AppResult<MissionViewDto> | 'pending' | undefined;
  /** Resposta de `activity.agents`; sem ela, a consulta devolve os três agentes e nenhum dia. */
  activity?: AppResult<AgentActivity>;
  /** Nome do perfil local (`profile.get`). */
  displayName?: string | null;
  /** Terminais (`terminals.list`). Sem a opção, a API de terminais nem existe; `'pending'` nunca responde. */
  terminals?: TerminalSummary[] | 'pending';
};

/** Uma sessão de terminal em espera, do projeto p1 e sem missão. */
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

function installApi({
  projects = [],
  missions = {},
  get,
  activity,
  displayName = null,
  terminals,
}: Setup) {
  const setDisplayName = vi.fn(() => Promise.resolve({ ok: true }));
  const api = {
    activity: {
      agents: vi.fn(() => Promise.resolve<AppResult<AgentActivity>>(activity ?? EMPTY_ACTIVITY)),
    },
    profile: {
      get: vi.fn(() => Promise.resolve({ ok: true, data: { displayName } })),
      setDisplayName,
    },
    projects: {
      list: vi.fn(() =>
        Promise.resolve<AppResult<ProjectSummary[]>>(
          projects === 'error'
            ? { ok: false, error: { code: 'UNKNOWN', message: 'Falhou.', retryable: true } }
            : { ok: true, data: projects },
        ),
      ),
    },
    missions: {
      list: vi.fn((projectId: string) =>
        Promise.resolve<AppResult<MissionDto[]>>({ ok: true, data: missions[projectId] ?? [] }),
      ),
      get: vi.fn((missionId: string) => {
        const custom = get?.(missionId);
        if (custom === 'pending') return new Promise<never>(() => {});
        if (custom !== undefined) return Promise.resolve(custom);
        return Promise.resolve({
          ok: true,
          data: { steps: [], pendingApprovals: [approval(missionId)] },
        });
      }),
      subscribe: vi.fn(() => () => {}),
    },
    limits: {
      get: vi.fn(() =>
        Promise.resolve({
          ok: true,
          data: {
            providers: [
              {
                provider: 'claude',
                windows: [
                  {
                    id: 'five_hour',
                    usedPercent: 16,
                    resetsAt: new Date(Date.now() + 3 * 3600_000).toISOString(),
                  },
                ],
                refreshing: false,
              },
              {
                provider: 'codex',
                windows: [
                  {
                    id: 'thirty_day',
                    usedPercent: 47,
                    resetsAt: new Date(Date.now() + 17 * 24 * 3600_000).toISOString(),
                    durationMinutes: 43200,
                  },
                ],
                refreshing: false,
              },
            ],
          },
        }),
      ),
      refresh: vi.fn(),
      subscribe: vi.fn(() => () => {}),
    },
  };
  if (terminals !== undefined) {
    Object.assign(api, {
      terminals: {
        list: vi.fn(() =>
          terminals === 'pending'
            ? new Promise<never>(() => {})
            : Promise.resolve<AppResult<TerminalSummary[]>>({ ok: true, data: terminals }),
        ),
      },
    });
  }
  window.projectHub = api as unknown as ProjectHubApi;
  return { setDisplayName };
}

function Where() {
  const location = useLocation();
  return (
    <>
      <p data-testid="where">{`${location.pathname}${location.search}`}</p>
      <p data-testid="state">{JSON.stringify(location.state)}</p>
    </>
  );
}

function renderHome(entry: string = ROUTE_PATHS.home) {
  return render(
    <MemoryRouter initialEntries={[entry]}>
      <Routes>
        <Route
          path={ROUTE_PATHS.home}
          element={
            <>
              <HomePage />
              <Where />
            </>
          }
        />
        <Route path="*" element={<Where />} />
      </Routes>
    </MemoryRouter>,
  );
}

function panel(name: string) {
  return screen.getByRole('region', { name });
}

const MIXED: Record<string, MissionDto[]> = {
  p1: [
    mission('m1', 'p1', 'running'),
    mission('m2', 'p1', 'failed'),
    mission('m3', 'p1', 'waiting_approval'),
    mission('m4', 'p1', 'planned'),
    mission('m5', 'p1', 'succeeded'),
  ],
};

afterEach(() => {
  Reflect.deleteProperty(window, 'projectHub');
});

describe('HomePage', () => {
  it('não tem mais "Começar", "Projetos recentes" nem os quatro blocos de números', async () => {
    installApi({ projects: [project('p1')], missions: MIXED });

    renderHome();

    await screen.findByText('Aprovar m3');
    expect(screen.queryByText(/Começar/)).not.toBeInTheDocument();
    expect(screen.queryByText('Projetos recentes')).not.toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Nova missão' })).not.toBeInTheDocument();
    expect(document.querySelector('.stat-pills, .stat-pill, .recent-projects__grid')).toBeNull();
    // "Executando" agora também é o nome de um chip de estado; o que sumiu foi o rótulo do bloco de número.
    expect(screen.queryByText('Executando', { selector: ':not(button)' })).not.toBeInTheDocument();
  });

  it('monta as faixas na ordem: saudação, Visão geral, Precisa de você, Missões e Uso dos agentes', async () => {
    installApi({ projects: [project('p1')] });

    renderHome();

    await screen.findByText('Nada espera por você.');
    const order = [
      screen.getByRole('heading', { level: 1, name: 'Início' }),
      panel('Visão geral'),
      panel('Precisa de você'),
      panel('Missões'),
      panel('Uso dos agentes'),
    ];
    for (let index = 1; index < order.length; index += 1) {
      const previous = order[index - 1] as HTMLElement;
      const current = order[index] as HTMLElement;
      expect(
        previous.compareDocumentPosition(current) & Node.DOCUMENT_POSITION_FOLLOWING,
        `bloco ${index}`,
      ).toBeTruthy();
    }
  });

  it('o fundo topográfico fica só na faixa do topo (a saudação), nunca atrás das listas', async () => {
    installApi({ projects: [project('p1')], missions: MIXED });

    const { container } = renderHome();

    await screen.findByText('Aprovar m3');
    const hero = container.querySelector('.home > .home-hero');
    expect(hero).not.toBeNull();
    expect(hero?.querySelector('.topo-background')).not.toBeNull();
    expect(hero?.querySelector('.home-greeting')).not.toBeNull();
    expect(container.querySelectorAll('.topo-background')).toHaveLength(1);
    expect(container.querySelector('.home-columns .topo-background')).toBeNull();
    // O fundo é decorativo: a faixa não leva lista, tabela nem formulário de dados além do nome.
    expect(hero?.querySelector('ul, table')).toBeNull();
  });

  it('Precisa de você lista a aprovação e o que mais espera a pessoa, cada item com link direto', async () => {
    installApi({ projects: [project('p1')], missions: MIXED });

    renderHome();

    const needs = panel('Precisa de você');
    const approvalLink = await within(needs).findByRole('link', { name: /Aprovar m3/ });
    expect(approvalLink).toHaveAttribute('href', missionPath('p1', 'm3'));
    const planLink = within(needs).getByRole('link', { name: 'Missão m4' });
    expect(planLink).toHaveAttribute('href', missionPath('p1', 'm4'));
    expect(within(needs).getByText('Aprovar plano')).toBeInTheDocument();
    // O que está rodando, falhou ou terminou não espera a pessoa.
    expect(within(needs).queryByRole('link', { name: 'Missão m1' })).not.toBeInTheDocument();
    expect(within(needs).queryByRole('link', { name: 'Missão m2' })).not.toBeInTheDocument();
  });

  it('leituras de aprovação perdidas aparecem como texto, junto das aprovações lidas', async () => {
    installApi({
      projects: [project('p1')],
      missions: {
        p1: [mission('m3', 'p1', 'waiting_approval'), mission('m4', 'p1', 'waiting_approval')],
      },
      get: (missionId) =>
        missionId === 'm4'
          ? { ok: false, error: { code: 'UNKNOWN', message: 'Falhou.', retryable: true } }
          : undefined,
    });

    renderHome();

    expect(
      await screen.findByText('Não foi possível carregar a aprovação de Missão m4.'),
    ).toBeInTheDocument();
    expect(within(panel('Precisa de você')).getByText('Aprovar m3')).toBeInTheDocument();
    expect(screen.queryByText('Nada espera por você.')).not.toBeInTheDocument();
  });

  it('enquanto as aprovações não carregam, Precisa de você mostra Carregando e não o vazio', async () => {
    installApi({
      projects: [project('p1')],
      missions: { p1: [mission('m1', 'p1', 'running'), mission('m3', 'p1', 'waiting_approval')] },
      get: () => 'pending',
    });

    renderHome();

    // A missão em execução serve de marca: quando ela aparece, a fase 1 já chegou.
    expect(await within(panel('Missões')).findByText('Missão m1')).toBeInTheDocument();
    expect(within(panel('Precisa de você')).getByText('Carregando…')).toBeInTheDocument();
    expect(screen.queryByText('Nada espera por você.')).not.toBeInTheDocument();
  });

  it('Missões lista as missões com o estado e o link, sem repetir as que Precisa de você já mostra', async () => {
    installApi({ projects: [project('p1')], missions: MIXED });

    renderHome();

    const missions = panel('Missões');
    expect(await within(missions).findByRole('link', { name: 'Missão m1' })).toHaveAttribute(
      'href',
      missionPath('p1', 'm1'),
    );
    // m3 (aprovação) e m4 (plano) já estão em "Precisa de você": a banda mostra só as demais.
    expect(within(missions).getAllByRole('listitem')).toHaveLength(3);
    expect(within(missions).queryByRole('link', { name: 'Missão m3' })).not.toBeInTheDocument();
    expect(within(missions).queryByRole('link', { name: 'Missão m4' })).not.toBeInTheDocument();
    // O nome do projeto abre a linha de detalhes, para dizer de onde é a missão quando a lista junta vários; o
    // estado vai no selo.
    const failed = within(missions)
      .getByRole('link', { name: 'Missão m2' })
      .closest('li') as HTMLElement;
    expect(failed.querySelector('.chip')).toHaveTextContent('Falhou');
    expect(failed.querySelector('.mission-progress__meta')?.textContent).toMatch(/^Projeto p1 · /);
    expect(within(missions).getByText('3')).toBeInTheDocument();
  });

  it('o chip Concluídas mostra só as missões concluídas', async () => {
    const user = userEvent.setup();
    installApi({ projects: [project('p1')], missions: MIXED });

    renderHome();

    const missions = panel('Missões');
    await user.click(await within(missions).findByRole('button', { name: 'Concluídas' }));
    expect(await within(missions).findByRole('link', { name: 'Missão m5' })).toBeInTheDocument();
    expect(within(missions).queryByRole('link', { name: 'Missão m1' })).not.toBeInTheDocument();
    expect(within(missions).queryByRole('link', { name: 'Missão m2' })).not.toBeInTheDocument();
  });

  it('a busca acha missão pelo título e pelo projeto, sem acento e sem maiúscula', async () => {
    const user = userEvent.setup();
    installApi({
      projects: [project('p1'), { ...project('p2'), name: 'Relatório Anual' }],
      missions: { ...MIXED, p2: [mission('m9', 'p2', 'running')] },
    });

    renderHome();

    const missions = panel('Missões');
    const search = within(missions).getByRole('searchbox', { name: 'Buscar missão ou projeto' });
    await user.type(search, 'missao m1');
    expect(await within(missions).findByRole('link', { name: 'Missão m1' })).toBeInTheDocument();
    expect(within(missions).queryByRole('link', { name: 'Missão m2' })).not.toBeInTheDocument();

    await user.clear(search);
    await user.type(search, 'RELATORIO');
    expect(await within(missions).findByRole('link', { name: 'Missão m9' })).toBeInTheDocument();
    expect(within(missions).queryByRole('link', { name: 'Missão m1' })).not.toBeInTheDocument();

    await user.clear(search);
    await user.type(search, 'nada disso');
    expect(
      await within(missions).findByText('Nenhuma missão encontrada para esta busca.'),
    ).toBeInTheDocument();
  });

  it('missão em planned aparece só em Precisa de você sem filtro, e na banda com o filtro Aguarda você', async () => {
    const user = userEvent.setup();
    installApi({ projects: [project('p1')], missions: { p1: [mission('m4', 'p1', 'planned')] } });

    renderHome();

    const missions = panel('Missões');
    expect(
      await within(panel('Precisa de você')).findByRole('link', { name: 'Missão m4' }),
    ).toBeInTheDocument();
    expect(within(missions).queryByRole('link', { name: 'Missão m4' })).not.toBeInTheDocument();
    expect(
      within(missions).getByText('Todas as missões estão em “Precisa de você”.'),
    ).toBeInTheDocument();

    await user.click(within(missions).getByRole('button', { name: 'Aguarda você' }));

    expect(await within(missions).findByRole('link', { name: 'Missão m4' })).toBeInTheDocument();
    expect(within(missions).getAllByRole('listitem')).toHaveLength(1);
  });

  it('missão running aparece só na banda Missões, nunca em Precisa de você', async () => {
    installApi({ projects: [project('p1')], missions: { p1: [mission('m1', 'p1', 'running')] } });

    renderHome();

    expect(
      await within(panel('Missões')).findByRole('link', { name: 'Missão m1' }),
    ).toBeInTheDocument();
    expect(
      await within(panel('Precisa de você')).findByText('Nada espera por você.'),
    ).toBeInTheDocument();
    expect(
      within(panel('Precisa de você')).queryByRole('link', { name: 'Missão m1' }),
    ).not.toBeInTheDocument();
  });

  it('uma missão que uma sessão em espera representa não aparece na banda sem filtro', async () => {
    installApi({
      projects: [project('p1')],
      missions: { p1: [mission('m4', 'p1', 'planned'), mission('m1', 'p1', 'running')] },
      terminals: [waitingSession({ missionId: 'm4' })],
    });

    renderHome();

    const missions = panel('Missões');
    expect(await within(missions).findByRole('link', { name: 'Missão m1' })).toBeInTheDocument();
    expect(within(missions).queryByRole('link', { name: 'Missão m4' })).not.toBeInTheDocument();
    expect(
      within(panel('Precisa de você')).getByRole('link', { name: 'Claude Code' }),
    ).toBeInTheDocument();
    expect(within(missions).getAllByRole('listitem')).toHaveLength(1);
  });

  it('?estado=failed mostra só as missões que falharam e um chip para limpar o filtro', async () => {
    const user = userEvent.setup();
    installApi({ projects: [project('p1')], missions: MIXED });

    renderHome('/?estado=failed');

    const missions = panel('Missões');
    await within(missions).findByRole('link', { name: 'Missão m2' });
    expect(within(missions).getAllByRole('listitem')).toHaveLength(1);
    expect(within(missions).queryByRole('link', { name: 'Missão m1' })).not.toBeInTheDocument();
    expect(within(missions).getByRole('button', { name: 'Falharam' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );

    await user.click(within(missions).getByRole('button', { name: 'Limpar filtro' }));

    expect(await within(missions).findByRole('link', { name: 'Missão m1' })).toBeInTheDocument();
    expect(within(missions).getAllByRole('listitem')).toHaveLength(3);
    expect(screen.getByTestId('where')).toHaveTextContent('/');
    expect(screen.getByTestId('where')).not.toHaveTextContent('estado');
  });

  it('?estado=attention lista as mesmas missões que o contador da barra de status conta', async () => {
    installApi({ projects: [project('p1')], missions: MIXED });
    render(
      <MemoryRouter initialEntries={['/?estado=attention']}>
        <OverviewCounters />
        <HomePage />
      </MemoryRouter>,
    );

    const missions = panel('Missões');
    await within(missions).findByRole('link', { name: 'Missão m3' });
    await waitFor(() =>
      expect(screen.getByRole('link', { name: '2 aguarda você' })).toBeInTheDocument(),
    );
    expect(
      within(missions)
        .getAllByRole('link')
        .map((link) => link.textContent),
    ).toEqual(['Missão m3', 'Missão m4']);
  });

  it('?estado=attention põe as sessões em espera antes das missões, e o número da banda é o do contador', async () => {
    installApi({ projects: [project('p1')], missions: MIXED, terminals: [waitingSession()] });
    render(
      <MemoryRouter initialEntries={['/?estado=attention']}>
        <OverviewCounters />
        <HomePage />
      </MemoryRouter>,
    );

    const missions = panel('Missões');
    await within(missions).findByRole('link', { name: 'Claude Code' });
    await waitFor(() =>
      expect(screen.getByRole('link', { name: '3 aguarda você' })).toBeInTheDocument(),
    );
    expect(within(missions).getByText('3')).toBeInTheDocument();
    expect(
      within(missions)
        .getAllByRole('link')
        .map((link) => link.textContent),
    ).toEqual(['Claude Code', 'Missão m3', 'Missão m4']);
    expect(within(missions).getAllByRole('listitem')).toHaveLength(3);
  });

  it('Precisa de você tem uma linha por entrada: a sessão em espera e a missão que espera, e o cabeçalho diz 2', async () => {
    installApi({
      projects: [project('p1')],
      missions: { p1: [mission('m4', 'p1', 'planned')] },
      terminals: [waitingSession()],
    });

    renderHome();

    const needs = panel('Precisa de você');
    expect(await within(needs).findByRole('link', { name: 'Claude Code' })).toHaveAttribute(
      'href',
      workspacePath('p1'),
    );
    expect(within(needs).getByRole('link', { name: 'Missão m4' })).toHaveAttribute(
      'href',
      missionPath('p1', 'm4'),
    );
    expect(within(needs).getAllByRole('listitem')).toHaveLength(2);
    expect(within(needs).getByText('2')).toBeInTheDocument();
  });

  it('a sessão em espera leva ao workspace do projeto, pedindo o terminal dela (como a lateral)', async () => {
    const user = userEvent.setup();
    installApi({ projects: [project('p1')], terminals: [waitingSession()] });

    renderHome();

    await user.click(
      await within(panel('Precisa de você')).findByRole('link', { name: 'Claude Code' }),
    );

    expect(screen.getByTestId('where')).toHaveTextContent(workspacePath('p1'));
    expect(screen.getByTestId('state')).toHaveTextContent('"showTerminal":"t1"');
  });

  it('sem a primeira leitura dos terminais, o cabeçalho de Precisa de você mostra traço e não zero', async () => {
    installApi({
      projects: [project('p1')],
      missions: { p1: [mission('m4', 'p1', 'planned')] },
      terminals: 'pending',
    });

    renderHome();

    const needs = panel('Precisa de você');
    expect(await within(needs).findByRole('link', { name: 'Missão m4' })).toBeInTheDocument();
    expect(within(needs).getByText('—')).toBeInTheDocument();
    expect(within(needs).queryByText('0')).not.toBeInTheDocument();
    expect(within(needs).queryByText('1')).not.toBeInTheDocument();
  });

  it('uma missão com duas aprovações pendentes ocupa uma linha só, com a primeira', async () => {
    const second = { ...approval('m3'), id: 'ap-m3-2', title: 'Segunda aprovação' };
    installApi({
      projects: [project('p1')],
      missions: { p1: [mission('m3', 'p1', 'waiting_approval')] },
      get: () => ({
        ok: true,
        data: {
          steps: [],
          pendingApprovals: [approval('m3'), second],
        } as unknown as MissionViewDto,
      }),
    });

    renderHome();

    const needs = panel('Precisa de você');
    expect(await within(needs).findByRole('link', { name: 'Aprovar m3' })).toBeInTheDocument();
    expect(
      within(needs).queryByRole('link', { name: 'Segunda aprovação' }),
    ).not.toBeInTheDocument();
    expect(within(needs).getAllByRole('listitem')).toHaveLength(1);
  });

  it('os chips de estado têm os mesmos nomes dos contadores: Executando, Aguarda você e Falharam', async () => {
    installApi({ projects: [project('p1')], missions: MIXED });

    renderHome();

    const missions = panel('Missões');
    await within(missions).findByRole('link', { name: 'Missão m1' });
    const chips = within(missions)
      .getAllByRole('button')
      .map((button) => button.textContent);
    expect(chips).toEqual(expect.arrayContaining(['Executando', 'Aguarda você', 'Falharam']));
    expect(chips).not.toContain('Em andamento');
    expect(chips).not.toContain('Esperam você');
  });

  it('um chip de estado filtra a lista e clicar de novo no chip ativo limpa o filtro', async () => {
    const user = userEvent.setup();
    installApi({ projects: [project('p1')], missions: MIXED });

    renderHome();

    const missions = panel('Missões');
    await within(missions).findByRole('link', { name: 'Missão m1' });
    await user.click(within(missions).getByRole('button', { name: 'Executando' }));
    expect(screen.getByTestId('where')).toHaveTextContent('/?estado=running');
    await waitFor(() => expect(within(missions).getAllByRole('listitem')).toHaveLength(1));

    await user.click(within(missions).getByRole('button', { name: 'Executando' }));
    await waitFor(() => expect(within(missions).getAllByRole('listitem')).toHaveLength(3));
  });

  it('um valor de ?estado= que não existe vale como sem filtro', async () => {
    installApi({ projects: [project('p1')], missions: MIXED });

    renderHome('/?estado=qualquer');

    const missions = panel('Missões');
    await within(missions).findByRole('link', { name: 'Missão m1' });
    expect(within(missions).getAllByRole('listitem')).toHaveLength(3);
    expect(within(missions).queryByRole('button', { name: 'Limpar filtro' })).toBeNull();
  });

  it('filtro sem nenhuma missão mostra a frase e mantém o chip para limpar', async () => {
    installApi({
      projects: [project('p1')],
      missions: { p1: [mission('m1', 'p1', 'running')] },
    });

    renderHome('/?estado=failed');

    const missions = panel('Missões');
    expect(await within(missions).findByText('Nenhuma missão neste estado.')).toBeInTheDocument();
    expect(within(missions).getByRole('button', { name: 'Limpar filtro' })).toBeInTheDocument();
  });

  it('com um projeto e nenhuma missão, mostra os estados vazios de cada faixa', async () => {
    installApi({ projects: [project('p1')] });

    renderHome();

    expect(await screen.findByText('Nada espera por você.')).toBeInTheDocument();
    expect(within(panel('Missões')).getByText('Nenhuma missão ainda.')).toBeInTheDocument();
  });

  it('com a carga em erro, Missões mostra a mensagem', async () => {
    installApi({ projects: 'error' });

    renderHome();

    expect(await within(panel('Missões')).findByRole('alert')).toHaveTextContent(
      'Não foi possível carregar as missões.',
    );
  });

  it('sem nenhum dado, a Visão geral é uma linha só e não desenha o mapa', async () => {
    installApi({ projects: [project('p1')] });

    renderHome();

    expect(
      await within(panel('Visão geral')).findByText('Nenhuma mensagem pelo app neste período.'),
    ).toBeInTheDocument();
    expect(document.querySelector('.overview-grid')).toBeNull();
  });

  it('com o uso dos agentes em falha, o bloco mostra a mensagem e o resto da tela segue', async () => {
    installApi({
      projects: [project('p1')],
      missions: { p1: [mission('m1', 'p1', 'running')] },
      activity: { ok: false, error: { code: 'UNKNOWN', message: 'x', retryable: true } },
    });

    renderHome();

    expect(
      await within(panel('Visão geral')).findByText('Não foi possível carregar o uso dos agentes.'),
    ).toBeInTheDocument();
    expect(await within(panel('Missões')).findByText('Missão m1')).toBeInTheDocument();
  });

  it('a Visão geral ocupa uma linha de largura toda entre a saudação e as colunas, fora da lateral', async () => {
    installApi({ projects: [project('p1')] });

    const { container } = renderHome();

    const block = await screen.findByRole('region', { name: 'Visão geral' });
    expect(block.parentElement).toBe(container.querySelector('.home'));
    expect(block.closest('.home-side')).toBeNull();
    expect(block.closest('.home-columns')).toBeNull();
    const hero = container.querySelector('.home > .home-hero') as HTMLElement;
    const columns = container.querySelector('.home > .home-columns') as HTMLElement;
    expect(hero.compareDocumentPosition(block) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(block.compareDocumentPosition(columns) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    // A lateral fica só com o uso dos agentes.
    expect(
      within(container.querySelector('.home-side') as HTMLElement).getAllByRole('region'),
    ).toHaveLength(1);
  });

  it('Uso dos agentes mostra os cartões do Claude e do Codex e "Em breve" só para o Antigravity', async () => {
    installApi({ projects: [project('p1')] });

    renderHome();

    const usage = panel('Uso dos agentes');
    expect(await within(usage).findByText('Uso do Claude')).toBeInTheDocument();
    expect(await within(usage).findByText('16% usado · 84% restante')).toBeInTheDocument();
    expect(within(usage).getByLabelText('Sessão atual, 16% usado')).toBeInTheDocument();
    expect(await within(usage).findByText('Uso do Codex')).toBeInTheDocument();
    expect(within(usage).getByText('Mensal')).toBeInTheDocument();
    expect(within(usage).getByText('47% usado · 53% restante')).toBeInTheDocument();
    expect(within(usage).getByText('Antigravity CLI: Em breve.')).toBeInTheDocument();
    expect(within(usage).queryByText(/Codex e Antigravity/)).not.toBeInTheDocument();
  });

  it('cada cartão de uso é um grupo com o nome e o conteúdo do próprio programa', async () => {
    installApi({ projects: [project('p1')] });

    renderHome();

    const usage = panel('Uso dos agentes');
    const claudeGroup = await within(usage).findByRole('group', { name: 'Uso do Claude' });
    const codexGroup = await within(usage).findByRole('group', { name: 'Uso do Codex' });
    expect(within(claudeGroup).getByText('Sessão atual')).toBeInTheDocument();
    expect(within(claudeGroup).queryByText('Mensal')).not.toBeInTheDocument();
    expect(within(codexGroup).getByText('Mensal')).toBeInTheDocument();
    expect(within(codexGroup).queryByText('Sessão atual')).not.toBeInTheDocument();
    // A janela mensal do Codex renova a 17 dias: o cartão mostra a data, não só o dia da semana.
    expect(
      within(codexGroup).getByText(/^Renova \S+, \d{2}\/\d{2}, \d{2}:\d{2}$/),
    ).toBeInTheDocument();
  });

  it('antes da primeira resposta dos limites não aparece "Em breve" (nada de texto falso que logo troca)', async () => {
    installApi({ projects: [project('p1')] });
    window.projectHub.limits.get = vi.fn(() => new Promise<never>(() => {}));

    renderHome();

    const usage = panel('Uso dos agentes');
    expect(await within(usage).findByRole('group', { name: 'Uso do Claude' })).toBeInTheDocument();
    expect(within(usage).queryByText(/Em breve/)).not.toBeInTheDocument();
  });

  it('a saudação não tem mais o botão de alterar o nome', async () => {
    installApi({ displayName: 'Ana' });

    renderHome();

    expect(await screen.findByText(/, Ana/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /nome/i })).not.toBeInTheDocument();
  });

  it('?editar-nome=1 abre o formulário de nome, e salvar fecha e tira o parâmetro', async () => {
    const user = userEvent.setup();
    const { setDisplayName } = installApi({ displayName: 'Ana' });

    renderHome('/?editar-nome=1');

    const field = await screen.findByRole('textbox', { name: 'Seu nome' });
    expect(field).toHaveValue('Ana');
    await user.clear(field);
    await user.type(field, 'Bia');
    await user.click(screen.getByRole('button', { name: 'Salvar' }));

    expect(setDisplayName).toHaveBeenCalledWith('Bia');
    await waitFor(() =>
      expect(screen.queryByRole('textbox', { name: 'Seu nome' })).not.toBeInTheDocument(),
    );
    expect(await screen.findByText(/, Bia/)).toBeInTheDocument();
    expect(screen.getByTestId('where')).not.toHaveTextContent('editar-nome');
  });

  it('Cancelar fecha o formulário e tira o parâmetro', async () => {
    const user = userEvent.setup();
    installApi({ displayName: null });

    renderHome('/?editar-nome=1');

    await user.click(await screen.findByRole('button', { name: 'Cancelar' }));

    expect(screen.queryByRole('textbox', { name: 'Seu nome' })).not.toBeInTheDocument();
    expect(screen.getByTestId('where')).not.toHaveTextContent('editar-nome');
  });

  it('não tem texto com travad', async () => {
    installApi({ projects: [project('p1')] });

    renderHome();

    await screen.findByText('Nada espera por você.');
    expect(document.body.textContent).not.toMatch(/travad/i);
  });
});

describe('HomePage sem nenhum projeto', () => {
  it('mostra os dois passos e o botão Adicionar projeto, no lugar das faixas', async () => {
    installApi({});

    renderHome();

    expect(await screen.findByRole('button', { name: 'Adicionar projeto' })).toBeInTheDocument();
    expect(screen.getByText('Comece por um projeto')).toBeInTheDocument();
    expect(screen.getByText('1. Adicionar projeto')).toBeInTheDocument();
    expect(screen.getByText('2. Criar a primeira missão')).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Precisa de você' })).not.toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Missões' })).not.toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Visão geral' })).not.toBeInTheDocument();
    expect(screen.queryByText('Nada espera por você.')).not.toBeInTheDocument();
    expect(screen.queryByText('Nenhuma missão ainda.')).not.toBeInTheDocument();
    // Uso dos agentes não é faixa vazia: segue na tela sem projeto.
    expect(panel('Uso dos agentes')).toBeInTheDocument();
  });

  it('a saudação continua no topo', async () => {
    installApi({ displayName: 'Ana' });

    renderHome();

    expect(await screen.findByText(/, Ana/)).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 1, name: 'Início' })).toBeInTheDocument();
  });

  it('com um projeto, o estado vazio some e as faixas voltam', async () => {
    installApi({ projects: [project('p1')] });

    renderHome();

    expect(await screen.findByText('Nada espera por você.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Adicionar projeto' })).not.toBeInTheDocument();
    expect(screen.queryByText('Comece por um projeto')).not.toBeInTheDocument();
    expect(panel('Precisa de você')).toBeInTheDocument();
  });

  it('com a lista de projetos em erro, não mostra o estado vazio', async () => {
    installApi({ projects: 'error' });

    renderHome();

    expect(await within(panel('Missões')).findByRole('alert')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Adicionar projeto' })).not.toBeInTheDocument();
  });

  it('o botão Adicionar projeto dispara o pedido com irParaMissoes, pelo mesmo evento da lateral', async () => {
    const user = userEvent.setup();
    installApi({});
    const pedidos: Event[] = [];
    const ouvinte = (event: Event) => pedidos.push(event);
    window.addEventListener(ADD_PROJECT_REQUEST_EVENT, ouvinte);

    try {
      renderHome();

      await user.click(await screen.findByRole('button', { name: 'Adicionar projeto' }));

      expect(pedidos).toHaveLength(1);
      expect((pedidos[0] as CustomEvent<unknown>).detail).toEqual({ irParaMissoes: true });
      expect(screen.getByTestId('where')).toHaveTextContent('/');
    } finally {
      window.removeEventListener(ADD_PROJECT_REQUEST_EVENT, ouvinte);
    }
  });
});
