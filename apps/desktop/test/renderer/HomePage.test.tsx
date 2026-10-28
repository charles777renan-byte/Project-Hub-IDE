import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router';
import type {
  ActivityDay,
  AppResult,
  ApprovalDto,
  MissionDto,
  MissionViewDto,
  ProjectHubApi,
  ProjectSummary,
} from '@project-hub/contracts';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { OverviewCounters } from '../../src/renderer/components/OverviewCounters';
import { HomePage } from '../../src/renderer/pages/HomePage';
import { missionPath, ROUTE_PATHS } from '../../src/renderer/routes';

/**
 * Início como painel de abertura: saudação numa linha, "Precisa de você", missões com progresso (e o
 * filtro `?estado=` dos contadores da barra de status), atividade compacta e uso dos agentes. A API do
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

type Setup = {
  projects?: ProjectSummary[] | 'error';
  missions?: Record<string, MissionDto[]>;
  /** Resposta de `missions.get` por missão; `undefined` devolve a aprovação da missão. */
  get?: (missionId: string) => AppResult<MissionViewDto> | 'pending' | undefined;
  /** Resposta de `activity.daily`; sem ela, a consulta devolve banco vazio. */
  activity?: AppResult<ActivityDay[]>;
  /** Nome do perfil local (`profile.get`). */
  displayName?: string | null;
};

function installApi({ projects = [], missions = {}, get, activity, displayName = null }: Setup) {
  const setDisplayName = vi.fn(() => Promise.resolve({ ok: true }));
  const api = {
    activity: {
      daily: vi.fn(() =>
        Promise.resolve<AppResult<ActivityDay[]>>(activity ?? { ok: true, data: [] }),
      ),
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
            ],
          },
        }),
      ),
      refresh: vi.fn(),
      subscribe: vi.fn(() => () => {}),
    },
  };
  window.projectHub = api as unknown as ProjectHubApi;
  return { setDisplayName };
}

function Where() {
  const location = useLocation();
  return <p data-testid="where">{`${location.pathname}${location.search}`}</p>;
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

  it('monta as faixas na ordem: saudação, Precisa de você, Missões, Atividade e Uso dos agentes', async () => {
    installApi({ projects: [project('p1')] });

    renderHome();

    await screen.findByText('Nada espera por você.');
    const order = [
      screen.getByRole('heading', { level: 1, name: 'Início' }),
      panel('Precisa de você'),
      panel('Missões'),
      panel('Atividade'),
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

  it('Missões lista todas as missões com o estado e o link para a missão', async () => {
    installApi({ projects: [project('p1')], missions: MIXED });

    renderHome();

    const missions = panel('Missões');
    expect(await within(missions).findByRole('link', { name: 'Missão m1' })).toHaveAttribute(
      'href',
      missionPath('p1', 'm1'),
    );
    expect(within(missions).getAllByRole('listitem')).toHaveLength(5);
    expect(within(missions).getByText(/^Falhou/)).toBeInTheDocument();
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
    expect(within(missions).getAllByRole('listitem')).toHaveLength(5);
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
      expect(screen.getByText(/aguarda você/)).toHaveTextContent('2 aguarda você'),
    );
    expect(
      within(missions)
        .getAllByRole('link')
        .map((link) => link.textContent),
    ).toEqual(['Missão m3', 'Missão m4']);
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
    await waitFor(() => expect(within(missions).getAllByRole('listitem')).toHaveLength(5));
  });

  it('um valor de ?estado= que não existe vale como sem filtro', async () => {
    installApi({ projects: [project('p1')], missions: MIXED });

    renderHome('/?estado=qualquer');

    const missions = panel('Missões');
    await within(missions).findByRole('link', { name: 'Missão m1' });
    expect(within(missions).getAllByRole('listitem')).toHaveLength(5);
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

  it('com tudo vazio, mostra os estados vazios', async () => {
    installApi({});

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

  it('sem eventos, a atividade é uma linha só e não desenha a grade', async () => {
    installApi({ projects: [project('p1')] });

    renderHome();

    expect(
      await within(panel('Atividade')).findByText('Nenhuma atividade nos últimos 90 dias.'),
    ).toBeInTheDocument();
    expect(document.querySelector('.activity-grid')).toBeNull();
  });

  it('com a atividade em falha, o bloco mostra a mensagem e o resto da tela segue', async () => {
    installApi({
      projects: [project('p1')],
      missions: { p1: [mission('m1', 'p1', 'running')] },
      activity: { ok: false, error: { code: 'UNKNOWN', message: 'x', retryable: true } },
    });

    renderHome();

    expect(
      await within(panel('Atividade')).findByText('Não foi possível carregar a atividade.'),
    ).toBeInTheDocument();
    expect(await within(panel('Missões')).findByText('Missão m1')).toBeInTheDocument();
  });

  it('Uso dos agentes mostra o cartão do Claude e "Em breve" para os outros programas', async () => {
    installApi({ projects: [project('p1')] });

    renderHome();

    const usage = panel('Uso dos agentes');
    expect(await within(usage).findByText('Uso do Claude')).toBeInTheDocument();
    expect(await within(usage).findByText('16% usado · 84% restante')).toBeInTheDocument();
    expect(within(usage).getByLabelText('Sessão atual, 16% usado')).toBeInTheDocument();
    expect(within(usage).getByText('Codex e Antigravity CLI: Em breve.')).toBeInTheDocument();
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
    installApi({});

    renderHome();

    await screen.findByText('Nada espera por você.');
    expect(document.body.textContent).not.toMatch(/travad/i);
  });
});
