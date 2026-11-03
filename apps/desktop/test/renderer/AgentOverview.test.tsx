import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { AgentActivity, AppResult, ProjectHubApi } from '@project-hub/contracts';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AgentOverview } from '../../src/renderer/components/home/AgentOverview';

/**
 * Bloco "Visão geral" do Início: abas, período e chips por agente sobre o canal `activity.agents`, que aqui é
 * falso. Cobre também as regras de acessibilidade do mapa (grupo nomeado, um dia por imagem, células sem foco) e
 * a CSP do renderer (nenhum atributo `style`).
 */

// Sábado. O período de 90 dias começa numa segunda (27/07), então a primeira coluna leva um espaço antes.
const TODAY = new Date(2026, 9, 24, 15, 0);

const AGENTS: AgentActivity['agents'] = [
  { id: 'claude', label: 'Claude', messagesAvailable: true, tokensAvailable: true },
  { id: 'codex', label: 'Codex', messagesAvailable: true, tokensAvailable: true },
  { id: 'antigravity', label: 'Antigravity', messagesAvailable: true, tokensAvailable: false },
];

/**
 * 24 mensagens no período de 90 dias e 11.100 tokens (o Antigravity não tem tokens). No dia 24, o Claude lidera as
 * mensagens; no dia 23, o Antigravity. O dia 1º de agosto fica fora da janela de 7 dias.
 */
const DATA: AgentActivity = {
  agents: AGENTS,
  since: '2026-07-01',
  days: [
    { date: '2026-08-01', agent: 'claude', messages: 1, tokens: 100 },
    { date: '2026-10-22', agent: 'codex', messages: 5, tokens: 3000 },
    { date: '2026-10-23', agent: 'claude', messages: 3, tokens: 2000 },
    { date: '2026-10-23', agent: 'antigravity', messages: 4, tokens: null },
    { date: '2026-10-24', agent: 'claude', messages: 8, tokens: 5000 },
    { date: '2026-10-24', agent: 'codex', messages: 2, tokens: 1000 },
    { date: '2026-10-24', agent: 'antigravity', messages: 1, tokens: null },
  ],
};

function installAgents(result: AppResult<AgentActivity> | 'reject') {
  const agents = vi.fn(() =>
    result === 'reject' ? Promise.reject(new Error('fora do ar')) : Promise.resolve(result),
  );
  window.projectHub = { activity: { agents } } as unknown as ProjectHubApi;
  return agents;
}

afterEach(() => {
  Reflect.deleteProperty(window, 'projectHub');
});

async function renderReady(data: AgentActivity = DATA) {
  installAgents({ ok: true, data });
  const view = render(<AgentOverview today={TODAY} />);
  await screen.findByRole('group', { name: /^\d.*\.$/ });
  return view;
}

function days(container: HTMLElement): HTMLElement[] {
  return [...container.querySelectorAll<HTMLElement>('.overview-grid [role="img"]')];
}

describe('AgentOverview: carregamento', () => {
  it('enquanto carrega, o aviso é um status', () => {
    installAgents({ ok: true, data: DATA });

    render(<AgentOverview today={TODAY} />);

    expect(screen.getByRole('status')).toHaveTextContent('Carregando…');
  });

  it('com a consulta em erro, mostra a mensagem do bloco', async () => {
    installAgents({ ok: false, error: { code: 'UNKNOWN', message: 'x', retryable: true } });

    render(<AgentOverview today={TODAY} />);

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Não foi possível carregar o uso dos agentes.',
    );
  });

  it('com a chamada lançando, também mostra a mensagem', async () => {
    installAgents('reject');

    render(<AgentOverview today={TODAY} />);

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Não foi possível carregar o uso dos agentes.',
    );
  });

  it('sem nenhum dado no período, é uma linha só: sem mapa, mas com os filtros', async () => {
    installAgents({ ok: true, data: { agents: AGENTS, days: [], since: null } });

    const { container } = render(<AgentOverview today={TODAY} />);

    expect(await screen.findByText('Nenhuma mensagem pelo app neste período.')).toBeInTheDocument();
    expect(container.querySelector('.overview-grid')).toBeNull();
    expect(container.querySelector('.overview-legend')).toBeNull();
    expect(screen.queryByRole('table')).toBeNull();
    expect(container.querySelector('.overview-col')).toBeNull();
    expect(screen.getByRole('button', { name: '7 dias' })).toBeInTheDocument();
    expect(screen.queryByRole('alert')).toBeNull();
  });
});

describe('AgentOverview: Visão geral', () => {
  it('carrega e mostra os totais ao lado do mapa', async () => {
    await renderReady();

    const group = screen.getByRole('group', { name: '24 mensagens nos últimos 90 dias.' });
    expect(group).toBeInTheDocument();
    const stats = screen.getByRole('list', { name: 'Resumo do período' });
    expect(within(stats).getByText('Mensagens no período').nextSibling).toHaveTextContent('24');
    expect(within(stats).getByText('Tokens no período').nextSibling).toHaveTextContent(
      '11.100 sem Antigravity',
    );
    expect(within(stats).getByText('Sequência atual').nextSibling).toHaveTextContent('3 dias');
    expect(within(stats).getByText('Dia mais ativo').nextSibling).toHaveTextContent('sábado');
    expect(within(stats).queryByText('Agente mais usado')).toBeNull();
    // Tokens curtos na tela, com o número inteiro para o leitor de tela.
    const tokens = within(stats).getByText('Tokens no período').nextSibling as HTMLElement;
    expect(tokens.querySelector('[aria-hidden="true"]')).toHaveTextContent('11,1k');
    expect(tokens.querySelector('.visually-hidden')).toHaveTextContent('11.100');
    // A parte de cada agente mora na tabela "Por agente", não mais nos totais: sem barra nem legenda aqui.
    expect(within(stats).queryByRole('list', { name: /por agente/ })).toBeNull();
    expect(stats.querySelector('.overview-share')).toBeNull();
  });

  it('com só tokens de missão no período, mostra o aviso e os tokens ao lado', async () => {
    installAgents({
      ok: true,
      data: {
        agents: AGENTS,
        since: '2026-07-01',
        days: [{ date: '2026-10-24', agent: 'claude', messages: 0, tokens: 4200 }],
      },
    });
    render(<AgentOverview today={TODAY} />);

    expect(await screen.findByText('Nenhuma mensagem pelo app neste período.')).toBeInTheDocument();
    const stats = screen.getByRole('list', { name: 'Resumo do período' });
    expect(within(stats).getByText('Tokens no período').nextSibling).toHaveTextContent('4.200');
  });

  it('o título, as abas e o período padrão de 90 dias', async () => {
    await renderReady();

    expect(screen.getByRole('region', { name: 'Visão geral' })).toBeInTheDocument();
    // O rótulo do bloco é "Visão geral"; a primeira aba é "Resumo", para os dois não dizerem a mesma coisa.
    const tabs = screen.getAllByRole('tab').map((tab) => tab.textContent);
    expect(tabs).toEqual(['Resumo', 'Mensagens', 'Tokens']);
    expect(screen.getByRole('tab', { name: 'Resumo' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.queryByRole('tab', { name: 'Visão geral' })).toBeNull();
    expect(screen.getByRole('button', { name: '90 dias' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: '7 dias' })).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getByRole('button', { name: 'Todos' })).toHaveAttribute('aria-pressed', 'true');
    const chips = within(screen.getByRole('group', { name: 'Agente' })).getAllByRole('button');
    expect(chips.map((chip) => chip.textContent)).toEqual([
      'Todos',
      'Claude',
      'Codex',
      'Antigravity',
    ]);
  });

  it('a nota diz que só conta o que foi feito pelo app', async () => {
    await renderReady();

    expect(
      screen.getByText(
        'Conta só o que foi feito pelo app. Codex e Antigravity são ligados pela pasta e pelo horário.',
      ),
    ).toBeInTheDocument();
  });

  it('"7 dias" mostra 7 células de dia e só as mensagens dessa janela', async () => {
    const user = userEvent.setup();
    const { container } = await renderReady();

    await user.click(screen.getByRole('button', { name: '7 dias' }));

    expect(days(container)).toHaveLength(7);
    expect(screen.getByRole('button', { name: '7 dias' })).toHaveAttribute('aria-pressed', 'true');
    expect(
      screen.getByRole('group', { name: '23 mensagens nos últimos 7 dias.' }),
    ).toBeInTheDocument();
  });

  it('"Tudo" começa no registro mais antigo do app', async () => {
    const user = userEvent.setup();
    const { container } = await renderReady();

    await user.click(screen.getByRole('button', { name: 'Tudo' }));

    // 01/07 a 24/10 de 2026: 31 + 31 + 30 + 24 dias.
    expect(days(container)).toHaveLength(116);
    expect(
      screen.getByRole('group', { name: '24 mensagens em todo o período.' }),
    ).toBeInTheDocument();
  });

  it('sem Antigravity no período, os tokens saem sem a observação', async () => {
    const user = userEvent.setup();
    await renderReady();

    await user.click(screen.getByRole('button', { name: 'Codex' }));

    const stats = screen.getByRole('list', { name: 'Resumo do período' });
    expect(within(stats).getByText('Tokens no período').nextSibling).toHaveTextContent('4.000');
    expect(within(stats).getByText('Tokens no período').nextSibling).not.toHaveTextContent('sem ');
  });

  it('com o Antigravity filtrado, os tokens do período são "indisponível"', async () => {
    const user = userEvent.setup();
    await renderReady();

    await user.click(screen.getByRole('button', { name: 'Antigravity' }));

    const stats = screen.getByRole('list', { name: 'Resumo do período' });
    expect(within(stats).getByText('Tokens no período').nextSibling).toHaveTextContent(
      'indisponível',
    );
    expect(within(stats).getByText('Mensagens no período').nextSibling).toHaveTextContent('5');
  });
});

describe('AgentOverview: abas e chips', () => {
  it('trocar para "Tokens" troca o mapa e esconde os totais ao lado', async () => {
    const user = userEvent.setup();
    const { container } = await renderReady();

    await user.click(screen.getByRole('tab', { name: 'Tokens' }));

    expect(screen.getByRole('tab', { name: 'Tokens' })).toHaveAttribute('aria-selected', 'true');
    expect(
      screen.getByRole('group', { name: '11.100 tokens nos últimos 90 dias.' }),
    ).toBeInTheDocument();
    expect(screen.queryByRole('group', { name: /mensagens/ })).toBeNull();
    expect(screen.queryByRole('list', { name: 'Resumo do período' })).toBeNull();
    expect(
      screen.getByRole('img', { name: '24 de out.: 6.000 tokens, Claude' }),
    ).toBeInTheDocument();
    expect(days(container)).toHaveLength(90);
  });

  it('"Mensagens" mostra o mapa de mensagens sem os totais', async () => {
    const user = userEvent.setup();
    await renderReady();

    await user.click(screen.getByRole('tab', { name: 'Mensagens' }));

    expect(
      screen.getByRole('group', { name: '24 mensagens nos últimos 90 dias.' }),
    ).toBeInTheDocument();
    expect(screen.queryByRole('list', { name: 'Resumo do período' })).toBeNull();
  });

  it('o chip Codex filtra o mapa e fica apertado', async () => {
    const user = userEvent.setup();
    await renderReady();

    await user.click(screen.getByRole('button', { name: 'Codex' }));

    expect(screen.getByRole('button', { name: 'Codex' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'Todos' })).toHaveAttribute('aria-pressed', 'false');
    expect(
      screen.getByRole('group', { name: '7 mensagens do Codex nos últimos 90 dias.' }),
    ).toBeInTheDocument();
    expect(screen.getByRole('img', { name: '22 de out.: 5 mensagens, Codex' })).toBeInTheDocument();
    expect(screen.getByRole('img', { name: '23 de out.: nenhuma mensagem' })).toBeInTheDocument();
  });

  it('o chip Antigravity na aba Tokens mostra o aviso no lugar do mapa', async () => {
    const user = userEvent.setup();
    const { container } = await renderReady();

    await user.click(screen.getByRole('tab', { name: 'Tokens' }));
    await user.click(screen.getByRole('button', { name: 'Antigravity' }));

    expect(screen.getByText('Tokens indisponíveis para o Antigravity.')).toBeInTheDocument();
    expect(container.querySelector('.overview-grid')).toBeNull();
    expect(container.querySelector('.overview-legend')).toBeNull();
    expect(screen.queryByRole('table')).toBeNull();
  });

  it('agente do registro sem leitor entra como chip e avisa nas duas métricas', async () => {
    const user = userEvent.setup();
    await renderReady({
      ...DATA,
      agents: [
        ...AGENTS,
        { id: 'novo', label: 'Novo', messagesAvailable: false, tokensAvailable: false },
      ],
    });

    await user.click(screen.getByRole('button', { name: 'Novo' }));
    expect(screen.getByText('Mensagens indisponíveis para o Novo.')).toBeInTheDocument();

    await user.click(screen.getByRole('tab', { name: 'Tokens' }));
    expect(screen.getByText('Tokens indisponíveis para o Novo.')).toBeInTheDocument();
  });

});

describe('AgentOverview: mapa', () => {
  it('cada dia leva o nível e o agente dominante por classe', async () => {
    const { container } = await renderReady();

    const today = screen.getByRole('img', { name: '24 de out.: 11 mensagens, Claude' });
    expect(today).toHaveClass('overview-cell', 'overview-level--4', 'overview-agent--claude');
    expect(today).toHaveClass('overview-cell--today');
    const friday = screen.getByRole('img', { name: '23 de out.: 7 mensagens, Antigravity' });
    expect(friday).toHaveClass('overview-agent--antigravity');
    const thursday = screen.getByRole('img', { name: '22 de out.: 5 mensagens, Codex' });
    expect(thursday).toHaveClass('overview-agent--codex');
    const empty = screen.getByRole('img', { name: '21 de out.: nenhuma mensagem' });
    expect(empty).toHaveClass('overview-level--0');
    expect(empty.className).not.toMatch(/overview-agent--/);
    expect(container.querySelectorAll('.overview-grid .overview-cell--today')).toHaveLength(1);
  });

  it('agente fora das cores do app usa a rampa neutra "outro"', async () => {
    const { container } = await renderReady({
      agents: [
        ...AGENTS,
        { id: 'novo', label: 'Novo', messagesAvailable: true, tokensAvailable: true },
      ],
      since: null,
      days: [{ date: '2026-10-24', agent: 'novo', messages: 3, tokens: 10 }],
    });

    const cell = screen.getByRole('img', { name: '24 de out.: 3 mensagens, Novo' });
    expect(cell).toHaveClass('overview-agent--outro');
    expect(container.querySelector('.overview-agent--novo')).toBeNull();
  });

  it('a primeira coluna leva o canto da régua e os rótulos seg, qua e sex; a seguinte, o mês e os dias', async () => {
    const { container } = await renderReady();

    const grid = container.querySelector('.overview-grid') as HTMLElement;
    const items = [...grid.children];
    // Oito itens por coluna: a régua (vazia no canto) e os sete dias da semana.
    expect(items.slice(0, 8).map((item) => item.textContent)).toEqual([
      '',
      '',
      'seg',
      '',
      'qua',
      '',
      'sex',
      '',
    ]);
    expect(items[0]).toHaveClass('overview-grid__ruler');
    // A segunda coluna começa pela régua ("ago": o 1º de agosto cai nela), e 27/07 é segunda-feira: um espaço antes.
    expect(items[8]).toHaveClass('overview-grid__ruler');
    expect(items[8]).toHaveTextContent('ago');
    expect(items[9]).toHaveClass('overview-cell--blank');
    expect(items[10]).toHaveAttribute('aria-label', '27 de jul.: nenhuma mensagem');
  });

  it('a régua de meses tem um item por semana e o nome do mês onde ele começa', async () => {
    const { container } = await renderReady();

    const rulers = [...container.querySelectorAll('.overview-grid__ruler')];
    // O canto e as 13 semanas de 90 dias.
    expect(rulers).toHaveLength(14);
    expect(rulers.map((item) => item.textContent).filter(Boolean)).toEqual(['ago', 'set', 'out']);
  });

  it('só a régua da última semana se alinha ao fim, para o nome do mês não passar da borda direita do mapa', async () => {
    const { container } = await renderReady();

    const rulers = [...container.querySelectorAll('.overview-grid__ruler')];
    const ending = rulers.filter((item) => item.classList.contains('overview-grid__ruler--end'));
    expect(ending).toHaveLength(1);
    expect(ending[0]).toBe(rulers[rulers.length - 1]);
  });

  it('o tamanho das células acompanha o número de semanas: 7 e 30 dias maiores, 90 dias normal', async () => {
    const user = userEvent.setup();
    const { container } = await renderReady();
    const grid = () => container.querySelector('.overview-grid') as HTMLElement;

    expect(grid().className).toBe('overview-grid');

    await user.click(screen.getByRole('button', { name: '7 dias' }));
    expect(grid()).toHaveClass('overview-grid--roomy');

    await user.click(screen.getByRole('button', { name: '30 dias' }));
    expect(grid()).toHaveClass('overview-grid--roomy');

    await user.click(screen.getByRole('button', { name: '90 dias' }));
    expect(grid().className).toBe('overview-grid');
  });

  it('muitas semanas ("Tudo" com meses de registro) apertam as células', async () => {
    const user = userEvent.setup();
    const { container } = await renderReady({ ...DATA, since: '2026-01-01' });

    await user.click(screen.getByRole('button', { name: 'Tudo' }));

    // 01/01 a 24/10 de 2026: 297 dias, 43 semanas.
    expect(container.querySelector('.overview-grid')).toHaveClass('overview-grid--tight');
  });

  it('o grid é um grupo nomeado pelo resumo, e cada dia é uma imagem com nome igual ao title', async () => {
    const { container } = await renderReady();

    const group = screen.getByRole('group', { name: '24 mensagens nos últimos 90 dias.' });
    expect(group).toBe(container.querySelector('.overview-grid'));
    const images = within(group).getAllByRole('img');
    expect(images).toHaveLength(90);
    for (const day of images) {
      const name = day.getAttribute('aria-label') ?? '';
      expect(name).toMatch(
        /^\d{1,2} de [^:]+: (nenhuma mensagem|1 mensagem|\d+ mensagens)(, [\p{L} ]+)?$/u,
      );
      expect(day).toHaveAttribute('title', name);
      expect(day).not.toHaveAttribute('tabindex');
    }
  });

  it('rótulos de linha, células vazias, pontos dos chips e legenda ficam fora da árvore de acessibilidade', async () => {
    const { container } = await renderReady();

    const count = (selector: string) => container.querySelectorAll(selector).length;
    // 7 rótulos de linha, a régua (o canto e 13 semanas), 1 espaço antes do primeiro dia, a legenda, os pontos
    // (3 nos chips e 3 na tabela) e uma barra por agente na tabela.
    expect(count('.overview-grid__label')).toBe(7);
    expect(count('.overview-grid__ruler')).toBe(14);
    expect(count('.overview-cell--blank')).toBe(1);
    expect(count('.overview-legend')).toBe(1);
    expect(count('.overview-dot')).toBe(6);
    expect(count('.overview-share')).toBe(3);
    const hidden = [
      ...container.querySelectorAll('.overview-grid__label'),
      ...container.querySelectorAll('.overview-grid__ruler'),
      ...container.querySelectorAll('.overview-cell--blank'),
      ...container.querySelectorAll('.overview-legend'),
      ...container.querySelectorAll('.overview-dot'),
      ...container.querySelectorAll('.overview-share'),
    ];
    for (const element of hidden) {
      expect(element).toHaveAttribute('aria-hidden', 'true');
    }
    expect(container.querySelectorAll('.overview-grid [tabindex]')).toHaveLength(0);
    const legend = container.querySelector('.overview-legend') as HTMLElement;
    expect(legend).toHaveTextContent('menos');
    expect(legend).toHaveTextContent('mais');
    expect(legend.querySelectorAll('.overview-cell')).toHaveLength(5);
  });

  it('nenhum elemento tem atributo style, em nenhuma aba', async () => {
    const user = userEvent.setup();
    const { container } = await renderReady();
    // A barra de abas do Radix tira o contorno por script (CSSOM, que a CSP permite); o markup do bloco não escreve estilo.
    const written = '[style]:not([role="tablist"])';
    expect(container.querySelector(written)).toBeNull();

    await user.click(screen.getByRole('tab', { name: 'Tokens' }));
    await user.click(screen.getByRole('button', { name: 'Claude' }));
    expect(container.querySelector(written)).toBeNull();
    expect(container.querySelector('style')).toBeNull();
  });

  it('a aba ativa controla o painel que existe', async () => {
    const { container } = await renderReady();

    const selected = screen.getByRole('tab', { selected: true });
    const panelId = selected.getAttribute('aria-controls');
    expect(panelId).not.toBeNull();
    const panel = container.querySelector(`#${panelId}`);
    expect(panel).not.toBeNull();
    expect(panel).toHaveAttribute('role', 'tabpanel');
    expect(panel).toHaveAttribute('aria-labelledby', selected.id);
  });
});

describe('AgentOverview: colunas', () => {
  const panelOf = (container: HTMLElement) =>
    container.querySelector('[role="tabpanel"]') as HTMLElement;
  const titlesOf = (panel: HTMLElement) =>
    within(panel)
      .getAllByRole('heading', { level: 3 })
      .map((heading) => heading.textContent);

  it('o Resumo tem três colunas: por dia, por agente e no período', async () => {
    const { container } = await renderReady();

    const panel = panelOf(container);
    expect(panel).toHaveClass('overview__body', 'overview__body--map', 'overview__body--stats');
    expect(titlesOf(panel)).toEqual(['Por dia', 'Por agente', 'No período']);
    expect(panel.querySelectorAll('.overview-col')).toHaveLength(3);
    // O mapa, a tabela e os totais ficam cada um na sua coluna.
    expect(panel.querySelector('.overview-col .overview-grid')).not.toBeNull();
    expect(panel.querySelector('.overview-col .overview-agents')).not.toBeNull();
    expect(panel.querySelector('.overview-col .overview-stats')).not.toBeNull();
  });

  it('Mensagens e Tokens têm só o mapa e a tabela, sem a coluna dos totais', async () => {
    const user = userEvent.setup();
    const { container } = await renderReady();

    for (const name of ['Mensagens', 'Tokens']) {
      await user.click(screen.getByRole('tab', { name }));
      const panel = panelOf(container);
      expect(panel, name).toHaveClass('overview__body--map');
      expect(panel, name).not.toHaveClass('overview__body--stats');
      expect(titlesOf(panel), name).toEqual(['Por dia', 'Por agente']);
    }
  });

  it('só tokens de missão no período: o aviso e os totais, sem as colunas do mapa', async () => {
    installAgents({
      ok: true,
      data: {
        agents: AGENTS,
        since: '2026-07-01',
        days: [{ date: '2026-10-24', agent: 'claude', messages: 0, tokens: 4200 }],
      },
    });
    const { container } = render(<AgentOverview today={TODAY} />);

    await screen.findByText('Nenhuma mensagem pelo app neste período.');

    const panel = panelOf(container);
    expect(panel).toHaveClass('overview__body--stats');
    expect(panel).not.toHaveClass('overview__body--map');
    expect(screen.queryByRole('table')).toBeNull();
  });
});

describe('AgentOverview: tabela por agente', () => {
  const table = () => screen.getByRole('table', { name: 'Uso por agente' });
  const headers = () =>
    within(table())
      .getAllByRole('columnheader')
      .map((header) => header.textContent);
  /** As linhas de agente, sem a do cabeçalho e sem a do total. */
  const agentRows = () =>
    within(table())
      .getAllByRole('row')
      .filter((row) => within(row).queryByRole('rowheader') !== null)
      .filter((row) => !/^Total no período/.test(row.textContent ?? ''));
  const cells = (row: HTMLElement) =>
    within(row)
      .getAllByRole('cell')
      .map((cell) => cell.textContent);

  it('no Resumo, uma linha por agente do registro, com as mensagens e os tokens do período', async () => {
    await renderReady();

    expect(headers()).toEqual(['Agente', 'Proporção', 'Mensagens', 'Tokens']);
    const rows = agentRows();
    expect(rows.map((row) => within(row).getByRole('rowheader').textContent)).toEqual([
      'Claude',
      'Codex',
      'Antigravity',
    ]);
    // Tokens curtos na tela e inteiros para o leitor de tela. O Antigravity não tem leitor de tokens: traço.
    expect(cells(rows[0] as HTMLElement)).toEqual(['12', '7,1k7.100']);
    expect(cells(rows[1] as HTMLElement)).toEqual(['7', '4k4.000']);
    expect(cells(rows[2] as HTMLElement)).toEqual(['5', '—indisponível']);
  });

  it('agente do registro sem leitor aparece com traço nas duas métricas, nunca com zero', async () => {
    await renderReady({
      ...DATA,
      agents: [
        ...AGENTS,
        { id: 'novo', label: 'Novo', messagesAvailable: false, tokensAvailable: false },
      ],
    });

    const row = agentRows().find(
      (item) => within(item).getByRole('rowheader').textContent === 'Novo',
    );
    expect(row).toBeDefined();
    expect(cells(row as HTMLElement)).toEqual(['—indisponível', '—indisponível']);
  });

  it('agente com leitor e sem uso no período mostra 0', async () => {
    await renderReady({
      ...DATA,
      days: DATA.days.filter((row) => row.agent !== 'codex'),
    });

    const codex = agentRows()[1] as HTMLElement;
    // Os tokens levam o valor curto na tela e o completo para o leitor de tela (a mesma regra dos outros valores).
    expect(cells(codex)).toEqual(['0', '00']);
  });

  it('em Mensagens, o valor, a parte em % e o total na base', async () => {
    const user = userEvent.setup();
    await renderReady();

    await user.click(screen.getByRole('tab', { name: 'Mensagens' }));

    expect(headers()).toEqual(['Agente', 'Proporção', 'Mensagens', 'Parte']);
    const rows = agentRows();
    expect(cells(rows[0] as HTMLElement)).toEqual(['12', '50%']);
    expect(cells(rows[1] as HTMLElement)).toEqual(['7', '29%']);
    expect(cells(rows[2] as HTMLElement)).toEqual(['5', '21%']);
    const total = within(table()).getByRole('row', { name: /Total no período/ });
    expect(cells(total)).toEqual(['24', '100%']);
  });

  it('em Tokens, a parte é só de quem tem dado e o total avisa "sem Antigravity"', async () => {
    const user = userEvent.setup();
    await renderReady();

    await user.click(screen.getByRole('tab', { name: 'Tokens' }));

    expect(headers()).toEqual(['Agente', 'Proporção', 'Tokens', 'Parte']);
    const rows = agentRows();
    expect(cells(rows[0] as HTMLElement)).toEqual(['7,1k7.100', '64%']);
    expect(cells(rows[1] as HTMLElement)).toEqual(['4k4.000', '36%']);
    expect(cells(rows[2] as HTMLElement)).toEqual(['—indisponível', '']);
    const total = within(table()).getByRole('row', { name: /Total no período/ });
    expect(cells(total)).toEqual(['11,1k11.100', '100%']);
    expect(total).toHaveTextContent('sem Antigravity');
  });

  it('cada linha tem uma barra com a parte do agente, com a largura no atributo e a cor na classe', async () => {
    const { container } = await renderReady();

    const bars = [...container.querySelectorAll('.overview-agents .overview-share')];
    expect(bars).toHaveLength(3);
    const parts = [...container.querySelectorAll('.overview-agents .overview-share__part')];
    // Mensagens: 12, 7 e 5 de 24.
    expect(parts.map((part) => Number(part.getAttribute('width')))).toEqual([
      expect.closeTo(50, 5),
      expect.closeTo((7 / 24) * 100, 5),
      expect.closeTo((5 / 24) * 100, 5),
    ]);
    expect(parts[0]).toHaveClass('overview-agent--claude');
    expect(parts[2]).toHaveClass('overview-agent--antigravity');
    expect(container.querySelector('.overview-agents [style]')).toBeNull();
  });

  it('com um agente filtrado a tabela segue completa e só a linha dele fica marcada', async () => {
    const user = userEvent.setup();
    await renderReady();
    expect(agentRows().filter((row) => row.hasAttribute('aria-current'))).toHaveLength(0);

    await user.click(screen.getByRole('button', { name: 'Codex' }));

    const rows = agentRows();
    expect(rows).toHaveLength(3);
    expect(rows.map((row) => row.getAttribute('aria-current'))).toEqual([null, 'true', null]);
    expect(rows[1]).toHaveClass('overview-agents__row--selected');
  });
});
